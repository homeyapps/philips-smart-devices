'use strict';

import https from 'https';
import crypto from 'crypto';
import { ApiClient } from '../ApiClient';
import LocalLogger from '../../core/LocalLogger';
import { JointSpacePair } from './JointSpaceDomains';

export default class JointSpaceClient extends ApiClient {

  constructor(host: string, log: LocalLogger) {
    super(
      {
        baseURL: `https://${host}:1926/6`,
        log,
        timeout: 30000,
        headers: { Connection: 'keep-alive' },
        httpsAgent: new https.Agent({
          rejectUnauthorized: false,
          keepAlive: true,
        }),
      },
    );
  }

  public async pairRequest(): Promise<JointSpacePair> {
    return this.post<unknown, JointSpacePair>('/pair/request', {
      scope: ['read', 'write', 'control'],
      device: {
        type: 'native',
        device_os: 'Linux',
        device_name: 'Homey Pro',
        id: 'homey12345',
        app_name: 'Philips Smart Devices',
        app_id: 'homeyapps.philips-smart-devices',
      },
    });
  }

  public async pairGrant(pairingData: JointSpacePair, pin: string) {
    const signature = crypto.createHmac('sha1', crypto.randomBytes(32));
    signature.update(String(pairingData.timestamp) + pin);

    await this.post<unknown, JointSpacePair>('/pair/grant', {
      auth: {
        auth_AppId: 'homeyapps.philips-smart-devices',
        pin,
        auth_timestamp: pairingData.timestamp,
        auth_signature: signature.digest('base64'),
      },
    });
  }

}
