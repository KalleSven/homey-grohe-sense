'use strict';

const Homey = require('homey');
const GroheAuth = require('./lib/GroheAuth');

const ACCOUNT_TOKENS_SETTING = 'accountTokens';

class GroheSenseApp extends Homey.App {
  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('GroheSenseApp is running...');

    this.registerFlowCards();
  }

  /**
   * Returns the shared GroheAuth for a Grohe account, creating it if needed.
   *
   * All devices on the same account share one auth instance, so a refresh token rotated
   * by one device is immediately used by the others. The latest refresh token per account
   * is persisted in app settings. `refreshToken` (from the device store) is used as the
   * initial token, or as a fallback if the current one is rejected.
   */
  getAccountAuth(accountId, refreshToken) {
    if (!this.accounts) {
      this.accounts = new Map();
    }

    let auth = this.accounts.get(accountId);
    if (!auth) {
      auth = new GroheAuth(this);
      const storedToken = (this.homey.settings.get(ACCOUNT_TOKENS_SETTING) || {})[accountId];
      auth.setRefreshToken(storedToken || refreshToken);
      auth.onRefreshTokenChanged = (token) => this.saveAccountToken(accountId, token);
      this.accounts.set(accountId, auth);
      if (!storedToken && refreshToken) {
        this.saveAccountToken(accountId, refreshToken);
      }
    }

    if (refreshToken) {
      auth.addFallbackRefreshToken(refreshToken);
    }
    return auth;
  }

  /**
   * Replaces an account's tokens with those from a fresh login (pairing or repair).
   * This also revives other devices on the same account whose token had expired.
   */
  adoptAccountAuth(accountId, freshAuth) {
    const auth = this.getAccountAuth(accountId, freshAuth.getRefreshToken());
    auth.importTokens(freshAuth);
    this.saveAccountToken(accountId, auth.getRefreshToken());
    return auth;
  }

  saveAccountToken(accountId, token) {
    const tokens = this.homey.settings.get(ACCOUNT_TOKENS_SETTING) || {};
    if (!token || tokens[accountId] === token) return;
    tokens[accountId] = token;
    this.homey.settings.set(ACCOUNT_TOKENS_SETTING, tokens);

    // Keep each device's own copy up to date too, so downgrading to a version
    // without shared accounts (<= 1.1.3) still has a valid token.
    for (const device of this.getAccountDevices(accountId)) {
      if (device.getStoreValue('refreshToken') !== token) {
        device.setStoreValue('refreshToken', token).catch(this.error);
      }
    }
  }

  getAccountDevices(accountId) {
    return Object.values(this.homey.drivers.getDrivers())
      .flatMap((driver) => driver.getDevices())
      .filter((device) => device.accountId === accountId);
  }

  /**
   * Forgets an account's tokens when no remaining device uses it.
   */
  removeAccountIfUnused(accountId, deletedDevice) {
    const inUse = this.getAccountDevices(accountId).some((device) => device !== deletedDevice);
    if (inUse) return;

    if (this.accounts) {
      this.accounts.delete(accountId);
    }
    const tokens = this.homey.settings.get(ACCOUNT_TOKENS_SETTING) || {};
    if (accountId in tokens) {
      delete tokens[accountId];
      this.homey.settings.set(ACCOUNT_TOKENS_SETTING, tokens);
    }
  }

  /**
   * Register flow action and condition listeners
   */
  registerFlowCards() {
    // --- Flow Actions ---
    this.homey.flow.getActionCard('open_valve').registerRunListener(async (args) => {
      this.log('Flow Action: open_valve on device', args.device.getName());
      // triggerCapabilityListener runs onCapabilityOnoff and updates the capability value on success,
      // so the UI reflects the change and the next poll doesn't re-trigger valve_opened/valve_closed.
      await args.device.triggerCapabilityListener('onoff', true);
      return true;
    });

    this.homey.flow.getActionCard('close_valve').registerRunListener(async (args) => {
      this.log('Flow Action: close_valve on device', args.device.getName());
      await args.device.triggerCapabilityListener('onoff', false);
      return true;
    });

    this.homey.flow.getActionCard('toggle_valve').registerRunListener(async (args) => {
      this.log('Flow Action: toggle_valve on device', args.device.getName());
      const current = !!args.device.getCapabilityValue('onoff');
      await args.device.triggerCapabilityListener('onoff', !current);
      return true;
    });

    this.homey.flow.getActionCard('refresh_data').registerRunListener(async (args) => {
      this.log('Flow Action: refresh_data on device', args.device.getName());
      if (typeof args.device.syncStatusAndAlarms === 'function') {
        await args.device.syncStatusAndAlarms();
      }
      if (typeof args.device.syncMeasurements === 'function') {
        await args.device.syncMeasurements();
      }
      return true;
    });

    this.homey.flow.getActionCard('silence_alarms').registerRunListener(async (args) => {
      this.log('Flow Action: silence_alarms on device', args.device.getName(), 'type:', args.alarm_type);
      if (typeof args.device.silenceAlarm === 'function') {
        return args.device.silenceAlarm(args.alarm_type || 'all');
      }
      return false;
    });

    // --- Flow Conditions ---
    this.homey.flow.getConditionCard('is_valve_open').registerRunListener(async (args) => {
      return !!args.device.getCapabilityValue('onoff');
    });

    this.homey.flow.getConditionCard('is_alarm_water').registerRunListener(async (args) => {
      return !!args.device.getCapabilityValue('alarm_water');
    });

    this.homey.flow.getConditionCard('is_pressure_above').registerRunListener(async (args) => {
      const current = args.device.getCapabilityValue('measure_pressure') || 0;
      return current >= (args.pressure || 0);
    });

    this.homey.flow.getConditionCard('is_alarm_micro_leak').registerRunListener(async (args) => {
      return !!args.device.getCapabilityValue('alarm_micro_leak');
    });

    this.homey.flow.getConditionCard('is_alarm_frost').registerRunListener(async (args) => {
      return !!args.device.getCapabilityValue('alarm_frost');
    });

    this.log('All Flow cards registered successfully.');
  }
}

module.exports = GroheSenseApp;
