'use strict';

const Homey = require('homey');
const GroheAuth = require('./GroheAuth');
const GroheApi = require('./GroheApi');
const { NOTIFICATIONS, ALARM_RULES } = require('./GroheConstants');
const { getNotificationKey, getNotificationType, isNotificationUnread } = require('./GroheUtils');

const { GroheAuthError } = GroheAuth;

// Number of consecutive failed syncs before the device is marked unavailable
const MAX_CONSECUTIVE_FAILURES = 3;

// Max number of silenced notification keys kept in the device store
const MAX_STORED_ACKNOWLEDGED = 200;

/**
 * Shared base for Grohe devices: authentication, polling, availability,
 * notification-driven alarms and silencing. Subclasses implement:
 *
 * - `static ALARM_RULES_KEY`: key into ALARM_RULES ('sense' or 'guard')
 * - `initDevice()`: device-specific setup, run before polling starts
 * - `getPollIntervals(settings)`: `{ status, measurements }` in milliseconds
 * - `doSyncStatusAndAlarms()` / `doSyncMeasurements()`: the actual syncs
 *
 * and may override `updateFrostFromNotifications()`, `silenceFrost()` and `afterSilence()`.
 */
class GroheDevice extends Homey.Device {
  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log(`${this.constructor.name} initializing:`, this.getName());

    this.locationId = this.getData().locationId;
    this.roomId = this.getData().roomId;
    this.applianceId = this.getData().applianceId || this.getData().id;

    // Auth is shared by all devices on the same Grohe account (see GroheSenseApp.getAccountAuth).
    // Devices paired before this have no accountId stored, so derive it from their token.
    const storedToken = this.getStoreValue('refreshToken');
    this.accountId = this.getStoreValue('accountId')
      || GroheAuth.accountIdFromToken(storedToken)
      || `device:${this.applianceId}`;
    if (this.getStoreValue('accountId') !== this.accountId) {
      await this.setStoreValue('accountId', this.accountId).catch(this.error);
    }
    this.setAuth(this.homey.app.getAccountAuth(this.accountId, storedToken));
    this.syncPromises = {};

    // Track active alarms
    this.acknowledgedNotifications = new Set(this.getStoreValue('acknowledgedNotifications') || []);
    this.activeNotifications = [];
    this.consecutiveFailures = 0;

    // Ensure button_silence_alarm capability exists on device (for existing paired devices)
    if (!this.hasCapability('button_silence_alarm')) {
      await this.addCapability('button_silence_alarm').catch(this.error);
    }
    this.registerCapabilityListener('button_silence_alarm', async () => {
      return this.silenceAlarm('all');
    });

    await this.initDevice();

    // Start polling timers
    this.startPolling();

