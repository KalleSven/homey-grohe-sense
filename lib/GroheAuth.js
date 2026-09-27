'use strict';

const crypto = require('crypto');
const { REFRESH_URL, LOGIN_URL } = require('./GroheConstants');
const { fetchWithTimeout, assertGroheUrl, decodeJwtPayload } = require('./GroheUtils');

/**
 * Thrown when Grohe Cloud rejects our credentials (expired/revoked refresh token).
 * Retrying will not help; the user has to log in again.
 */
class GroheAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GroheAuthError';
  }
}

// After a rejected refresh token, don't hit the refresh endpoint again with the same token for this long
const AUTH_FAILURE_BACKOFF_MS = 30 * 60 * 1000;

class GroheAuth {
  constructor(logger = console) {
    this.logger = logger;
    this.refreshToken = null;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.refreshPromise = null;
    // Other known refresh tokens for the same account, tried if the current one is rejected
    this.fallbackRefreshTokens = [];
    this.failedRefreshToken = null;
    this.authFailedAt = 0;
    this.authFailureMessage = null;
    // Called with the new refresh token whenever it changes, so it can be persisted
    this.onRefreshTokenChanged = null;
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

  /**
   * Adds a refresh token to try if the current one is rejected (e.g. tokens from
   * devices paired before accounts were shared).
   */
  addFallbackRefreshToken(token) {
    const trimmed = (token || '').trim();
    if (trimmed && trimmed !== this.refreshToken && !this.fallbackRefreshTokens.includes(trimmed)) {
      this.fallbackRefreshTokens.push(trimmed);
    }
  }

  /**
   * Takes over the tokens from another (freshly logged in) GroheAuth instance.
   */
  importTokens(other) {
    const changed = other.refreshToken !== this.refreshToken;
    this.refreshToken = other.refreshToken;
    this.accessToken = other.accessToken;
    this.tokenExpiresAt = other.tokenExpiresAt;
    this.failedRefreshToken = null;
    if (changed) this.notifyRefreshTokenChanged();
  }

  notifyRefreshTokenChanged() {
    if (typeof this.onRefreshTokenChanged === 'function' && this.refreshToken) {
      try {
        this.onRefreshTokenChanged(this.refreshToken);
      } catch (err) {
        this.logger.error(`GroheAuth: failed to persist refresh token: ${err.message}`);
      }
    }
  }

  /**
   * Stable identifier for the Grohe account (the `sub` claim of the token), or null.
   */
  getAccountId() {
    return GroheAuth.accountIdFromToken(this.accessToken) || GroheAuth.accountIdFromToken(this.refreshToken);
  }

  static accountIdFromToken(token) {
    const payload = decodeJwtPayload(token);
    return (payload && (payload.sub || payload.email)) || null;
  }

  /**
   * Account id to use when the token can't be decoded: tied to this login only.
   */
  static fallbackAccountId(token) {
    return `token:${crypto.createHash('sha256').update(token || '').digest('hex').slice(0, 16)}`;
  }

  isAccessTokenValid() {
    return !!this.accessToken && Date.now() < this.tokenExpiresAt - 60000;
  }

  /**
   * Refreshes the access token using the stored refresh token. Concurrent callers share one request.
   */
  async refresh() {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      const initialRefreshToken = this.refreshToken;
      try {
        for (;;) {
          try {
            const result = await this.refreshWithCurrentToken();
            if (this.refreshToken !== initialRefreshToken) {
              this.notifyRefreshTokenChanged();
            }
            return result;
          } catch (err) {
            if (err instanceof GroheAuthError && this.fallbackRefreshTokens.length > 0) {
              this.logger.log('GroheAuth: refresh token rejected, trying another known token for this account');
              this.refreshToken = this.fallbackRefreshTokens.shift();
              continue;
            }
            throw err;
          }
        }
      } catch (err) {
        this.logger.error(`GroheAuth refresh error: ${err.message}`);
        throw err;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  async refreshWithCurrentToken() {
    if (!this.refreshToken) {
      throw new GroheAuthError('No refresh token configured.');
    }

    if (this.failedRefreshToken === this.refreshToken && Date.now() - this.authFailedAt < AUTH_FAILURE_BACKOFF_MS) {
      throw new GroheAuthError(this.authFailureMessage || 'Refresh token was rejected by Grohe Cloud.');
    }

    const response = await fetchWithTimeout(REFRESH_URL, {
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
      const message = `Token refresh failed with HTTP ${response.status}: ${errorBody}`;
      if ([400, 401, 403].includes(response.status)) {
        this.failedRefreshToken = this.refreshToken;
        this.authFailedAt = Date.now();
        this.authFailureMessage = message;
        throw new GroheAuthError(message);
      }
      throw new Error(message);
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
    this.failedRefreshToken = null;

    return {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      expiresIn,
    };
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
    const getRes = await fetchWithTimeout(LOGIN_URL, {
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
    const actionUrl = assertGroheUrl(formMatch[1].replace(/&amp;/g, '&'), getRes.url || LOGIN_URL);

    // 2. POST credentials
    const bodyParams = new URLSearchParams({
      username: email.trim(),
      password,
      rememberMe: 'on',
    });

    const postRes = await fetchWithTimeout(actionUrl, {
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
      const tokenUrl = assertGroheUrl(location.replace(/^ondus:\/\//i, 'https://'), actionUrl);
      const tokenRes = await fetchWithTimeout(tokenUrl, { headers });
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

    // Case 1: ondus:// or https:// redirect URL (must point to Grohe)
    if (/^(ondus|https?):\/\//i.test(trimmed)) {
      const tokenUrl = assertGroheUrl(trimmed.replace(/^ondus:\/\//i, 'https://'));
      const res = await fetchWithTimeout(tokenUrl, {
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
   * Logs in from the data sent by the pair/repair login view (email+password or token/link)
   * and returns an authenticated GroheAuth instance.
   */
  static async authenticate(data, logger) {
    if (!data) {
      throw new Error('Login credentials missing.');
    }

    const auth = new GroheAuth(logger);

    if (data.email && data.password) {
      logger.log('Authenticating with email & password...');
      const tokenData = await GroheAuth.loginWithCredentials(data.email, data.password);
      auth.setRefreshToken(tokenData.refresh_token);
    } else if (data.tokenInput || data.refreshToken) {
      logger.log('Authenticating with token/URL input...');
      auth.setRefreshToken(await GroheAuth.resolveTokenInput(data.tokenInput || data.refreshToken));
    } else {
      throw new Error('Please provide either email/password or a token/link.');
    }

    await auth.refresh();
    return auth;
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
module.exports.GroheAuthError = GroheAuthError;
