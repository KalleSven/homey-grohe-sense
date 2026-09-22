'use strict';

const Homey = require('homey');
const GroheAuth = require('../../lib/GroheAuth');
const GroheApi = require('../../lib/GroheApi');
const { NOTIFICATIONS, NOTIFICATION_CATEGORY_CRITICAL, NOTIFICATION_CATEGORY_WARNING } = require('../../lib/GroheConstants');

class GroheSenseGuardDevice extends Homey.Device {
  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('GroheSenseGuardDevice initializing:', this.getName());

    this.locationId = this.getData().locationId;
    this.roomId = this.getData().roomId;
    this.applianceId = this.getData().applianceId || this.getData().id;

    // Initialize Auth and API client
    const storedToken = this.getStoreValue('refreshToken');
    this.auth = new GroheAuth(this);
    if (storedToken) {
      this.auth.setRefreshToken(storedToken);
    }
    this.api = new GroheApi(this.auth, this);

    // Track active alarms & last values
    this.lastKnownAlarms = new Set();
    this.acknowledgedNotifications = new Set();
    this.activeNotifications = [];
    this.lastKnownPressure = null;
    this.lastKnownWaterToday = null;

    // Register capability listener for valve control
    this.registerCapabilityListener('onoff', this.onCapabilityOnoff.bind(this));

    // Ensure button_silence_alarm capability exists on device (for existing paired devices)
    if (!this.hasCapability('button_silence_alarm')) {
      await this.addCapability('button_silence_alarm').catch(this.error);
    }
    this.registerCapabilityListener('button_silence_alarm', async () => {
      return this.silenceAlarm('all');
    });

    // Clean up obsolete meter_water capability if present on existing paired devices
    if (this.hasCapability('meter_water')) {
      await this.removeCapability('meter_water').catch(this.error);
    }

    // Start polling timers
    this.startPolling();

