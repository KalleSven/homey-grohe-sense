'use strict';

const { REFRESH_URL, LOGIN_URL } = require('./GroheConstants');

class GroheAuth {
  constructor(logger = console) {
    this.log = logger;
    this.refreshToken = null;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.refreshPromise = null;
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
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
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
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /**
   * Performs automated login with email and password against Grohe's Keycloak SSO.
   */
  static async loginWithCredentials(email, password) {
    if (!email || !password) {
      throw new Error('Email address and password are required.');
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    // 1. GET the login page to acquire session cookies and action URL
    const getRes = await fetch(LOGIN_URL, {
      method: 'GET',
      headers,
    });

    if (!getRes.ok) {
      throw new Error(`Could not reach Grohe login page (HTTP ${getRes.status})`);
    }

    const html = await getRes.text();

    // Extract cookies
    const rawCookies = getRes.headers.getSetCookie ? getRes.headers.getSetCookie() : [getRes.headers.get('set-cookie')].filter(Boolean);
    const cookieHeader = rawCookies.map((c) => c.split(';')[0]).join('; ');

    // Extract form action URL
    const formMatch = html.match(/<form[^>]+action=["']([^"']+)["']/i);
    if (!formMatch) {
      throw new Error('Could not identify login form from Grohe Cloud.');
    }
    const actionUrl = formMatch[1].replace(/&amp;/g, '&');

    // 2. POST credentials
    const bodyParams = new URLSearchParams({
      username: email.trim(),
      password,
      rememberMe: 'on',
    });

    const postRes = await fetch(actionUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieHeader,
      },
      body: bodyParams.toString(),
    });

    const location = postRes.headers.get('location');

    // If 302 Found with redirect Location (ondus://... or https://...)
    if (location && (location.startsWith('ondus://') || location.startsWith('http'))) {
      const tokenUrl = location.replace(/^ondus:\/\//i, 'https://');
      const tokenRes = await fetch(tokenUrl, { headers });
      if (!tokenRes.ok) {
        throw new Error(`Could not retrieve token after login (HTTP ${tokenRes.status})`);
      }
      const tokenData = await tokenRes.json();
      if (!tokenData.refresh_token) {
        throw new Error('No refresh token returned from Grohe Cloud.');
      }
      return tokenData;
    }

    // If still 200, check for error message in page
    const postHtml = await postRes.text().catch(() => '');
    const errMatch = postHtml.match(/<span class="[^"]*kc-feedback-text[^"]*">([\s\S]*?)<\/span>/i)
      || postHtml.match(/<div class="[^"]*alert-danger[^"]*">([\s\S]*?)<\/div>/i);

    if (errMatch) {
      const cleanErr = errMatch[1].replace(/<[^>]+>/g, '').trim();
      throw new Error(cleanErr || 'Invalid email address or password.');
    }

    throw new Error('Login failed. Please check your credentials.');
  }

  /**
   * Resolves various user input formats (ondus:// URL, https:// URL, JSON or raw token) into a clean refresh_token.
   */
  static async resolveTokenInput(input) {
    if (!input || typeof input !== 'string') {
      throw new Error('Please provide a valid token or link.');
    }

    const trimmed = input.trim();

    // Case 1: ondus:// or https:// redirect URL
    if (trimmed.startsWith('ondus://') || trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
      const tokenUrl = trimmed.replace(/^ondus:\/\//i, 'https://');
      const res = await fetch(tokenUrl, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Homey Grohe Sense App' },
      });
      if (!res.ok) {
        throw new Error(`Could not fetch token from link (HTTP ${res.status}). Verify that the link has not expired.`);
      }
      const data = await res.json();
      if (data.refresh_token) {
        return data.refresh_token;
      }
      throw new Error('Link did not contain a valid refresh token.');
    }

    // Case 2: JSON payload pasted
    if (trimmed.startsWith('{') && trimmed.includes('refresh_token')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.refresh_token) {
          return parsed.refresh_token;
        }
      } catch (err) {
        // Fallthrough to raw token
      }
    }

    // Case 3: Raw token string
    return trimmed;
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
