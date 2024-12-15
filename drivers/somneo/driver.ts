'use strict';

import Homey from 'homey';

module.exports = class SomneoDriver extends Homey.Driver {

  async onInit() {
    this.log('SomneoDriver has been initialized');
  }

  async onPairListDevices() {
    const discoveryResults = this.getDiscoveryStrategy().getDiscoveryResults();

    return Object.values(discoveryResults).map((discoveryResult) => {
      return {
        name: 'Philips Somneo',
        data: {
          id: discoveryResult.id,
        },
      };
    });
  }

};
