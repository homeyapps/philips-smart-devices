'use strict';

import https from 'https';
import { ApiClient } from './ApiClient';
import LocalLogger from '../core/LocalLogger';
import {
  HomeyAlarmClock, SomneoPlayerSettings, SomneoRadioChannelsFrequencies, SomneoAlarm,
  SomneoAlarms,
  SomneoAlarmSchedules,
  SomneoBedtimeTrackingSettings, SomneoEvent,
  SomneoLightSettings,
  SomneoRelaxBreatheSettings,
  SomneoSensorsData,
  SomneoStatusesData,
  SomneoSunsetSettings, AlarmSettings,
} from './SomneoDomains';

export default class SomneoClient extends ApiClient {

  public readonly events = {
    wakeupOn: 'startwakeup',
    wakeupOff: 'endwakeup',
    alarmOff: 'endalarm',
    mainLightOn: 'startlight',
    mainLightOff: 'stoplight',
    nightLightOn: 'nightlighton',
    nightLightOff: 'nightlightoff',
    sunsetOn: 'startdusk',
    sunsetOff: 'enddusk',
    relaxBreatheOn: 'startrelax',
    relaxBreatheOff: 'endrelax',
    bedtimeTrackingOn: 'go2bed',
    bedtimeTrackingOff: 'endbed',
  }

  private readonly alarmDays: Record<number, string[]> = {
    0: ['tomorrow'],
    2: ['monday'],
    4: ['tuesday'],
    8: ['wednesday'],
    16: ['thursday'],
    32: ['friday'],
    64: ['saturday'],
    128: ['sunday'],
    62: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    192: ['saturday', 'sunday'],
    254: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
  };

