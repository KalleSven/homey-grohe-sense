'use strict';

const { BASE_URL, TYPE_SENSE_GUARD, DEFAULT_APPLIANCE_NAMES } = require('./GroheConstants');
const { GroheAuthError } = require('./GroheAuth');
const { fetchWithTimeout, getNotificationId, getNotificationType } = require('./GroheUtils');

class GroheApi {
  constructor(auth, logger = console) {
    this.auth = auth;
    this.logger = logger;
  }

  async request(endpoint, options = {}) {
    const token = await this.auth.ensureToken();
    const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Homey Grohe Sense App',
      ...(options.headers || {}),
    };

    const config = {
      method: options.method || 'GET',
      headers,
      ...(options.body ? { body: typeof options.body === 'string' ? options.body : JSON.stringify(options.body) } : {}),
    };

    const response = await fetchWithTimeout(url, config);

    if (response.status === 401) {
      this.logger.log('GroheApi received 401 Unauthorized, refreshing token and retrying...');
      await this.auth.refresh();
      const retryToken = await this.auth.ensureToken();
      headers.Authorization = `Bearer ${retryToken}`;
      const retryResponse = await fetchWithTimeout(url, { ...config, headers });
      if (!retryResponse.ok) {
        const errText = await retryResponse.text().catch(() => '');
        const message = `Grohe API error (retry) ${retryResponse.status}: ${errText}`;
        throw retryResponse.status === 401 ? new GroheAuthError(message) : new Error(message);
      }
      if (retryResponse.status === 204) {
        return {};
      }
      return retryResponse.json().catch(() => ({}));
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Grohe API error ${response.status} for ${endpoint}: ${errText}`);
    }

    if (response.status === 204) {
      return {};
    }

    return response.json().catch(() => ({}));
  }

  async getLocations() {
    return this.request('/locations');
  }

  async getRooms(locationId) {
    return this.request(`/locations/${locationId}/rooms`);
  }

  async getAppliances(locationId, roomId) {
    return this.request(`/locations/${locationId}/rooms/${roomId}/appliances`);
  }

  /**
   * Discovers all appliances of the given types (e.g. [TYPE_SENSE, TYPE_SENSE_PLUS])
   * across all of the user's locations and rooms.
   */
  async discoverAppliances(types) {
    const devices = [];
    const locations = await this.getLocations();

    if (!Array.isArray(locations)) {
      return devices;
    }

    for (const location of locations) {
      const locationId = location.id;
      const locationName = location.name || 'Home';
      const rooms = await this.getRooms(locationId).catch(() => []);

      if (!Array.isArray(rooms)) continue;

      for (const room of rooms) {
        const roomId = room.id;
        const roomName = room.name || 'Room';
        const appliances = await this.getAppliances(locationId, roomId).catch(() => []);

        if (!Array.isArray(appliances)) continue;

        for (const appliance of appliances) {
          if (!types.includes(appliance.type)) continue;
          devices.push({
            locationId,
            locationName,
            roomId,
            roomName,
            applianceId: appliance.appliance_id,
            name: appliance.name || DEFAULT_APPLIANCE_NAMES[appliance.type] || 'Grohe',
            type: appliance.type,
            serialNumber: appliance.serial_number,
            version: appliance.version,
            registrationDate: appliance.registration_date,
          });
        }
      }
    }

    return devices;
  }

  async getApplianceInfo(locationId, roomId, applianceId) {
    return this.request(`/locations/${locationId}/rooms/${roomId}/appliances/${applianceId}`);
  }

  async getApplianceStatus(locationId, roomId, applianceId) {
    return this.request(`/locations/${locationId}/rooms/${roomId}/appliances/${applianceId}/status`);
  }

  async getApplianceCommand(locationId, roomId, applianceId) {
    return this.request(`/locations/${locationId}/rooms/${roomId}/appliances/${applianceId}/command`);
  }

  async setValveState(locationId, roomId, applianceId, open) {
    const payload = {
      type: TYPE_SENSE_GUARD,
      command: {
        valve_open: !!open,
      },
    };
    return this.request(`/locations/${locationId}/rooms/${roomId}/appliances/${applianceId}/command`, {
      method: 'POST',
      body: payload,
    });
  }

  async getApplianceNotifications(locationId, roomId, applianceId) {
    return this.request(`/locations/${locationId}/rooms/${roomId}/appliances/${applianceId}/notifications`);
  }

  /**
   * Marks notifications as read in Grohe Cloud, the same way the Grohe app does
   * (PUT /profile/notifications/{id}). Returns the number of notifications acknowledged.
   */
  async acknowledgeNotifications(applianceId, notifications = []) {
    let acknowledged = 0;
    for (const notif of notifications) {
      const id = getNotificationId(notif);
      if (!id) continue;
      try {
        await this.request(`/profile/notifications/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: {
            _id: 0,
            appliance_id: notif.appliance_id || applianceId,
            category: notif.category,
            eventReactionId: 0,
            id,
            is_read: true,
            location_id: 0,
            rawCategory: 0,
            timestamp: notif.timestamp,
            type: getNotificationType(notif),
          },
        });
        acknowledged += 1;
      } catch (err) {
        if (err instanceof GroheAuthError) throw err;
        this.logger.error(`GroheApi: failed to acknowledge notification ${id}: ${err.message}`);
      }
    }
    return acknowledged;
  }

  /**
   * Turns off the Sense Guard buzzer. Like the Grohe app, this reads the current command,
   * changes only buzzer_on and posts the full command back, so valve state and other
   * settings are preserved. Does nothing if the buzzer is not on.
   * Returns true if a command was sent.
   */
  async silenceBuzzer(locationId, roomId, applianceId) {
    const current = await this.getApplianceCommand(locationId, roomId, applianceId);
    if (!current || !current.command || !current.command.buzzer_on) {
      return false;
    }
    await this.request(`/locations/${locationId}/rooms/${roomId}/appliances/${applianceId}/command`, {
      method: 'POST',
      body: {
        ...current,
        commandb64: null,
        timestamp: null,
        command: { ...current.command, buzzer_on: false },
      },
    });
    return true;
  }

  async getAggregatedData(locationId, roomId, applianceId, fromDate, toDate) {
    let endpoint = `/locations/${locationId}/rooms/${roomId}/appliances/${applianceId}/data/aggregated`;
    const params = [];
    if (fromDate) {
      const fromStr = typeof fromDate === 'string' ? fromDate : fromDate.toISOString().split('T')[0];
      params.push(`from=${fromStr}`);
    }
    if (toDate) {
      const toStr = typeof toDate === 'string' ? toDate : toDate.toISOString().split('T')[0];
      params.push(`to=${toStr}`);
    }
    if (params.length > 0) {
      endpoint += `?${params.join('&')}`;
    }
    return this.request(endpoint);
  }

  async getDashboard() {
    return this.request('/dashboard');
  }
}

module.exports = GroheApi;
