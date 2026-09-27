'use strict';

const { REQUEST_TIMEOUT_MS } = require('./GroheConstants');

/**
 * Returns today's date (YYYY-MM-DD) in the given IANA timezone.
 * Falls back to UTC if the timezone is missing or unsupported.
 */
function getLocalDateString(timezone, date = new Date()) {
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date);
      const get = (type) => parts.find((p) => p.type === type)?.value;
      return `${get('year')}-${get('month')}-${get('day')}`;
    } catch (err) {
      // Unsupported timezone, fall through to UTC
    }
  }
  return date.toISOString().split('T')[0];
}

/**
 * Returns the first value that is (or parses to) a finite number, or undefined.
 */
function pickNumber(...values) {
  for (const val of values) {
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (Number.isFinite(num)) return num;
  }
  return undefined;
}

/**
 * fetch() with a timeout, so a hanging request can't block polling forever.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`Request to Grohe Cloud timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  }
}

/**
 * Parses a URL (optionally relative to `base`) and throws unless it is https on grohe.com
 * or a subdomain. Used for every URL taken from a login page, redirect or pasted link,
 * so credentials and tokens are only ever sent to Grohe.
 */
function assertGroheUrl(url, base) {
  let parsed;
  try {
    parsed = new URL(url, base);
  } catch (err) {
    throw new Error('Invalid link from Grohe Cloud.');
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || (host !== 'grohe.com' && !host.endsWith('.grohe.com'))) {
    throw new Error(`Refusing to connect to ${parsed.protocol}//${host}: only https://*.grohe.com is allowed.`);
  }
  return parsed.toString();
}

/**
 * Decodes the payload of a JWT without verifying it. Returns null if the token isn't a JWT.
 */
function decodeJwtPayload(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (err) {
    return null;
  }
}

/**
 * Notification helpers. Grohe uses both `notification_type`/`notification_id`
 * and `type`/`id` depending on endpoint, so accept either.
 */
function getNotificationType(notif) {
  return notif.notification_type ?? notif.type;
}

function getNotificationId(notif) {
  return notif.notification_id || notif.id || notif.uuid;
}

function getNotificationKey(notif) {
  return String(getNotificationId(notif) || `${notif.category}_${getNotificationType(notif)}_${notif.timestamp || notif.date || ''}`);
}

function isNotificationUnread(notif) {
  return notif.is_read === false || notif.read === false || notif.status === 0;
}

module.exports = {
  getLocalDateString,
  pickNumber,
  fetchWithTimeout,
  assertGroheUrl,
  decodeJwtPayload,
  getNotificationType,
  getNotificationId,
  getNotificationKey,
  isNotificationUnread,
};
