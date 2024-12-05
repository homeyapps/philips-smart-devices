'use strict';

import Homey from 'homey';

export default class LocalLogger {

  private device: Homey.Device;

  constructor(device: Homey.Device) {
    this.device = device;
  }

  log(...args: unknown[]) {
    this.device.log(...args);
  }

  debug(...args: unknown[]) {
    this.device.log(...args);
  }

  error(...args: unknown[]) {
    this.device.error(...args);
  }

}
