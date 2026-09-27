'use strict';

const GroheDevice = require('../../lib/GroheDevice');
const { GroheAuthError } = require('../../lib/GroheAuth');
const { getLocalDateString, pickNumber } = require('../../lib/GroheUtils');

// Frost alarm hysteresis: activates at or below ON, clears at or above OFF
const FROST_ON_TEMPERATURE = 3.0;
const FROST_OFF_TEMPERATURE = 4.0;

class GroheSenseDevice extends GroheDevice {
  static ALARM_RULES_KEY = 'sense';

  async initDevice() {
    this.lastKnownTemperature = this.getCapabilityValue('measure_temperature');

    // Clean up obsolete alarm_battery capability if present on existing paired devices
    if (this.hasCapability('alarm_battery')) {
      await this.removeCapability('alarm_battery').catch(this.error);
    }

    // Frost alarm state. alarm_frost is driven by both frost notifications and the
    // measured temperature; evaluateFrostAlarm() combines them in one place.
    this.frostAlarmActive = !!this.getCapabilityValue('alarm_frost');
    this.frostFromNotification = false;
    this.frostFromTemperature = this.frostAlarmActive
      && typeof this.lastKnownTemperature === 'number'
      && this.lastKnownTemperature < FROST_OFF_TEMPERATURE;
    this.frostSilenced = false;
  }

  getPollIntervals(settings) {
    const interval = Math.max(60, (settings.poll_interval || 900)) * 1000;
    return { status: interval, measurements: interval };
  }

  /**
   * Sync notifications/alarms and appliance status (battery, temperature, humidity)
   */
  async doSyncStatusAndAlarms() {
    try {
      await this.syncNotifications();

      const statusRes = await this.api.getApplianceStatus(this.locationId, this.roomId, this.applianceId);
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

      await this.markSyncSuccess();
    } catch (err) {
      this.error('Error syncing status and alarms:', err.message);
      await this.markSyncFailure(err);
    }
  }

  /**
   * Sync measurements: temperature, humidity, battery.
   *
   * data_latest from the appliance info is the primary source. Today's aggregated data is
   * only fetched to fill in values that data_latest is missing.
   */
  async doSyncMeasurements() {
    try {
      // 1. Primary: latest real-time appliance info (data_latest)
      const infoRes = await this.api.getApplianceInfo(this.locationId, this.roomId, this.applianceId);
      const appliance = Array.isArray(infoRes) ? infoRes[0] : infoRes;
      const latest = (appliance && appliance.data_latest && (appliance.data_latest.measurement || appliance.data_latest)) || {};

      let temperature = pickNumber(latest.temperature, latest.temperature_guard);
      let humidity = pickNumber(latest.humidity);
      let battery = pickNumber(latest.battery);

      // 2. Fallback: latest aggregated measurement for today
      if (temperature === undefined || humidity === undefined || battery === undefined) {
        const today = getLocalDateString(this.homey.clock.getTimezone());
        const dataToday = await this.api.getAggregatedData(this.locationId, this.roomId, this.applianceId, today, today).catch((err) => {
          if (err instanceof GroheAuthError) throw err;
          this.error('Error fetching aggregated data:', err.message);
          return null;
        });
        const measurements = dataToday && dataToday.data && dataToday.data.measurement;
        const latestMeas = Array.isArray(measurements) ? measurements[measurements.length - 1] : null;
        if (latestMeas) {
          if (temperature === undefined) temperature = pickNumber(latestMeas.temperature, latestMeas.temperature_guard);
          if (humidity === undefined) humidity = pickNumber(latestMeas.humidity);
          if (battery === undefined) battery = pickNumber(latestMeas.battery);
        }
      }

      if (temperature !== undefined) this.updateTemperature(temperature);
      if (humidity !== undefined) this.updateHumidity(humidity);
      if (battery !== undefined) this.updateBattery(battery);

      await this.markSyncSuccess();
    } catch (err) {
      this.error('Error syncing measurements:', err.message);
      await this.markSyncFailure(err);
    }
  }

  updateFrostFromNotifications(active) {
    this.frostFromNotification = active;
    this.evaluateFrostAlarm();
  }

  async silenceFrost() {
    if (this.frostAlarmActive) {
      this.frostSilenced = true;
      this.evaluateFrostAlarm();
    }
  }

  /**
   * Single source of truth for alarm_frost. Combines frost notifications with the measured
   * temperature (with hysteresis), and keeps the alarm silenced until the frost condition clears.
   */
  evaluateFrostAlarm() {
    const temp = this.lastKnownTemperature;
    if (typeof temp === 'number') {
      if (temp <= FROST_ON_TEMPERATURE) {
        this.frostFromTemperature = true;
      } else if (temp >= FROST_OFF_TEMPERATURE) {
        this.frostFromTemperature = false;
      }
    }

    const conditionActive = this.frostFromTemperature || this.frostFromNotification;
    if (!conditionActive) {
      // Re-arm so the next frost episode alarms again
      this.frostSilenced = false;
    }

    const isFrost = conditionActive && !this.frostSilenced;
    if (isFrost === this.frostAlarmActive) return;

    this.log(`Updating alarm_frost from ${this.frostAlarmActive} to ${isFrost}`);
    this.frostAlarmActive = isFrost;
    this.setCapabilityValue('alarm_frost', isFrost).catch(this.error);
    if (isFrost) {
      this.homey.flow.getDeviceTriggerCard('alarm_frost_triggered')
        .trigger(this, { temperature: typeof temp === 'number' ? temp : 0 })
        .catch(this.error);
    }
  }

  /**
   * Helper to update ambient temperature
   */
  updateTemperature(val) {
    const num = pickNumber(val);
    if (num === undefined) return;
    const temp = Math.round(num * 10) / 10;
    this.setCapabilityValue('measure_temperature', temp).catch(this.error);
    this.lastKnownTemperature = temp;
    this.evaluateFrostAlarm();
  }

  /**
   * Helper to update relative humidity
   */
  updateHumidity(val) {
    const num = pickNumber(val);
    if (num === undefined) return;
    this.setCapabilityValue('measure_humidity', Math.round(num * 10) / 10).catch(this.error);
  }

  /**
   * Helper to update battery level
   */
  updateBattery(val) {
    const num = pickNumber(val);
    if (num === undefined) return;
    this.setCapabilityValue('measure_battery', Math.min(100, Math.max(0, Math.round(num)))).catch(this.error);
  }
}

module.exports = GroheSenseDevice;
