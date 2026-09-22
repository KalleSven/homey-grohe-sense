'use strict';

const Homey = require('homey');
const GroheAuth = require('../../lib/GroheAuth');
const GroheApi = require('../../lib/GroheApi');

class GroheSenseDriver extends Homey.Driver {
  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('GroheSenseDriver initialized');
  }

  /**
   * onPair is called when a user starts the pairing process.
   */
  async onPair(session) {
    let pairingToken = null;
    let auth = null;
    let api = null;

    session.setHandler('login', async (data) => {
      this.log('Pairing: login requested');
      if (!data) {
        throw new Error('Login credentials missing.');
      }

      auth = new GroheAuth(this);

      // Method 1: Email + Password direct login
      if (data.email && data.password) {
        this.log('Authenticating with email & password...');
        const tokenData = await GroheAuth.loginWithCredentials(data.email, data.password);
        auth.setRefreshToken(tokenData.refresh_token);
        await auth.refresh();
      }
      // Method 2: Smart token / URL / JSON input
      else if (data.tokenInput || data.refreshToken) {
        this.log('Authenticating with token/URL input...');
        const rawInput = data.tokenInput || data.refreshToken;
        const resolvedToken = await GroheAuth.resolveTokenInput(rawInput);
        auth.setRefreshToken(resolvedToken);
        await auth.refresh();
      } else {
        throw new Error('Please provide either email/password or a token/link.');
      }

      api = new GroheApi(auth, this);
      return true;
    });

    session.setHandler('list_devices', async () => {
      this.log('Pairing: list_devices requested');
      if (!api) {
        throw new Error('Session not authenticated.');
      }

      const senseSensors = await api.getAllSenseSensors();
      this.log(`Found ${senseSensors.length} Grohe Sense device(s)`);

      return senseSensors.map((device) => {
        return {
          name: device.name ? `${device.name} (${device.roomName})` : `Grohe Sense (${device.roomName})`,
          data: {
            id: device.applianceId,
            locationId: device.locationId,
            roomId: device.roomId,
            applianceId: device.applianceId,
          },
          store: {
            refreshToken: auth.getRefreshToken(),
            serialNumber: device.serialNumber,
            version: device.version,
            registrationDate: device.registrationDate,
            deviceType: device.type,
          },
          settings: {
            poll_interval: 900,
          },
        };
      });
    });
  }
}

module.exports = GroheSenseDriver;