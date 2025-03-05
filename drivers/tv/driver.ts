'use strict';

import Homey from 'homey';
import PairSession from 'homey/lib/PairSession';
import JointSpaceClient from "../../src/api/joint-space/JointSpaceClient";
import LocalLogger from "../../src/core/LocalLogger";
import {JointSpacePair} from "../../src/api/joint-space/JointSpaceDomains";

module.exports = class MyDriver extends Homey.Driver {

  async onInit() {
    this.log('MyDriver has been initialized');
  }

  async onPair(session: PairSession) {
    let jointSpaceClient: JointSpaceClient;
    let jointSpacePair: JointSpacePair;

    session.setHandler('list_devices', async () => {
      const discoveryResults = Object.values(this.getDiscoveryStrategy().getDiscoveryResults());
      const discoveredDevice = discoveryResults.map((discoveryResult) => {
        return {
          name: 'Smart TV',
          data: {
            id: discoveryResult.id,
            address: discoveryResult.address,
          },
        };
      });

      jointSpaceClient = new JointSpaceClient(discoveredDevice[0].data.address, new LocalLogger(this));
      jointSpacePair = await jointSpaceClient.pairRequest();
      return discoveredDevice;
    });
    session.setHandler('pincode', async (pincode) => {

        this.log(await jointSpaceClient.pairGrant(jointSpacePair, pincode.toString()));

      return true;
    });

    await session.showView('list_devices');
    await session.nextView();
    await session.nextView();
    await session.done();
  }

};
