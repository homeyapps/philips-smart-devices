'use strict';

import https from 'https';
import { ApiClient } from './ApiClient';
import LocalLogger from '../core/LocalLogger';
import {
  Alarm, SomneoAlarm,
  SomneoAlarms,
  SomneoAlarmSchedules,
  SomneoBedtimeTrackingSettings,
  SomneoLightSettings,
  SomneoRelaxBreatheSettings,
  SomneoSensorsData,
  SomneoStatusesData,
  SomneoSunsetSettings,
} from './Domains';

export default class PhilipsSomneoClient extends ApiClient {

  constructor(host: string, log: LocalLogger) {
    super(
      {
        baseURL: `https://${host}/di/v1/products/1`,
        log,
        httpsAgent: new https.Agent({
          secureProtocol: 'TLSv1_2_method',
          rejectUnauthorized: false,
          keepAlive: true,
        }),
      },
    );
  }

  public getSensors(): Promise<SomneoSensorsData> {
    return this.get<SomneoSensorsData>('/wusrd');
  }

  public getStatuses() : Promise<SomneoStatusesData> {
    return this.get<SomneoStatusesData>('/wusts');
  }

  public getLightSettings(): Promise<SomneoLightSettings> {
    return this.get<SomneoLightSettings>('/wulgt');
  }

  public getSunsetSettings(): Promise<SomneoSunsetSettings> {
    return this.get<SomneoSunsetSettings>('/wudsk');
  }

  public getRelaxBreatheSettings(): Promise<SomneoRelaxBreatheSettings> {
    return this.get<SomneoRelaxBreatheSettings>('/wurlx');
  }

  public getBedtimeTracking(): Promise<SomneoBedtimeTrackingSettings> {
    return this.get<SomneoBedtimeTrackingSettings>('/wungt');
  }

  public changeDisplaySettings(aod: boolean, brightness: number): Promise<SomneoStatusesData> {
    return this.put<SomneoStatusesData, SomneoStatusesData>('/wusts', { dspon: aod, brght: brightness });
  }

  public restartDevice(): Promise<SomneoStatusesData> {
    return this.put<SomneoStatusesData, SomneoStatusesData>('/wusts', { pwrsz: true });
  }

  public toggleMainLight(enabled: boolean): Promise<SomneoLightSettings> {
    return this.put<SomneoLightSettings, SomneoLightSettings>('/wulgt', { onoff: enabled, tempy: false, ngtlt: false });
  }

  public toggleNightLight(enabled: boolean): Promise<SomneoLightSettings> {
    return this.put<SomneoLightSettings, SomneoLightSettings>('/wulgt', { onoff: false, tempy: false, ngtlt: enabled });
  }

  public changeMainLightBrightness(brightness: number): Promise<SomneoLightSettings> {
    return this.put<SomneoLightSettings, SomneoLightSettings>('/wulgt', { ltlvl: brightness });
  }

  public toggleSunrisePreview(enabled: boolean, colorScheme: number): Promise<SomneoLightSettings> {
    return this.put<SomneoLightSettings, SomneoLightSettings>('/wulgt', {
      onoff: enabled, tempy: true, ctype: colorScheme, ngtlt: false,
    });
  }

  public toggleSunset(sunset: SomneoSunsetSettings): Promise<SomneoSunsetSettings> {
    return this.put<SomneoSunsetSettings, SomneoSunsetSettings>('/wudsk', sunset);
  }

  public toggleRelaxBreathe(relaxBreathe: SomneoRelaxBreatheSettings): Promise<SomneoRelaxBreatheSettings> {
    return this.put<SomneoRelaxBreatheSettings, SomneoRelaxBreatheSettings>('/wurlx', {
      durat: relaxBreathe.durat,
      onoff: relaxBreathe.onoff,
      progr: relaxBreathe.progr,
      rtype: relaxBreathe.rtype,
      ...(relaxBreathe.rtype === 0 ? { intny: relaxBreathe.intny } : { sndlv: relaxBreathe.sndlv }),
    });
  }

  public toggleBedtimeTracking(enabled: boolean): Promise<SomneoBedtimeTrackingSettings> {
    return this.put<unknown, SomneoBedtimeTrackingSettings>('/wungt', { night: enabled });
  }

  public async getAlarms(): Promise<Alarm[]> {
    const alarms = await this.get<SomneoAlarms>('/wualm/aenvs');
    const times = await this.get<SomneoAlarmSchedules>('/wualm/aalms');

    return alarms.prfen.map((enabled, index) => ({
      id: index + 1,
      enabled,
      powerWakeEnabled: alarms.pwrsv[index] === 1,
      time: `${times.almhr[index].toString().padStart(2, '0')}:${times.almmn[index].toString().padStart(2, '0')}`,
    })).filter((_, index) => alarms.prfvs[index]);
  }

  public toggleAlarm(enabled: boolean, id: number): Promise<SomneoAlarm> {
    return this.put<unknown, SomneoAlarm>('/wualm/prfwu', { prfnr: id, prfvs: enabled });
  }

}
