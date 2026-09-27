'use strict';

const GroheDriver = require('../../lib/GroheDriver');
const { TYPE_SENSE_GUARD } = require('../../lib/GroheConstants');

class GroheSenseGuardDriver extends GroheDriver {
  static APPLIANCE_TYPES = [TYPE_SENSE_GUARD];
}

module.exports = GroheSenseGuardDriver;
