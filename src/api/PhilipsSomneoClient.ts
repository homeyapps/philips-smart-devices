'use strict';

import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { retryAsync } from 'ts-retry';
import {
  SomneoAlarm, SomneoAlarms, SomneoAlarmTimes, SomneoEditAlarm, SomneoStatuses,
} from './domains';
import LocalLogger from '../core/LocalLogger';

export default class PhilipsSomneoClient {

  private axiosInstance: AxiosInstance;

  constructor(public host: string, private log: LocalLogger) {
    this.axiosInstance = axios.create({
      baseURL: `https://${host}/di/v1/products/1`,
      httpsAgent: new https.Agent({
        secureProtocol: 'TLSv1_2_method',
        keepAlive: true,
        rejectUnauthorized: false,
      }),
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/json',
      },
    });
  }

  async getStatuses() : Promise<SomneoStatuses> {
    return this.getData<SomneoStatuses>('/wusts', 'SomneoStatuses');
  }

  async updateStatuses(statuses: SomneoStatuses) : Promise<void> {
    return this.putData('/wusts', 'SomneoStatuses', {
      dspon: statuses.dspon,
      brght: statuses.brght,
    });
  }

  async getAlarms(): Promise<SomneoAlarm[]> {
    const alarms = await this.getData<SomneoAlarms>('/wualm/aenvs', 'SomneoAlarms');
    const times = await this.getData<SomneoAlarmTimes>('/wualm/aalms', 'SomneoAlarmTimes');

    return alarms.prfen.map((enabled, index) => ({
      id: index + 1,
      enabled,
      powerWakeEnabled: alarms.pwrsv[index] === 1,
      time: `${times.almhr[index].toString().padStart(2, '0')}:${times.almmn[index].toString().padStart(2, '0')}`,
    })).filter((_, index) => alarms.prfvs[index]);
  }

  async toggleAlarm(id: number, enabled: boolean): Promise<SomneoEditAlarm> {
    return this.putData('/wualm/prfwu', 'SomneoEditAlarm', {
      prfnr: id,
      prfen: enabled,
    });
  }

  private async getData<T>(uri: string, type: string): Promise<T> {
    return retryAsync(() => this.axiosInstance.get(uri)
      .then((response) => response.data as T), { delay: 500, maxTry: 5 })
      .then((data) => {
        this.log.debug(`HTTPS GET -> type=${type} host=${this.host} data=${JSON.stringify(data)}`);
        return data;
      });
  }

  private async putData<T, R>(uri: string, type: string, data: T) : Promise<R> {
    return retryAsync(() => this.axiosInstance.put(uri, data)
      .then((response) => response.data as R), { delay: 500, maxTry: 5 })
      .then((response) => {
        this.log.debug(`HTTPS PUT -> type=${type} host=${this.host} request-data=${JSON.stringify(data)} response-data=${JSON.stringify(response)}`);
        return response;
      });
  }

}
