'use strict';

import Homey from 'homey';

export default class LocalLogger {

  private simpleClass: Homey.SimpleClass;

  constructor(device: Homey.SimpleClass) {
    this.simpleClass = device;
  }

  log(...args: unknown[]) {
    this.simpleClass.log(...args);
  }

  debug(...args: unknown[]) {
    this.simpleClass.log(...args);
  }

  error(...args: unknown[]) {
    this.simpleClass.error(...args);
  }

}