    // Initial sync
    this.syncStatusAndAlarms().catch((err) => this.error('Initial status sync failed:', err.message));
    this.syncMeasurements().catch((err) => this.error('Initial measurements sync failed:', err.message));
  }

  /**
   * Handle onoff capability change (valve open/close)
   */
  async onCapabilityOnoff(value) {
    this.log(`Setting Grohe Sense Guard valve to: ${value ? 'OPEN' : 'CLOSED'}`);

    try {
      await this.api.setValveState(this.locationId, this.roomId, this.applianceId, value);
      this.log(`Valve successfully set to ${value ? 'OPEN' : 'CLOSED'}`);

      // Trigger flow cards
      if (value) {
        this.homey.flow.getDeviceTriggerCard('valve_opened').trigger(this).catch(this.error);
      } else {
        this.homey.flow.getDeviceTriggerCard('valve_closed').trigger(this).catch(this.error);
      }

      // Persist latest refresh token if updated
      this.saveLatestToken();
    } catch (err) {
      this.error(`Failed to set valve state: ${err.message}`);
      throw new Error(`Failed to control valve: ${err.message}`);
    }
  }

  /**
   * Start polling loops for status, alarms, and measurements
   */
  startPolling() {
    this.stopPolling();

    const statusInterval = Math.max(30, (this.getSetting('poll_interval') || 60)) * 1000;
    const measurementsInterval = Math.max(60, (this.getSetting('measurements_poll_interval') || 300)) * 1000;

    this.log(`Starting poll timers. Status: ${statusInterval / 1000}s, Measurements: ${measurementsInterval / 1000}s`);

    this.statusTimer = this.homey.setInterval(() => {
      this.syncStatusAndAlarms().catch((err) => this.error('Status sync error:', err.message));
    }, statusInterval);

    this.measurementsTimer = this.homey.setInterval(() => {
      this.syncMeasurements().catch((err) => this.error('Measurements sync error:', err.message));
    }, measurementsInterval);
  }

  /**
   * Stop polling loops
   */
  stopPolling() {
    if (this.statusTimer) {
      this.homey.clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
    if (this.measurementsTimer) {
      this.homey.clearInterval(this.measurementsTimer);
      this.measurementsTimer = null;
    }
  }

  /**
   * Sync valve state, online status and notifications/alarms
   */
  async syncStatusAndAlarms() {
    try {
      // 1. Fetch valve state
      const commandRes = await this.api.getApplianceCommand(this.locationId, this.roomId, this.applianceId);
      if (commandRes && commandRes.command) {
        const isValveOpen = !!commandRes.command.valve_open;
        const currentOnoff = this.getCapabilityValue('onoff');

        if (currentOnoff !== isValveOpen) {
          await this.setCapabilityValue('onoff', isValveOpen).catch(this.error);
          if (isValveOpen) {
            this.homey.flow.getDeviceTriggerCard('valve_opened').trigger(this).catch(this.error);
          } else {
            this.homey.flow.getDeviceTriggerCard('valve_closed').trigger(this).catch(this.error);
          }
        }
      }

      // 2. Fetch notifications/alarms
      const notifs = await this.api.getApplianceNotifications(this.locationId, this.roomId, this.applianceId).catch((err) => {
        this.error('Error fetching notifications:', err.message);
        return [];
      });
      this.activeNotifications = Array.isArray(notifs) ? notifs : [];
      this.processNotifications(this.activeNotifications);

      // Save token if changed
      this.saveLatestToken();

      if (!this.getAvailable()) {
        await this.setAvailable();
      }
    } catch (err) {
      this.error('Error syncing status and alarms:', err.message);
    }
  }

  /**
   * Helper to get a stable unique key for a notification
   */
  getNotificationKey(notif) {
    return String(notif.id || notif.uuid || notif.notification_id || `${notif.category}_${notif.type}_${notif.timestamp || notif.date || ''}`);
  }

  /**
   * Process notifications received from Grohe Cloud
   */
  processNotifications(notifications) {
    if (!Array.isArray(notifications)) return;

    // Prune acknowledged notifications that no longer exist in Grohe Cloud response
    const currentKeys = new Set(notifications.map((n) => this.getNotificationKey(n)));
    for (const ackKey of this.acknowledgedNotifications) {
      if (!currentKeys.has(ackKey)) {
        this.acknowledgedNotifications.delete(ackKey);
      }
    }

    let hasWaterLeak = false;
    let hasMicroLeak = false;
    let hasFrostWarning = false;
    let primaryAlarmType = 'Water Leak';
    let primaryAlarmDesc = '';

    for (const notif of notifications) {
      // Only process unread / active notifications
      const isUnread = notif.is_read === false || notif.read === false || notif.status === 0;
      if (!isUnread) continue;

      const notifKey = this.getNotificationKey(notif);
      // Skip if locally snoozed/acknowledged
      if (this.acknowledgedNotifications.has(notifKey)) {
        continue;
      }

      const category = notif.category;
      const type = notif.type;
      const notifInfo = NOTIFICATIONS[category]?.[type];
      const lang = (this.homey.i18n && typeof this.homey.i18n.getLanguage === 'function')
        ? this.homey.i18n.getLanguage()
        : 'en';
      const desc = (notifInfo && notifInfo[lang]) || notifInfo?.en || `Alarm (${category}/${type})`;

      if (category === NOTIFICATION_CATEGORY_CRITICAL) {
        hasWaterLeak = true;
        primaryAlarmType = lang === 'sv' ? 'Kritiskt larm' : 'Critical Alarm';
        primaryAlarmDesc = desc;
      } else if (category === NOTIFICATION_CATEGORY_WARNING) {
        if ([320, 321, 420, 421].includes(type)) {
          hasWaterLeak = true;
          primaryAlarmType = lang === 'sv' ? 'Ovanlig förbrukning / Tryckproblem' : 'Unusual Consumption / Pressure Issue';
          primaryAlarmDesc = desc;
        } else if ([330, 332].includes(type)) {
          hasMicroLeak = true;
          primaryAlarmType = lang === 'sv' ? 'Mikroläckage' : 'Micro Leak';
          primaryAlarmDesc = desc;
        } else if ([40, 340].includes(type)) {
          hasFrostWarning = true;
          primaryAlarmType = lang === 'sv' ? 'Frostvarning' : 'Frost Warning';
          primaryAlarmDesc = desc;
        }
      }
    }

    // Update alarm_water
    const prevWaterLeak = !!this.getCapabilityValue('alarm_water');
    if (prevWaterLeak !== hasWaterLeak) {
      this.log(`Updating alarm_water from ${prevWaterLeak} to ${hasWaterLeak}`);
      this.setCapabilityValue('alarm_water', hasWaterLeak).catch(this.error);
      if (hasWaterLeak) {
        this.homey.flow.getDeviceTriggerCard('alarm_water_triggered')
          .trigger(this, { alarm_type: primaryAlarmType, description: primaryAlarmDesc })
          .catch(this.error);
      } else {
        this.homey.flow.getDeviceTriggerCard('alarm_water_cleared')
          .trigger(this)
          .catch(this.error);
      }
    }

    // Update alarm_micro_leak
    const prevMicroLeak = !!this.getCapabilityValue('alarm_micro_leak');
    if (prevMicroLeak !== hasMicroLeak) {
      this.log(`Updating alarm_micro_leak from ${prevMicroLeak} to ${hasMicroLeak}`);
      this.setCapabilityValue('alarm_micro_leak', hasMicroLeak).catch(this.error);
      if (hasMicroLeak) {
        this.homey.flow.getDeviceTriggerCard('alarm_micro_leak_triggered')
          .trigger(this)
          .catch(this.error);
      }
    }

    // Update alarm_frost
    const prevFrost = !!this.getCapabilityValue('alarm_frost');
    if (prevFrost !== hasFrostWarning) {
      this.log(`Updating alarm_frost from ${prevFrost} to ${hasFrostWarning}`);
      this.setCapabilityValue('alarm_frost', hasFrostWarning).catch(this.error);
      if (hasFrostWarning) {
        const currentTemp = this.getCapabilityValue('measure_temperature') || 0;
        this.homey.flow.getDeviceTriggerCard('alarm_frost_triggered')
          .trigger(this, { temperature: currentTemp })
          .catch(this.error);
      }
    }
  }

  /**
   * Silence / reset alarms locally and in Grohe Cloud
   */
  async silenceAlarm(alarmType = 'all') {
    this.log(`Silencing alarm (${alarmType}) on ${this.getName()}`);
    const toAcknowledge = [];

    for (const notif of this.activeNotifications) {
      const isUnread = notif.is_read === false || notif.read === false || notif.status === 0;
      if (!isUnread) continue;

      const category = notif.category;
      const type = notif.type;
      let matches = false;

      if (alarmType === 'all') {
        matches = true;
      } else if (alarmType === 'water') {
        matches = category === NOTIFICATION_CATEGORY_CRITICAL || (category === NOTIFICATION_CATEGORY_WARNING && [320, 321, 420, 421].includes(type));
      } else if (alarmType === 'micro_leak') {
        matches = category === NOTIFICATION_CATEGORY_WARNING && [330, 332].includes(type);
      } else if (alarmType === 'frost') {
        matches = category === NOTIFICATION_CATEGORY_WARNING && [40, 340].includes(type);
      }

      if (matches) {
        const key = this.getNotificationKey(notif);
        this.acknowledgedNotifications.add(key);
        toAcknowledge.push(notif);
      }
    }

    // Turn off relevant capabilities
    if (alarmType === 'all' || alarmType === 'water') {
      if (this.hasCapability('alarm_water') && this.getCapabilityValue('alarm_water')) {
        await this.setCapabilityValue('alarm_water', false).catch(this.error);
        this.homey.flow.getDeviceTriggerCard('alarm_water_cleared').trigger(this).catch(this.error);
      }
    }
    if (alarmType === 'all' || alarmType === 'micro_leak') {
      if (this.hasCapability('alarm_micro_leak') && this.getCapabilityValue('alarm_micro_leak')) {
        await this.setCapabilityValue('alarm_micro_leak', false).catch(this.error);
      }
    }
    if (alarmType === 'all' || alarmType === 'frost') {
      if (this.hasCapability('alarm_frost') && this.getCapabilityValue('alarm_frost')) {
        await this.setCapabilityValue('alarm_frost', false).catch(this.error);
      }
    }

    // Acknowledge in Grohe Cloud & send silence buzzer command
    if (toAcknowledge.length > 0) {
      this.api.acknowledgeNotifications(this.locationId, this.roomId, this.applianceId, toAcknowledge)
        .catch((err) => this.error('Failed to acknowledge notifications in Grohe Cloud:', err.message));
    }
    this.api.silenceAlarmCommand(this.locationId, this.roomId, this.applianceId)
      .catch((err) => this.error('Failed to send silence alarm command to Grohe Cloud:', err.message));

    return true;
  }
  /**
   * Helper to update water temperature
   */
  updateTemperature(val) {
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (typeof num !== 'number' || isNaN(num)) return;
    const temp = Math.round(num * 10) / 10;
    this.log(`Received water temperature: ${temp} °C`);
    this.setCapabilityValue('measure_temperature', temp).catch(this.error);
  }

  /**
   * Helper to update water pressure
   */
  updatePressure(val) {
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (typeof num !== 'number' || isNaN(num)) return;
    const pressureVal = Math.round(num * 100) / 100;
    this.setCapabilityValue('measure_pressure', pressureVal).catch(this.error);
    if (this.lastKnownPressure !== pressureVal) {
      this.lastKnownPressure = pressureVal;
      this.homey.flow.getDeviceTriggerCard('pressure_changed')
        .trigger(this, { pressure: pressureVal })
        .catch(this.error);
    }
  }

  /**
   * Helper to update water flow rate
   */
  updateFlowRate(val) {
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (typeof num !== 'number' || isNaN(num)) return;
    const flow = Math.round(num * 100) / 100;
    this.setCapabilityValue('measure_water_flow', flow).catch(this.error);
  }

  /**
   * Sync measurements: temperature, pressure, flow rate, water consumption
   */
  async syncMeasurements() {
    try {
      const todayStr = new Date().toISOString().split('T')[0];

      // 1. Fetch latest real-time appliance info (contains data_latest)
      const infoRes = await this.api.getApplianceInfo(this.locationId, this.roomId, this.applianceId).catch((err) => {
        this.error('Error fetching appliance info:', err.message);
        return null;
      });

      const appliance = Array.isArray(infoRes) ? infoRes[0] : infoRes;
      if (appliance && appliance.data_latest) {
        const meas = appliance.data_latest.measurement || appliance.data_latest;
        if (meas) {
          const temp = typeof meas.temperature_guard === 'number' ? meas.temperature_guard : meas.temperature;
          this.updateTemperature(temp);
          this.updatePressure(meas.pressure);
          this.updateFlowRate(meas.flowrate || meas.flow_rate);
        }
      }

      // 2. Fetch appliance status (battery, wifi, temperature/pressure status params)
      const statusRes = await this.api.getApplianceStatus(this.locationId, this.roomId, this.applianceId).catch(() => null);
      if (Array.isArray(statusRes)) {
        for (const s of statusRes) {
          if (s.type === 'temperature_guard' || s.type === 'temperature') {
            this.updateTemperature(s.value);
          } else if (s.type === 'pressure') {
            this.updatePressure(s.value);
          } else if (s.type === 'flowrate') {
            this.updateFlowRate(s.value);
          }
        }
      }

      // 3. Fetch today's aggregated data
      const dataToday = await this.api.getAggregatedData(this.locationId, this.roomId, this.applianceId, todayStr, todayStr).catch(() => null);
      let dayWithdrawals = 0;

      if (dataToday && dataToday.data && Array.isArray(dataToday.data.withdrawals)) {
        for (const w of dataToday.data.withdrawals) {
          dayWithdrawals += (w.waterconsumption || 0);
        }

        const latestWithdrawal = dataToday.data.withdrawals[dataToday.data.withdrawals.length - 1];
        if (latestWithdrawal) {
          const temp = typeof latestWithdrawal.temperature_guard === 'number' ? latestWithdrawal.temperature_guard : latestWithdrawal.temperature;
          this.updateTemperature(temp);
          this.updatePressure(latestWithdrawal.pressure);
          this.updateFlowRate(latestWithdrawal.flowrate);
        }
      }

      if (dataToday && dataToday.data && Array.isArray(dataToday.data.measurement)) {
        const latestMeas = dataToday.data.measurement[dataToday.data.measurement.length - 1];
        if (latestMeas) {
          const temp = typeof latestMeas.temperature_guard === 'number' ? latestMeas.temperature_guard : latestMeas.temperature;
          this.updateTemperature(temp);
          this.updatePressure(latestMeas.pressure);
          this.updateFlowRate(latestMeas.flowrate);
        }
      }

      const roundedToday = Math.round(dayWithdrawals * 10) / 10;
      this.setCapabilityValue('meter_water_today', roundedToday).catch(this.error);

      if (this.lastKnownWaterToday !== roundedToday) {
        this.lastKnownWaterToday = roundedToday;
        this.homey.flow.getDeviceTriggerCard('consumption_today_changed')
          .trigger(this, { water_today: roundedToday })
          .catch(this.error);
      }

      // Save token if updated
      this.saveLatestToken();
    } catch (err) {
      this.error('Error syncing measurements:', err.message);
    }
  }

  /**
   * Persist fresh refresh token to store if it changed
   */
  saveLatestToken() {
    const currentToken = this.auth.getRefreshToken();
    if (currentToken && currentToken !== this.getStoreValue('refreshToken')) {
      this.setStoreValue('refreshToken', currentToken).catch(this.error);
    }
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('Settings changed:', changedKeys);
    this.startPolling();
  }

  async onUninit() {
    this.log('GroheSenseGuardDevice uninitializing:', this.getName());
    this.stopPolling();
  }

  async onDeleted() {
    this.log('GroheSenseGuardDevice deleted:', this.getName());
    this.stopPolling();
  }
}

module.exports = GroheSenseGuardDevice;
