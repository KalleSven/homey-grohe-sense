'use strict';

const Homey = require('homey');
const GroheAuth = require('../../lib/GroheAuth');
const GroheApi = require('../../lib/GroheApi');
const { NOTIFICATIONS, NOTIFICATION_CATEGORY_CRITICAL, NOTIFICATION_CATEGORY_WARNING } = require('../../lib/GroheConstants');

class GroheSenseDevice extends Homey.Device {
  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('GroheSenseDevice initializing:', this.getName());

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
    this.acknowledgedNotifications = new Set();
    this.activeNotifications = [];
    this.lastKnownTemperature = null;
    this.lastKnownHumidity = null;
    this.lastKnownBattery = null;

    // Ensure button_silence_alarm capability exists on device (for existing paired devices)
    if (!this.hasCapability('button_silence_alarm')) {
      await this.addCapability('button_silence_alarm').catch(this.error);
    }
    this.registerCapabilityListener('button_silence_alarm', async () => {
      return this.silenceAlarm('all');
    });

    // Clean up obsolete alarm_battery capability if present on existing paired devices
    if (this.hasCapability('alarm_battery')) {
      await this.removeCapability('alarm_battery').catch(this.error);
    }

    // Start polling timers
    this.startPolling();

    // Initial sync
    this.syncStatusAndAlarms().catch((err) => this.error('Initial status sync failed:', err.message));
    this.syncMeasurements().catch((err) => this.error('Initial measurements sync failed:', err.message));
  }

  /**
   * Start polling loop for status, alarms, and measurements
   */
  startPolling() {
    this.stopPolling();

    const pollInterval = Math.max(60, (this.getSetting('poll_interval') || 900)) * 1000;
    this.log(`Starting Grohe Sense poll timer (${pollInterval / 1000}s)`);

    this.pollTimer = this.homey.setInterval(() => {
      this.syncStatusAndAlarms().catch((err) => this.error('Status sync error:', err.message));
      this.syncMeasurements().catch((err) => this.error('Measurements sync error:', err.message));
    }, pollInterval);
  }

  /**
   * Stop polling loop
   */
  stopPolling() {
    if (this.pollTimer) {
      this.homey.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Sync online status, notifications and alarms
   */
  async syncStatusAndAlarms() {
    try {
      // 1. Fetch notifications/alarms
      const notifs = await this.api.getApplianceNotifications(this.locationId, this.roomId, this.applianceId).catch((err) => {
        this.error('Error fetching notifications:', err.message);
        return [];
      });
      this.activeNotifications = Array.isArray(notifs) ? notifs : [];
      this.processNotifications(this.activeNotifications);

      // 2. Fetch appliance status (battery, temperature, humidity, wifi)
      const statusRes = await this.api.getApplianceStatus(this.locationId, this.roomId, this.applianceId).catch((err) => {
        this.error('Error fetching appliance status:', err.message);
        return null;
      });

      if (Array.isArray(statusRes)) {
        for (const s of statusRes) {
          if (s.type === 'battery') {
            this.updateBattery(s.value);
          } else if (s.type === 'temperature' || s.type === 'temperature_guard') {
            this.updateTemperature(s.value);
          } else if (s.type === 'humidity') {
            this.updateHumidity(s.value);
          }
        }
      }

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
    let hasFrostWarning = false;
    let hasBatteryAlarm = false;
    let primaryAlarmType = 'Water Leak';
    let primaryAlarmDesc = '';

    for (const notif of notifications) {
      const isUnread = notif.is_read === false || notif.read === false || notif.status === 0;
      if (!isUnread) continue;

      const notifKey = this.getNotificationKey(notif);
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
        primaryAlarmType = lang === 'sv' ? 'Kritiskt larm (Vatten detekterat)' : 'Critical Alarm (Water Detected)';
        primaryAlarmDesc = desc;
      } else if (category === NOTIFICATION_CATEGORY_WARNING) {
        if ([11, 12].includes(type)) {
          hasBatteryAlarm = true;
        } else if ([40, 340].includes(type)) {
          hasFrostWarning = true;
          primaryAlarmType = lang === 'sv' ? 'Frostvarning' : 'Frost Warning';
          primaryAlarmDesc = desc;
        } else if ([430, 431].includes(type)) {
          hasWaterLeak = true;
          primaryAlarmType = lang === 'sv' ? 'Vatten detekterat' : 'Water Detected';
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

    // Update alarm_frost
    const currentTemp = this.getCapabilityValue('measure_temperature');
    if (typeof currentTemp === 'number' && currentTemp <= 3.0) {
      hasFrostWarning = true;
    }

    const prevFrost = !!this.getCapabilityValue('alarm_frost');
    if (prevFrost !== hasFrostWarning) {
      this.log(`Updating alarm_frost from ${prevFrost} to ${hasFrostWarning}`);
      this.setCapabilityValue('alarm_frost', hasFrostWarning).catch(this.error);
      if (hasFrostWarning) {
        this.homey.flow.getDeviceTriggerCard('alarm_frost_triggered')
          .trigger(this, { temperature: typeof currentTemp === 'number' ? currentTemp : 0 })
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
        matches = category === NOTIFICATION_CATEGORY_CRITICAL || (category === NOTIFICATION_CATEGORY_WARNING && [430, 431].includes(type));
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
    if (alarmType === 'all' || alarmType === 'frost') {
      if (this.hasCapability('alarm_frost') && this.getCapabilityValue('alarm_frost')) {
        await this.setCapabilityValue('alarm_frost', false).catch(this.error);
      }
    }

    // Acknowledge in Grohe Cloud
    if (toAcknowledge.length > 0) {
      this.api.acknowledgeNotifications(this.locationId, this.roomId, this.applianceId, toAcknowledge)
        .catch((err) => this.error('Failed to acknowledge notifications in Grohe Cloud:', err.message));
    }

    return true;
  }

  /**
   * Helper to update ambient temperature
   */
  updateTemperature(val) {
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (typeof num !== 'number' || isNaN(num)) return;
    const temp = Math.round(num * 10) / 10;
    this.setCapabilityValue('measure_temperature', temp).catch(this.error);
    this.lastKnownTemperature = temp;

    // Check frost condition
    const isFrost = temp <= 3.0;
    const prevFrost = !!this.getCapabilityValue('alarm_frost');
    if (prevFrost !== isFrost) {
      this.setCapabilityValue('alarm_frost', isFrost).catch(this.error);
      if (isFrost) {
        this.homey.flow.getDeviceTriggerCard('alarm_frost_triggered')
          .trigger(this, { temperature: temp })
          .catch(this.error);
      }
    }
  }

  /**
   * Helper to update relative humidity
   */
  updateHumidity(val) {
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (typeof num !== 'number' || isNaN(num)) return;
    const hum = Math.round(num * 10) / 10;
    this.setCapabilityValue('measure_humidity', hum).catch(this.error);
    this.lastKnownHumidity = hum;
  }

  /**
   * Helper to update battery level
   */
  updateBattery(val) {
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (typeof num !== 'number' || isNaN(num)) return;
    const battery = Math.min(100, Math.max(0, Math.round(num)));
    this.setCapabilityValue('measure_battery', battery).catch(this.error);
    this.lastKnownBattery = battery;
  }

  /**
   * Sync measurements: temperature, humidity, battery
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
          const temp = typeof meas.temperature === 'number' ? meas.temperature : meas.temperature_guard;
          if (typeof temp === 'number') {
            this.updateTemperature(temp);
          }
          if (typeof meas.humidity === 'number') {
            this.updateHumidity(meas.humidity);
          }
          if (typeof meas.battery === 'number') {
            this.updateBattery(meas.battery);
          }
        }
      }

      // 2. Fetch today's aggregated data
      const dataToday = await this.api.getAggregatedData(this.locationId, this.roomId, this.applianceId, todayStr, todayStr).catch(() => null);
      if (dataToday && dataToday.data && Array.isArray(dataToday.data.measurement)) {
        const latestMeas = dataToday.data.measurement[dataToday.data.measurement.length - 1];
        if (latestMeas) {
          const temp = typeof latestMeas.temperature === 'number' ? latestMeas.temperature : latestMeas.temperature_guard;
          if (typeof temp === 'number') {
            this.updateTemperature(temp);
          }
          if (typeof latestMeas.humidity === 'number') {
            this.updateHumidity(latestMeas.humidity);
          }
          if (typeof latestMeas.battery === 'number') {
            this.updateBattery(latestMeas.battery);
          }
        }
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
    this.log('GroheSenseDevice uninitializing:', this.getName());
    this.stopPolling();
  }

  async onDeleted() {
    this.log('GroheSenseDevice deleted:', this.getName());
    this.stopPolling();
  }
}

module.exports = GroheSenseDevice;