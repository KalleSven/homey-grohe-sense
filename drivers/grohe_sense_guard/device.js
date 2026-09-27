'use strict';

const GroheDevice = require('../../lib/GroheDevice');
const { GroheAuthError } = require('../../lib/GroheAuth');
const { getLocalDateString, pickNumber } = require('../../lib/GroheUtils');

// After a valve command, Grohe Cloud may keep reporting the previous valve state for a while.
// During this window, polled valve states that disagree with Homey are ignored.
const VALVE_SETTLE_MS = 2 * 60 * 1000;

class GroheSenseGuardDevice extends GroheDevice {
  static ALARM_RULES_KEY = 'guard';

  async initDevice() {
    // Seed from stored capability values so a restart doesn't fire change triggers
    this.lastKnownPressure = this.getCapabilityValue('measure_pressure');
    this.lastKnownWaterToday = this.getCapabilityValue('meter_water_today');
    this.waterTodayDate = null;

    // Valve commands run one at a time, in order (see onCapabilityOnoff)
    this.valveQueue = Promise.resolve();
    this.valveRequestSeq = 0;
    this.valveCommandsInFlight = 0;
    this.valveCommandAt = 0;

    // Register capability listener for valve control
    this.registerCapabilityListener('onoff', this.onCapabilityOnoff.bind(this));

    // Clean up obsolete meter_water capability if present on existing paired devices
    if (this.hasCapability('meter_water')) {
      await this.removeCapability('meter_water').catch(this.error);
    }
  }

  getPollIntervals(settings) {
    return {
      status: Math.max(30, (settings.poll_interval || 60)) * 1000,
      measurements: Math.max(60, (settings.measurements_poll_interval || 300)) * 1000,
    };
  }

  /**
   * Handle onoff capability change (valve open/close).
   *
   * Commands are queued so they reach Grohe Cloud one at a time and in order. If newer
   * commands are queued while one is being sent, only the latest is sent, so rapid
   * close/open presses always end in the last requested state.
   */
  onCapabilityOnoff(value) {
    const seq = ++this.valveRequestSeq;
    this.valveCommandsInFlight += 1;
    const run = this.valveQueue
      .then(() => this.sendValveCommand(value, seq))
      .finally(() => {
        this.valveCommandsInFlight -= 1;
      });
    this.valveQueue = run.catch(() => {});
    return run;
  }

  async sendValveCommand(value, seq) {
    const label = value ? 'OPEN' : 'CLOSED';
    if (seq !== this.valveRequestSeq) {
      this.log(`Skipping valve command ${label}: superseded by a newer command`);
      return;
    }

    this.log(`Setting Grohe Sense Guard valve to: ${label}`);
    try {
      await this.api.setValveState(this.locationId, this.roomId, this.applianceId, value);
      this.valveCommandAt = Date.now();
      this.log(`Valve successfully set to ${label}`);

      // Trigger flow cards
      if (value) {
        this.homey.flow.getDeviceTriggerCard('valve_opened').trigger(this).catch(this.error);
      } else {
        this.homey.flow.getDeviceTriggerCard('valve_closed').trigger(this).catch(this.error);
      }
    } catch (err) {
      this.error(`Failed to set valve state: ${err.message}`);
      throw new Error(`Failed to control valve: ${err.message}`);
    }
  }

  /**
   * Sync valve state and notifications/alarms
   */
  async doSyncStatusAndAlarms() {
    try {
      // 1. Fetch valve state
      const commandRes = await this.api.getApplianceCommand(this.locationId, this.roomId, this.applianceId);
      if (commandRes && commandRes.command) {
        const isValveOpen = !!commandRes.command.valve_open;
        const currentOnoff = this.getCapabilityValue('onoff');

        const settling = this.valveCommandsInFlight > 0 || Date.now() - this.valveCommandAt < VALVE_SETTLE_MS;

        if (currentOnoff !== isValveOpen && settling) {
          this.log(`Ignoring polled valve state ${isValveOpen ? 'OPEN' : 'CLOSED'} while a recent valve command settles`);
        } else if (currentOnoff !== isValveOpen) {
          await this.setCapabilityValue('onoff', isValveOpen).catch(this.error);
          if (isValveOpen) {
            this.homey.flow.getDeviceTriggerCard('valve_opened').trigger(this).catch(this.error);
          } else {
            this.homey.flow.getDeviceTriggerCard('valve_closed').trigger(this).catch(this.error);
          }
        }
      }

      // 2. Fetch notifications/alarms
      await this.syncNotifications();

      await this.markSyncSuccess();
    } catch (err) {
      this.error('Error syncing status and alarms:', err.message);
      await this.markSyncFailure(err);
    }
  }

  /**
   * Turn off the buzzer, which sounds for leak alarms. Nothing is sent unless it is actually on.
   */
  async afterSilence(alarmType) {
    if (alarmType !== 'all' && alarmType !== 'water') return;
    await this.api.silenceBuzzer(this.locationId, this.roomId, this.applianceId)
      .then((sent) => sent && this.log('Buzzer turned off'))
      .catch((err) => this.error('Failed to turn off buzzer:', err.message));
  }

