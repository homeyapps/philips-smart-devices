'use strict';

import Homey from 'homey';

module.exports = class SomneoDriver extends Homey.Driver {

  async onInit() {
    this.log('Somneo driver has been initialized');
  }

  async onPairListDevices() {
    const discoveryResults = Object.values(this.getDiscoveryStrategy().getDiscoveryResults());
    const isOneDevice = discoveryResults.length <= 1;

    return discoveryResults.map((discoveryResult) => {
      return {
        name: `${isOneDevice ? 'Philips Somneo' : `Somneo: ip-ends with: ${discoveryResult.address}`.split('.').pop()}`,
        data: {
          id: discoveryResult.id,
          address: discoveryResult.address,
        },
      };
    });
  }

};
