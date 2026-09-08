'use strict';

const { BASE_URL, TYPE_SENSE, TYPE_SENSE_PLUS, TYPE_SENSE_GUARD } = require('./GroheConstants');

class GroheApi {
  constructor(auth, logger = console) {
    this.auth = auth;
    this.log = logger;
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

    const response = await fetch(url, config);

    if (response.status === 401) {
      this.log.warn?.('GroheApi received 401 Unauthorized, refreshing token and retrying...');
      await this.auth.refresh();
      const retryToken = await this.auth.ensureToken();
      headers.Authorization = `Bearer ${retryToken}`;
      const retryResponse = await fetch(url, { ...config, headers });
      if (!retryResponse.ok) {
        const errText = await retryResponse.text().catch(() => '');
        throw new Error(`Grohe API error (retry) ${retryResponse.status}: ${errText}`);
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
   * Discovers all Grohe Sense Guard (type 103) devices across all user locations & rooms.
   */
  async getAllSenseGuards() {
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
          if (appliance.type === TYPE_SENSE_GUARD) {
            devices.push({
              locationId,
              locationName,
              roomId,
              roomName,
              applianceId: appliance.appliance_id,
              name: appliance.name || 'Grohe Sense Guard',
              type: appliance.type,
              serialNumber: appliance.serial_number,
              version: appliance.version,
              registrationDate: appliance.registration_date,
            });
          }
        }
      }
    }

    return devices;
  }

  /**
   * Discovers all Grohe Sense (type 101) and Sense+ (type 102) devices across all user locations & rooms.
   */
  async getAllSenseSensors() {
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
          if (appliance.type === TYPE_SENSE || appliance.type === TYPE_SENSE_PLUS) {
            devices.push({
              locationId,
              locationName,
              roomId,
              roomName,
              applianceId: appliance.appliance_id,
              name: appliance.name || (appliance.type === TYPE_SENSE_PLUS ? 'Grohe Sense+' : 'Grohe Sense'),
              type: appliance.type,
              serialNumber: appliance.serial_number,
              version: appliance.version,
              registrationDate: appliance.registration_date,
            });
          }
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
