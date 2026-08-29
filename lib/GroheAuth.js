'use strict';

const { REFRESH_URL, LOGIN_URL } = require('./GroheConstants');

class GroheAuth {
  constructor(logger = console) {
    this.log = logger;
    this.refreshToken = null;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  setRefreshToken(token) {
    this.refreshToken = (token || '').trim();
  }

  getRefreshToken() {
    return this.refreshToken;
  }

  getAccessToken() {
    return this.accessToken;
  }

  isAccessTokenValid() {
    return !!this.accessToken && Date.now() < this.tokenExpiresAt - 60000;
  }

  /**
   * Refreshes the access token using the stored refresh token.
   */
  async refresh() {
    if (!this.refreshToken) {
      throw new Error('No refresh token configured.');
    }

    try {
      const response = await fetch(REFRESH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Homey Grohe Sense App',
        },
        body: JSON.stringify({ refresh_token: this.refreshToken }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`Token refresh failed with HTTP ${response.status}: ${errorBody}`);
      }

      const data = await response.json();
      if (!data.access_token) {
        throw new Error('No access_token received in response from Grohe Cloud.');
      }

      this.accessToken = data.access_token;
      if (data.refresh_token) {
        this.refreshToken = data.refresh_token;
      }
      const expiresIn = data.expires_in || 3600;
      this.tokenExpiresAt = Date.now() + (expiresIn * 1000);

      return {
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        expiresIn,
      };
    } catch (err) {
      this.log.error?.(`GroheAuth refresh error: ${err.message}`);
      throw err;
    }
  }

  /**
   * Ensures that a valid access token is available, refreshing if necessary.
   */
  async ensureToken() {
    if (!this.isAccessTokenValid()) {
      await this.refresh();
    }
    return this.accessToken;
  }
}

module.exports = GroheAuth;
