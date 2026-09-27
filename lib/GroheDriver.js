'use strict';

const Homey = require('homey');
const GroheAuth = require('./GroheAuth');
const GroheApi = require('./GroheApi');

const { GroheAuthError } = GroheAuth;

/**
 * Shared base for Grohe drivers: login, device discovery and repair.
 * Subclasses set `static APPLIANCE_TYPES` to the Grohe appliance types they handle.
 */
class GroheDriver extends Homey.Driver {
  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log(`${this.constructor.name} initialized`);
  }

  /**
   * Logs in with the data from the login view and returns the fresh auth plus its account id.
   */
  async loginToAccount(data) {
    const freshAuth = await GroheAuth.authenticate(data, this);
    const accountId = freshAuth.getAccountId() || GroheAuth.fallbackAccountId(freshAuth.getRefreshToken());
    return { accountId, freshAuth };
  }

  /**
   * Default device settings, taken from the driver manifest
   */
  getDefaultSettings() {
    const settings = {};
    for (const setting of this.manifest.settings || []) {
      if (setting.id && setting.value !== undefined) {
        settings[setting.id] = setting.value;
      }
    }
    return settings;
  }

  /**
   * onPair is called when a user starts the pairing process.
   */
  async onPair(session) {
    let accountId = null;
    let auth = null;
    let api = null;

    session.setHandler('login', async (data) => {
      this.log('Pairing: login requested');
      const login = await this.loginToAccount(data);
      accountId = login.accountId;
      // Share the fresh login with existing devices on the same account
      auth = this.homey.app.adoptAccountAuth(accountId, login.freshAuth);
      api = new GroheApi(auth, this);
      return true;
    });

    session.setHandler('list_devices', async () => {
      this.log('Pairing: list_devices requested');
      if (!api) {
        throw new Error('Session not authenticated.');
      }

      const appliances = await api.discoverAppliances(this.constructor.APPLIANCE_TYPES);
      this.log(`Found ${appliances.length} device(s)`);

      return appliances.map((device) => ({
        name: `${device.name} (${device.roomName})`,
        data: {
          id: device.applianceId,
          locationId: device.locationId,
          roomId: device.roomId,
          applianceId: device.applianceId,
        },
        store: {
          accountId,
          refreshToken: auth.getRefreshToken(),
          serialNumber: device.serialNumber,
          version: device.version,
          registrationDate: device.registrationDate,
          deviceType: device.type,
        },
        settings: this.getDefaultSettings(),
      }));
    });
  }

  /**
   * onRepair is called when the user repairs a device, e.g. after the Grohe login expired.
   * Logs in again and hands the new credentials to the device (and every other device
   * on the same account).
   */
  async onRepair(session, device) {
    session.setHandler('login', async (data) => {
      this.log(`Repair: login requested for ${device.getName()}`);
      const { accountId, freshAuth } = await this.loginToAccount(data);

      // Make sure the device belongs to the account the user just logged in with
      try {
        await new GroheApi(freshAuth, this).getApplianceInfo(device.locationId, device.roomId, device.applianceId);
      } catch (err) {
        if (err instanceof GroheAuthError) throw err;
        this.error('Repair: device not reachable with the new login:', err.message);
        throw new Error(this.homey.__('errors.device_not_in_account'));
      }

      const auth = this.homey.app.adoptAccountAuth(accountId, freshAuth);
      await device.onRepaired(accountId, auth);
      return 'repaired';
    });
  }
}

module.exports = GroheDriver;