  /**
   * Helper to update water temperature
   */
  updateTemperature(val) {
    const num = pickNumber(val);
    if (num === undefined) return;
    const temp = Math.round(num * 10) / 10;
    this.log(`Received water temperature: ${temp} °C`);
    this.setCapabilityValue('measure_temperature', temp).catch(this.error);
  }

  /**
   * Helper to update water pressure
   */
  updatePressure(val) {
    const num = pickNumber(val);
    if (num === undefined) return;
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
    const num = pickNumber(val);
    if (num === undefined) return;
    const flow = Math.round(num * 100) / 100;
    this.setCapabilityValue('measure_water_flow', flow).catch(this.error);
  }

  /**
   * Helper to update today's water consumption
   */
  updateWaterToday(val, date) {
    const rounded = Math.round(val * 10) / 10;
    this.waterTodayDate = date;
    this.setCapabilityValue('meter_water_today', rounded).catch(this.error);
    if (this.lastKnownWaterToday !== rounded) {
      this.lastKnownWaterToday = rounded;
      this.homey.flow.getDeviceTriggerCard('consumption_today_changed')
        .trigger(this, { water_today: rounded })
        .catch(this.error);
    }
  }

  /**
   * Sync measurements: temperature, pressure, flow rate, water consumption.
   *
   * data_latest from the appliance info is the primary source for live values. The latest
   * aggregated measurement and the status endpoint are only used to fill in values that
   * data_latest is missing, so each capability is updated once per sync from the freshest data.
   */
  async doSyncMeasurements() {
    try {
      const today = getLocalDateString(this.homey.clock.getTimezone());

      // 1. Primary: latest real-time appliance info (data_latest)
      const infoRes = await this.api.getApplianceInfo(this.locationId, this.roomId, this.applianceId);
      const appliance = Array.isArray(infoRes) ? infoRes[0] : infoRes;
      const latest = (appliance && appliance.data_latest && (appliance.data_latest.measurement || appliance.data_latest)) || {};

      let temperature = pickNumber(latest.temperature_guard, latest.temperature);
      let pressure = pickNumber(latest.pressure);
      let flowRate = pickNumber(latest.flowrate, latest.flow_rate);

      // 2. Today's aggregated data (needed for consumption, fallback for live values)
      const dataToday = await this.api.getAggregatedData(this.locationId, this.roomId, this.applianceId, today, today).catch((err) => {
        if (err instanceof GroheAuthError) throw err;
        this.error('Error fetching aggregated data:', err.message);
        return null;
      });

      const measurements = dataToday && dataToday.data && dataToday.data.measurement;
      const latestMeas = Array.isArray(measurements) ? measurements[measurements.length - 1] : null;
      if (latestMeas) {
        if (temperature === undefined) temperature = pickNumber(latestMeas.temperature_guard, latestMeas.temperature);
        if (pressure === undefined) pressure = pickNumber(latestMeas.pressure);
        if (flowRate === undefined) flowRate = pickNumber(latestMeas.flowrate, latestMeas.flow_rate);
      }

      // 3. Last fallback: status endpoint, only if something is still missing
      if (temperature === undefined || pressure === undefined || flowRate === undefined) {
        const statusRes = await this.api.getApplianceStatus(this.locationId, this.roomId, this.applianceId).catch(() => null);
        if (Array.isArray(statusRes)) {
          for (const s of statusRes) {
            if ((s.type === 'temperature_guard' || s.type === 'temperature') && temperature === undefined) {
              temperature = pickNumber(s.value);
            } else if (s.type === 'pressure' && pressure === undefined) {
              pressure = pickNumber(s.value);
            } else if (s.type === 'flowrate' && flowRate === undefined) {
              flowRate = pickNumber(s.value);
            }
          }
        }
      }

      if (temperature !== undefined) this.updateTemperature(temperature);
      if (pressure !== undefined) this.updatePressure(pressure);
      if (flowRate !== undefined) this.updateFlowRate(flowRate);

      // Daily consumption: only update when we actually received today's data,
      // so a failed request doesn't drop the meter to 0 and fire a false trigger.
      if (dataToday && dataToday.data) {
        const withdrawals = Array.isArray(dataToday.data.withdrawals) ? dataToday.data.withdrawals : [];
        const total = withdrawals.reduce((sum, w) => sum + (pickNumber(w.waterconsumption) || 0), 0);
        this.updateWaterToday(total, today);
      } else if (this.waterTodayDate && this.waterTodayDate !== today) {
        // New day but no data yet: yesterday's total is no longer valid
        this.updateWaterToday(0, today);
      }

      await this.markSyncSuccess();
    } catch (err) {
      this.error('Error syncing measurements:', err.message);
      await this.markSyncFailure(err);
    }
  }
}

module.exports = GroheSenseGuardDevice;