    // Initial sync
    this.syncStatusAndAlarms().catch((err) => this.error('Initial status sync failed:', err.message));
    this.syncMeasurements().catch((err) => this.error('Initial measurements sync failed:', err.message));
  }

  /**
   * Device-specific setup, run at the end of onInit before polling starts
   */
  async initDevice() {}

  /**
   * Use the given (shared, per-account) auth for all API calls
   */
  setAuth(auth) {
    this.auth = auth;
    this.api = new GroheApi(auth, this);
  }

  /**
   * Called by the driver after a successful repair (new Grohe login)
   */
  async onRepaired(accountId, auth) {
    this.log('Device repaired with a new Grohe login');
    const previousAccountId = this.accountId;
    this.accountId = accountId;
    await this.setStoreValue('accountId', accountId).catch(this.error);
    await this.setStoreValue('refreshToken', auth.getRefreshToken()).catch(this.error);
    this.setAuth(auth);
    this.consecutiveFailures = 0;
    if (previousAccountId && previousAccountId !== accountId) {
      this.homey.app.removeAccountIfUnused(previousAccountId, this);
    }
    await this.syncStatusAndAlarms();
    await this.syncMeasurements();
  }

  /**
   * Start polling loops for status, alarms, and measurements
   */
  startPolling(settings = this.getSettings()) {
    this.stopPolling();

    const { status, measurements } = this.getPollIntervals(settings);
    this.log(`Starting poll timers. Status: ${status / 1000}s, Measurements: ${measurements / 1000}s`);

    this.statusTimer = this.homey.setInterval(() => {
      this.syncStatusAndAlarms().catch((err) => this.error('Status sync error:', err.message));
    }, status);

    this.measurementsTimer = this.homey.setInterval(() => {
      this.syncMeasurements().catch((err) => this.error('Measurements sync error:', err.message));
    }, measurements);
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
   * Runs a sync at most once at a time. If a sync of the same kind is already running
   * (slow API, or a flow/repair triggering it), callers share the running one.
   */
  runExclusive(name, fn) {
    if (!this.syncPromises[name]) {
      this.syncPromises[name] = fn().finally(() => {
        this.syncPromises[name] = null;
      });
    }
    return this.syncPromises[name];
  }

  syncStatusAndAlarms() {
    return this.runExclusive('status', () => this.doSyncStatusAndAlarms());
  }

  syncMeasurements() {
    return this.runExclusive('measurements', () => this.doSyncMeasurements());
  }

  /**
   * Fetch notifications and update alarms. On failure the error propagates and the
   * current alarm state is kept, instead of treating it as "no alarms".
   */
  async syncNotifications() {
    const notifs = await this.api.getApplianceNotifications(this.locationId, this.roomId, this.applianceId);
    if (Array.isArray(notifs)) {
      this.activeNotifications = notifs;
      this.processNotifications(this.activeNotifications);
    }
  }

  /**
   * Mark device available again after a successful sync
   */
  async markSyncSuccess() {
    this.consecutiveFailures = 0;
    if (!this.getAvailable()) {
      await this.setAvailable().catch(this.error);
    }
  }

  /**
   * Mark device unavailable on auth errors immediately, or after repeated other failures
   */
  async markSyncFailure(err) {
    if (err instanceof GroheAuthError) {
      await this.setUnavailable(this.homey.__('errors.auth_expired')).catch(this.error);
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && this.getAvailable()) {
      await this.setUnavailable(this.homey.__('errors.cloud_unreachable')).catch(this.error);
    }
  }

  getLanguage() {
    return (this.homey.i18n && typeof this.homey.i18n.getLanguage === 'function')
      ? this.homey.i18n.getLanguage()
      : 'en';
  }

  /**
   * Returns the alarm rule (see ALARM_RULES) matching a notification, or undefined
   */
  getAlarmRule(notif) {
    const type = getNotificationType(notif);
    return ALARM_RULES[this.constructor.ALARM_RULES_KEY].find((rule) => rule.category === notif.category
      && (!rule.types || rule.types.includes(type)));
  }

  describeNotification(notif, lang) {
    const type = getNotificationType(notif);
    const info = NOTIFICATIONS[notif.category]?.[type];
    return (info && info[lang]) || info?.en || `Alarm (${notif.category}/${type})`;
  }

  /**
   * Process notifications received from Grohe Cloud
   */
  processNotifications(notifications) {
    if (!Array.isArray(notifications)) return;

    // Prune acknowledged notifications that no longer exist in Grohe Cloud response
    const currentKeys = new Set(notifications.map((n) => getNotificationKey(n)));
    let pruned = false;
    for (const ackKey of this.acknowledgedNotifications) {
      if (!currentKeys.has(ackKey)) {
        this.acknowledgedNotifications.delete(ackKey);
        pruned = true;
      }
    }
    if (pruned) {
      this.persistAcknowledgedNotifications();
    }

    const lang = this.getLanguage();
    const activeAlarms = new Set();
    let waterAlarmType = '';
    let waterAlarmDesc = '';

    for (const notif of notifications) {
      // Only process unread / active notifications that haven't been silenced locally
      if (!isNotificationUnread(notif)) continue;
      if (this.acknowledgedNotifications.has(getNotificationKey(notif))) continue;

      const rule = this.getAlarmRule(notif);
      if (!rule) continue;

      activeAlarms.add(rule.alarm);
      if (rule.alarm === 'water') {
        waterAlarmType = rule.label[lang] || rule.label.en;
        waterAlarmDesc = this.describeNotification(notif, lang);
      }
    }

    // Update alarm_water
    this.updateAlarmCapability('alarm_water', activeAlarms.has('water'), () => {
      this.homey.flow.getDeviceTriggerCard('alarm_water_triggered')
        .trigger(this, { alarm_type: waterAlarmType, description: waterAlarmDesc })
        .catch(this.error);
    }, () => {
      this.homey.flow.getDeviceTriggerCard('alarm_water_cleared')
        .trigger(this)
        .catch(this.error);
    });

    // Update alarm_micro_leak
    if (this.hasCapability('alarm_micro_leak')) {
      this.updateAlarmCapability('alarm_micro_leak', activeAlarms.has('micro_leak'), () => {
        this.homey.flow.getDeviceTriggerCard('alarm_micro_leak_triggered')
          .trigger(this)
          .catch(this.error);
      });
    }

    // Update alarm_frost
    this.updateFrostFromNotifications(activeAlarms.has('frost'));
  }

  /**
   * Sets a boolean alarm capability and runs onActivate/onClear when it changes
   */
  updateAlarmCapability(capabilityId, active, onActivate, onClear) {
    const previous = !!this.getCapabilityValue(capabilityId);
    if (previous === active) return;
    this.log(`Updating ${capabilityId} from ${previous} to ${active}`);
    this.setCapabilityValue(capabilityId, active).catch(this.error);
    if (active && onActivate) onActivate();
    if (!active && onClear) onClear();
  }

  /**
   * Default frost handling: alarm_frost follows frost notifications
   */
  updateFrostFromNotifications(active) {
    this.updateAlarmCapability('alarm_frost', active, () => {
      const temperature = this.getCapabilityValue('measure_temperature') || 0;
      this.homey.flow.getDeviceTriggerCard('alarm_frost_triggered')
        .trigger(this, { temperature })
        .catch(this.error);
    });
  }

  /**
   * Silence / reset alarms locally and in Grohe Cloud
   */
  async silenceAlarm(alarmType = 'all') {
    this.log(`Silencing alarm (${alarmType}) on ${this.getName()}`);
    const toAcknowledge = [];

    for (const notif of this.activeNotifications) {
      if (!isNotificationUnread(notif)) continue;
      const rule = this.getAlarmRule(notif);
      if (alarmType === 'all' || (rule && rule.alarm === alarmType)) {
        this.acknowledgedNotifications.add(getNotificationKey(notif));
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
      await this.silenceFrost();
    }

    // Mark as read in Grohe Cloud too, so the alarm stays cleared in the Grohe app
    if (toAcknowledge.length > 0) {
      this.persistAcknowledgedNotifications();
      const acknowledged = await this.api.acknowledgeNotifications(this.applianceId, toAcknowledge).catch((err) => {
        this.error('Failed to acknowledge notifications in Grohe Cloud:', err.message);
        return 0;
      });
      this.log(`Acknowledged ${acknowledged}/${toAcknowledge.length} notification(s) in Grohe Cloud`);
    }

    await this.afterSilence(alarmType);
    return true;
  }

  /**
   * Default frost silencing: just clear the capability
   */
  async silenceFrost() {
    if (this.hasCapability('alarm_frost') && this.getCapabilityValue('alarm_frost')) {
      await this.setCapabilityValue('alarm_frost', false).catch(this.error);
    }
  }

  /**
   * Hook for device-specific silencing (e.g. turning off a buzzer)
   */
  async afterSilence(alarmType) {}

  /**
   * Persist locally silenced notifications so they stay silenced after an app restart
   */
  persistAcknowledgedNotifications() {
    const keys = [...this.acknowledgedNotifications].slice(-MAX_STORED_ACKNOWLEDGED);
    this.setStoreValue('acknowledgedNotifications', keys).catch(this.error);
  }

  async onSettings({ newSettings, changedKeys }) {
    this.log('Settings changed:', changedKeys);
    // onSettings runs before the new settings are saved, so pass them explicitly
    this.startPolling(newSettings);
  }

  async onUninit() {
    this.log(`${this.constructor.name} uninitializing:`, this.getName());
    this.stopPolling();
  }

  async onDeleted() {
    this.log(`${this.constructor.name} deleted:`, this.getName());
    this.stopPolling();
    this.homey.app.removeAccountIfUnused(this.accountId, this);
  }
}

module.exports = GroheDevice;
