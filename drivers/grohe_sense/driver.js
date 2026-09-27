'use strict';

const GroheDriver = require('../../lib/GroheDriver');
const { TYPE_SENSE, TYPE_SENSE_PLUS } = require('../../lib/GroheConstants');

class GroheSenseDriver extends GroheDriver {
  static APPLIANCE_TYPES = [TYPE_SENSE, TYPE_SENSE_PLUS];
}

module.exports = GroheSenseDriver;