  constructor(host: string, log: LocalLogger) {
    super(
      {
        baseURL: `https://${host}/di/v1/products/1`,
        log,
        timeout: 30000,
        headers: { Connection: 'keep-alive' },
        httpsAgent: new https.Agent({
          maxSockets: 1,
          rejectUnauthorized: false,
          keepAlive: true,
        }),
        limiter: {
          maxConcurrent: 1,
          minTime: 1100,
        },
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

  public toggleAlwaysOnDisplay(aod: boolean): Promise<SomneoStatusesData> {
    return this.put<SomneoStatusesData, SomneoStatusesData>('/wusts', { dspon: aod });
  }

  public changeDisplaySettings(aod: boolean, brightness: number): Promise<SomneoStatusesData> {
    return this.put<SomneoStatusesData, SomneoStatusesData>('/wusts', { dspon: aod, brght: brightness });
  }

  public resetDevice(): Promise<void> {
    return this.put<unknown, void>('/fac', { reset: 1 });
  }

  public toggleMainLight(enabled: boolean, brightness?: number): Promise<SomneoLightSettings> {
    if (brightness !== undefined) {
      return this.put<SomneoLightSettings, SomneoLightSettings>('/wulgt', {
        onoff: enabled,
        tempy: false,
        ngtlt: false,
        ltlvl: brightness,
      });
    }

    return this.put<SomneoLightSettings, SomneoLightSettings>('/wulgt', { onoff: enabled, tempy: false, ngtlt: false });
  }

  public changeMainLightBrightness(brightness: number): Promise<SomneoLightSettings> {
    return this.put<SomneoLightSettings, SomneoLightSettings>('/wulgt', { ltlvl: brightness });
  }

  public toggleNightLight(enabled: boolean): Promise<SomneoLightSettings> {
    return this.put<SomneoLightSettings, SomneoLightSettings>('/wulgt', { onoff: false, tempy: false, ngtlt: enabled });
  }

  public toggleSunrisePreview(enabled: boolean, colorScheme: number): Promise<SomneoLightSettings> {
    return this.put<SomneoLightSettings, SomneoLightSettings>('/wulgt', {
      onoff: enabled, tempy: enabled, ctype: colorScheme, ngtlt: false,
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

  public async getAlarms(): Promise<HomeyAlarmClock[]> {
    const alarms = await this.get<SomneoAlarms>('/wualm/aenvs');
    const times = await this.get<SomneoAlarmSchedules>('/wualm/aalms');

    return alarms.prfen.map((enabled, index) => ({
      id: index + 1,
      enabled,
      powerWakeEnabled: alarms.pwrsv[index * 3] === 255,
      time: `${times.almhr[index].toString().padStart(2, '0')}:${times.almmn[index].toString().padStart(2, '0')}`,
      repetition: this.daysIntToAlarmDays(times.daynm[index]),
    })).filter((_, index) => alarms.prfvs[index]);
  }

  public async setAlarm(alarm: HomeyAlarmClock, enabled: boolean = false, alarmSettings?: AlarmSettings): Promise<SomneoAlarm> {
    const [hour, minute] = alarm.time.split(':').map(Number);
    const alarmID = (await this.get<SomneoAlarms>('/wualm/aenvs')).prfvs.findIndex((enabled) => !enabled) + 1;

    if (alarmID === -1) {
      throw new Error('No available alarm slots');
    }

    if (alarmSettings !== undefined) {
      const powerWakeTime = new Date();
      powerWakeTime.setHours(hour);
      powerWakeTime.setMinutes(minute + alarmSettings.powerWakeTime);

      if (alarmSettings.snoozeDuration !== undefined) {
        await this.put<unknown, unknown>('/wualm', { snztm: alarmSettings.snoozeDuration });
      }

      return this.put<SomneoAlarm, SomneoAlarm>('/wualm/prfwu', {
        prfnr: alarmID,
        prfen: enabled,
        prfvs: true,
        almhr: hour,
        almmn: minute,
        daynm: this.alarmDaysToDaysInt(alarm.repetition as Record<string, boolean>),
        pwrsz: alarmSettings.powerWake ? 255 : 0,
        pszhr: powerWakeTime.getHours(),
        pszmn: powerWakeTime.getMinutes(),
        ctype: alarmSettings.sunTheme,
        curve: alarmSettings.lightIntensity,
        durat: alarmSettings.duration,
        snddv: alarmSettings.sound,
        sndch: alarmSettings.soundChannel,
        sndlv: alarmSettings.volume,
      });
    }

    return this.put<SomneoAlarm, SomneoAlarm>('/wualm/prfwu', {
      prfnr: alarmID,
      prfen: enabled,
      prfvs: true,
      almhr: hour,
      almmn: minute,
      daynm: this.alarmDaysToDaysInt(alarm.repetition as Record<string, boolean>),
    });
  }

  public toggleAlarm(enabled: boolean, id: number): Promise<SomneoAlarm> {
    return this.put<unknown, SomneoAlarm>('/wualm/prfwu', { prfnr: id, prfen: enabled });
  }

  public deleteAlarm(id: number): Promise<SomneoAlarm> {
    return this.put<unknown, SomneoAlarm>('/wualm/prfwu', { prfnr: id, prfvs: false });
  }

  public getLastEvent(): Promise<SomneoEvent> {
    return this.get<SomneoEvent>('/dataupload/event.1/data');
  }

  public togglePlayer(enabled: boolean): Promise<SomneoPlayerSettings> {
    return this.put<unknown, SomneoPlayerSettings>('/wuply', { onoff: enabled });
  }

  public changePlayerSource(source: string): Promise<SomneoPlayerSettings> {
    return this.put<unknown, SomneoPlayerSettings>('/wuply', { snddv: source });
  }

  public changePlayerVolume(volume: number): Promise<SomneoPlayerSettings> {
    return this.put<unknown, SomneoPlayerSettings>('/wuply', { sdvol: volume });
  }

  public getRadioChannelsFrequencies(): Promise<SomneoRadioChannelsFrequencies> {
    return this.get<SomneoRadioChannelsFrequencies>('/wufmp/00');
  }

  public changeRadioChannelsFrequencies(channels: SomneoRadioChannelsFrequencies): Promise<SomneoRadioChannelsFrequencies> {
    return this.put<SomneoRadioChannelsFrequencies, SomneoRadioChannelsFrequencies>('/wufmp/00', channels);
  }

  public changeRadioChannel(channel: string): Promise<SomneoPlayerSettings> {
    return this.put<unknown, SomneoPlayerSettings>('/wuply', { sndch: channel });
  }

  private daysIntToAlarmDays(daysInt: number): Record<string, boolean> {
    const allDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const activeDays = this.alarmDays[daysInt] ?? [2, 4, 8, 16, 32, 64, 128].filter((bit) => (bit & daysInt) !== 0).flatMap((bit) => this.alarmDays[bit]);

    return allDays.reduce((result, day) => {
      result[day] = activeDays.includes(day);
      return result;
    }, {} as Record<string, boolean>);
  }

  private alarmDaysToDaysInt(repetition: Record<string, boolean>): number {
    const allDays: Record<string, number> = {
      monday: 2,
      tuesday: 4,
      wednesday: 8,
      thursday: 16,
      friday: 32,
      saturday: 64,
      sunday: 128,
    };

    return Object.entries(repetition).filter(([, enabled]) => enabled).reduce((result, [day]) => result | allDays[day], 0);
  }

}
