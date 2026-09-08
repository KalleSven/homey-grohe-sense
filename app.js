'use strict';

const Homey = require('homey');

class GroheSenseApp extends Homey.App {
  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('GroheSenseApp is running...');

    this.registerFlowCards();
  }

  /**
   * Register flow action and condition listeners
   */
  registerFlowCards() {
    // --- Flow Actions ---
    this.homey.flow.getActionCard('open_valve').registerRunListener(async (args) => {
      this.log('Flow Action: open_valve on device', args.device.getName());
      if (typeof args.device.onCapabilityOnoff === 'function') {
        return args.device.onCapabilityOnoff(true);
      }
      return false;
    });

    this.homey.flow.getActionCard('close_valve').registerRunListener(async (args) => {
      this.log('Flow Action: close_valve on device', args.device.getName());
      if (typeof args.device.onCapabilityOnoff === 'function') {
        return args.device.onCapabilityOnoff(false);
      }
      return false;
    });

    this.homey.flow.getActionCard('toggle_valve').registerRunListener(async (args) => {
      this.log('Flow Action: toggle_valve on device', args.device.getName());
      if (typeof args.device.onCapabilityOnoff === 'function') {
        const current = args.device.getCapabilityValue('onoff');
        return args.device.onCapabilityOnoff(!current);
      }
      return false;
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
