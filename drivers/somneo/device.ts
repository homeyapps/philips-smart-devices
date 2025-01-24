'use strict';

import Homey, { DiscoveryResultMDNSSD } from 'homey';
import { HomeyAPI, HomeyAPIV2 } from 'homey-api';
import LocalLogger from '../../src/core/LocalLogger';
import SomneoClient from '../../src/api/SomneoClient';
import { HomeyAPITypes } from '../../types';
import Alarm = HomeyAPIV2.ManagerAlarms.Alarm;
import { AlarmClock } from '../../src/api/SomneoDomains';

interface HomeyAlarmData {
  capabilityID: string;
  homeyAlarmID?: string;
}

module.exports = class SomneoDevice extends Homey.Device {

  private homeyClient?: HomeyAPITypes;
  private somneoClient?: SomneoClient;
  private localLogger: LocalLogger = new LocalLogger(this);

  private alarmsUpdateInterval?: NodeJS.Timeout;
  private functionsUpdateInterval?: NodeJS.Timeout;

  private currentRadioChannel: number = 1;

  async onAdded() {
    this.log('Somneo device has been added');
  }

  async onInit() {
    this.registerFunctionsListeners();
    this.registerRunListeners();

    this.functionsUpdateInterval = this.homey.setInterval(() => this.syncDeviceFunctions(), this.getSetting('functions_polling_frequency') * 1000);
    this.alarmsUpdateInterval = this.homey.setInterval(() => this.syncAlarms(), this.getSetting('alarms_polling_frequency') * 60000);

    await this.setStoreValue('polling_enabled', true).catch(this.error);
    this.log('Somneo device has been initialized');
  }

  async onDiscoveryAvailable(discoveryResult: DiscoveryResultMDNSSD) {
    this.homeyClient = await HomeyAPI.createAppAPI({ homey: this.homey });
    this.somneoClient = new SomneoClient(discoveryResult.address, this.localLogger);

    await this.syncDeviceFunctions();
    await this.syncAlarms();
    this.registerAlarmsListeners();
    await this.initRadioChannelsSettings();

    this.log('Discovery available');
  }

  async onDiscoveryAddressChanged(discoveryResult: DiscoveryResultMDNSSD) {
    await this.onDiscoveryAvailable(discoveryResult);
  }

  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }) {
    if (changedKeys.includes('display_always_on') || changedKeys.includes('display_brightness')) {
      await this.somneoClient?.changeDisplaySettings(
        Boolean(newSettings.display_always_on),
        Number(newSettings.display_brightness),
      ).catch(this.error);
    }

    if (changedKeys.includes('functions_polling_frequency')) {
      this.homey.clearInterval(this.functionsUpdateInterval);
      this.functionsUpdateInterval = this.homey.setInterval(() => this.syncDeviceFunctions(), this.getSetting('functions_polling_frequency') * 1000);
    }
    if (changedKeys.includes('alarms_polling_frequency')) {
      this.homey.clearInterval(this.alarmsUpdateInterval);
      this.alarmsUpdateInterval = this.homey.setInterval(() => this.syncAlarms(), this.getSetting('alarms_polling_frequency') * 60000);
    }

    if (changedKeys.includes('application_alarms_sync') && newSettings.application_alarms_sync) {
      await this.syncSomneoAlarms();
    }

    if (changedKeys.includes('sunrise_preview')) {
      await this.somneoClient?.toggleSunrisePreview(
        Boolean(newSettings.sunrise_preview),
        Number(newSettings.sunrise_color_scheme),
      ).catch(this.error);
    } else if (changedKeys.includes('sunrise_color_scheme') && Boolean(this.getSetting('sunrise_preview'))) {
      await this.somneoClient?.toggleSunrisePreview(false, 0).catch(this.error);
      this.homey.setTimeout(async () => {
        await this.somneoClient?.toggleSunrisePreview(true, Number(newSettings.sunrise_color_scheme)).catch(this.error);
      }, 5000);
    }

    if (changedKeys.some((key) => key.startsWith('frequency_ch'))) {
      await this.somneoClient?.changeRadioChannelsFrequencies({
        1: newSettings.frequency_ch1?.toString(),
        2: newSettings.frequency_ch2?.toString(),
        3: newSettings.frequency_ch3?.toString(),
        4: newSettings.frequency_ch4?.toString(),
        5: newSettings.frequency_ch5?.toString(),
      }).catch(this.error);
    }

    this.log('Somneo device settings were changed');
  }

  async onDeleted() {
    this.homey.clearInterval(this.alarmsUpdateInterval);
    this.homey.clearInterval(this.functionsUpdateInterval);

    await this.unsetStoreValue('alarmsIDs').catch(this.error);
    this.log('Somneo device has been deleted');
  }

  private async initRadioChannelsSettings() {
    const somneoRadioChannels = await this.somneoClient!.getRadioChannelsFrequencies();

    await this.setSettings({
      frequency_ch1: Number(somneoRadioChannels['1']),
      frequency_ch2: Number(somneoRadioChannels['2']),
      frequency_ch3: Number(somneoRadioChannels['3']),
      frequency_ch4: Number(somneoRadioChannels['4']),
      frequency_ch5: Number(somneoRadioChannels['5']),
    });

    this.log('Radio channels settings initialized');
  }

  private async syncDeviceFunctions() {
    try {
      if (!this.somneoClient) {
        await this.setUnavailable('Device not responding, please restart the application or device.');
        return;
      }

      if (!this.getAvailable()) {
        await this.setAvailable();
      }

      await this.syncSensors();

      const lightSettings = await this.somneoClient.getLightSettings();
      await Promise.all([
        this.setCapabilityValue('dim', lightSettings.ltlvl),
        this.setCapabilityValue('onoff.mainlight', lightSettings.onoff && !lightSettings.tempy),
        this.setCapabilityValue('onoff.nightlight', lightSettings.ngtlt),
        this.setSettings({ sunrise_preview: lightSettings.onoff && lightSettings.tempy }),
      ]);

      const lastEvent = await this.somneoClient.getLastEvent();
      const eventsSpecification: Record<string, Array<[string, boolean]>> = {
        [this.somneoClient.events.wakeupOn]: [['alarmclock_state.sunrise', true]],
        [this.somneoClient.events.wakeupOff]: [['alarmclock_state.sunrise', false], ['alarmclock_state.alarm', true]],
        [this.somneoClient.events.alarmOff]: [['alarmclock_state.alarm', false]],
        [this.somneoClient.events.mainLightOn]: [['onoff.mainlight', true]],
        [this.somneoClient.events.mainLightOff]: [['onoff.mainlight', false]],
        [this.somneoClient.events.nightLightOn]: [['onoff.nightlight', true]],
        [this.somneoClient.events.nightLightOff]: [['onoff.nightlight', false]],
        [this.somneoClient.events.sunsetOn]: [['onoff.sunset', true]],
        [this.somneoClient.events.sunsetOff]: [['onoff.sunset', false]],
        [this.somneoClient.events.relaxBreatheOn]: [['onoff.relax_breathe', true]],
        [this.somneoClient.events.relaxBreatheOff]: [['onoff.relax_breathe', false]],
        [this.somneoClient.events.bedtimeTrackingOn]: [['onoff.bedtime_tracking', true]],
        [this.somneoClient.events.bedtimeTrackingOff]: [['onoff.bedtime_tracking', false]],
      };

      if (lastEvent.event in eventsSpecification) {
        const eventCapability = eventsSpecification[lastEvent.event];
        for (const [capability, value] of eventCapability) {
          await this.setCapabilityValue(capability, value);
        }
        this.log('Last event name:', lastEvent.event);
      } else {
        this.log('Unnecessary event name:', lastEvent.event);
      }

      this.log('Device functions synchronised');
    } catch (error) {
      this.error('Error syncing device functions:', error);
    }
  }

  private async syncSensors() {
    try {
      const somneoSensorsData = await this.somneoClient!.getSensors();
      await Promise.all([
        this.setCapabilityValue('measure_temperature', somneoSensorsData.mstmp),
        this.setCapabilityValue('measure_humidity', somneoSensorsData.msrhu),
        this.setCapabilityValue('measure_luminance', somneoSensorsData.mslux),
        this.setCapabilityValue('measure_noise', somneoSensorsData.mssnd),
      ]);

      this.log('Sensors synchronised');
    } catch (error) {
      this.error('Error syncing sensors:', error);
    }
  }

  private async syncAlarms() {
    if (this.somneoClient === undefined) {
      return;
    }

    await this.syncSomneoAlarms();
    if (this.getSetting('application_alarms_sync')) {
      await this.syncHomeyAlarms();
    }
  }

  private async syncSomneoAlarms() {
    const somneoAlarms = await this.somneoClient!.getAlarms();
    if (!somneoAlarms.length) {
      return;
    }

    const alarmsIDs = new Map(
      Object.entries(this.getStoreValue('alarmsIDs') || {}).map(([key, value]) => [Number(key), value as HomeyAlarmData]),
    );

    let storeAlarmsIDsChanged = false;
    const somneoAlarmsIDs = somneoAlarms.map((alarm) => alarm.id);

    await Promise.all(Array.from(alarmsIDs.entries())
      .filter(([somneoAlarmID]) => !somneoAlarmsIDs.includes(somneoAlarmID))
      .map(async ([somneoAlarmID, homeyAlarmData]) => {
        if (this.hasCapability(homeyAlarmData.capabilityID)) {
          await this.removeCapability(homeyAlarmData.capabilityID).catch(this.error);
        }

        if (homeyAlarmData.homeyAlarmID !== undefined) {
          await this.homeyClient!.alarms.deleteAlarm({ id: homeyAlarmData.homeyAlarmID })
            .then(() => this.log(`Alarm '${homeyAlarmData.homeyAlarmID}' was removed from Homey application`))
            .catch(() => this.log(`Alarm '${homeyAlarmData.homeyAlarmID}' no more exists`));
        }

        alarmsIDs.delete(somneoAlarmID);
        storeAlarmsIDsChanged = true;
      }));

    for (const somneoAlarm of somneoAlarms) {
      const homeyAlarmData = alarmsIDs.get(somneoAlarm.id);
      const title = somneoAlarm.powerWakeEnabled ? `${somneoAlarm.time} ⏰` : somneoAlarm.time;

      if (homeyAlarmData !== undefined) {
        await this.setCapabilityOptions(homeyAlarmData.capabilityID, { title }).catch(this.error);
        await this.setCapabilityValue(homeyAlarmData.capabilityID, somneoAlarm.enabled).catch(this.error);

        if (this.getSetting('application_alarms_sync')) {
          if (homeyAlarmData.homeyAlarmID !== undefined) {
            try {
              await this.homeyClient!.alarms.updateAlarm({
                id: `${homeyAlarmData.homeyAlarmID}`,
                alarm: {
                  time: somneoAlarm.time,
                  enabled: somneoAlarm.enabled,
                  repetition: somneoAlarm.repetition,
                },
              });
            } catch (error) {
              await this.removeCapability(homeyAlarmData.capabilityID).catch(this.error);
              await this.somneoClient!.deleteAlarm(somneoAlarm.id);
              this.log(`Alarm '${homeyAlarmData.homeyAlarmID}' was removed from Somneo device`);

              alarmsIDs.delete(somneoAlarm.id);
              storeAlarmsIDsChanged = true;
            }
          } else {
            await this.createHomeyAlarm(alarmsIDs.get(somneoAlarm.id)!, somneoAlarm);
            storeAlarmsIDsChanged = true;
          }
        }
      } else {
        const capabilityID = `onoff_alarmclock.${somneoAlarm.id}`;
        await this.addCapability(capabilityID).catch(this.error);
        await this.setCapabilityOptions(capabilityID, { title }).catch(this.error);
        this.registerAlarmListener(capabilityID);

        alarmsIDs.set(somneoAlarm.id, { capabilityID });
        storeAlarmsIDsChanged = true;

        if (this.getSetting('application_alarms_sync')) {
          await this.createHomeyAlarm(alarmsIDs.get(somneoAlarm.id)!, somneoAlarm);
        }
      }
    }

    if (storeAlarmsIDsChanged) {
      await this.setStoreValue('alarmsIDs', Object.fromEntries(alarmsIDs)).catch(this.error);
    }

    this.log('Somneo alarms synchronised');
  }

  private async createHomeyAlarm(homeyAlarmData: HomeyAlarmData, somneoAlarm: AlarmClock) {
    const alarmName = `${this.getSetting('alarms_sync_name')} #${somneoAlarm.id}`;
    const homeyAlarm = (<Alarm> await this.homeyClient!.alarms.createAlarm({
      alarm: {
        name: alarmName,
        time: somneoAlarm.time,
        enabled: somneoAlarm.enabled,
        repetition: somneoAlarm.repetition,
      },
    }));

    homeyAlarmData.homeyAlarmID = homeyAlarm.id;
    await this.homey.notifications.createNotification({ excerpt: `Alarm **${alarmName}** was created` }).catch(this.error);
    this.log(`Alarm '${homeyAlarm.id}' was added to Homey application`);
  }

  private async syncHomeyAlarms() {
    const homeyAlarms = await this.homeyClient!.alarms.getAlarms();
    if (!homeyAlarms) {
      return;
    }

    const alarmsIDs = new Map(
      Object.entries(this.getStoreValue('alarmsIDs') || {}).map(([key, value]) => [Number(key), value as HomeyAlarmData]),
    );

    let storeAlarmsIDsChanged = false;
    const alarmsSyncName = this.getSetting('alarms_sync_name');
    const homeyAlarmsIDs = Array.from(alarmsIDs.values()).map((homeyAlarmData) => homeyAlarmData.homeyAlarmID);

    await Promise.all(Object.values(homeyAlarms).map((homeyAlarm) => homeyAlarm as Alarm)
      .filter((homeyAlarm) => !homeyAlarmsIDs.includes(homeyAlarm.id))
      .filter((homeyAlarm) => homeyAlarm.name.includes(alarmsSyncName))
      .map(async (homeyAlarm) => {
        await this.somneoClient!.setAlarm({
          id: -1,
          time: homeyAlarm.time,
          repetition: homeyAlarm.repetition,
        }, homeyAlarm.enabled).then(async (somneoAlarm) => {
          const capabilityID = `onoff_alarmclock.${somneoAlarm.prfnr}`;

          await this.addCapability(capabilityID).catch(this.error);
          await this.setCapabilityOptions(capabilityID, { title: homeyAlarm.time }).catch(this.error);
          await this.setCapabilityValue(capabilityID, homeyAlarm.enabled).catch(this.error);
          this.registerAlarmListener(capabilityID);

          alarmsIDs.set(somneoAlarm.prfnr, { capabilityID, homeyAlarmID: homeyAlarm.id });
          storeAlarmsIDsChanged = true;
          this.log(`Alarm '${alarmsSyncName} #${somneoAlarm.prfnr}' was created`);
        }).catch(async (error) => {
          this.log(error);
          await this.setWarning('Maximum count of alarms is 16').catch(this.error);
          await this.unsetWarning().catch(this.error);
        });
      }));

    if (storeAlarmsIDsChanged) {
      await this.setStoreValue('alarmsIDs', Object.fromEntries(alarmsIDs)).catch(this.error);
    }

    this.log('Homey alarms synchronised');
  }

  private registerFunctionsListeners() {
    this.registerMultipleCapabilityListener(['onoff.mainlight', 'dim'], async ({ 'onoff.mainlight': onoff, dim }) => {
      try {
        let lightSettings;

        if (dim > 0) {
          lightSettings = await this.somneoClient!.toggleMainLight(true, dim);
        } else {
          lightSettings = await this.somneoClient!.toggleMainLight(onoff);
        }

        await this.setCapabilityValue('onoff.mainlight', lightSettings.onoff);
      } catch (error) {
        this.error('Error toggling main light:', error);
      }
    });

    this.registerCapabilityListener('onoff.nightlight', async (value) => {
      try {
        await this.setCapabilityValue('onoff.nightlight', (await this.somneoClient!.toggleNightLight(value)).ngtlt);
      } catch (error) {
        this.error('Error toggling night light:', error);
      }
    });

    this.registerCapabilityListener('onoff.sunset', async (value) => {
      try {
        const settings = this.getSettings();
        const ambientSoundType = Number.isNaN(Number(settings.sunset_ambient_sound)) ? settings.sunset_ambient_sound : 'dus';
        const ambientSoundChannel = ambientSoundType === 'fmr' ? settings.sunset_ambient_radio_channel : settings.sunset_ambient_sound;

        const sunsetSettings = await this.somneoClient!.toggleSunset({
          durat: settings.sunset_duration,
          onoff: value,
          curve: settings.sunset_light_intensity,
          ctype: settings.sunset_color_scheme,
          snddv: ambientSoundType,
          sndch: ambientSoundChannel,
          sndlv: settings.sunset_ambient_volume,
        });
        await this.setCapabilityValue('onoff.sunset', sunsetSettings.onoff);
      } catch (error) {
        this.error('Error toggling sunset:', error);
      }
    });

    this.registerCapabilityListener('onoff.relax_breathe', async (value) => {
      try {
        const settings = this.getSettings();
        const relaxBreatheSettings = await this.somneoClient!.toggleRelaxBreathe({
          durat: settings.relax_duration,
          onoff: value,
          progr: settings.relax_breathing_pace - 3,
          rtype: settings.relax_guidance_type,
          intny: settings.relax_light_intensity,
          sndlv: settings.relax_sound_intensity,
        });
        await this.setCapabilityValue('onoff.relax_breathe', relaxBreatheSettings.onoff);
      } catch (error) {
        this.error('Error toggling RelaxBreathe:', error);
      }
    });

    this.registerCapabilityListener('onoff.bedtime_tracking', async (value) => {
      try {
        await this.setCapabilityValue('onoff.bedtime_tracking', (await this.somneoClient!.toggleBedtimeTracking(value)).night);
      } catch (error) {
        this.error('Error toggling bedtime tracking:', error);
      }
    });

    this.registerCapabilityListener('media_input', async (value) => {
      try {
        await this.setCapabilityValue('media_input', (await this.somneoClient!.changePlayerSource(value)).snddv);

        if (value === 'aux') {
          await this.setCapabilityValue('speaker_track', '');
          await this.setCapabilityValue('speaker_artist', '');
        }
      } catch (error) {
        this.error('Error changing player source:', error);
      }
    });

    this.registerCapabilityListener('volume_set', async (value) => {
      try {
        await this.setCapabilityValue('volume_set', (await this.somneoClient!.changePlayerVolume(value)).sdvol);
      } catch (error) {
        this.error('Error changing player volume:', error);
      }
    });

    this.registerCapabilityListener('speaker_playing', async (value) => {
      try {
        if (this.getCapabilityValue('media_input') === null) {
          await this.setWarning('First select the media input source').catch(this.error);
          await this.unsetWarning().catch(this.error);
          await this.setCapabilityValue('speaker_playing', false);
          return;
        }

        const settings = this.getSettings();
        const playerSettings = await this.somneoClient!.togglePlayer(value);

        await this.setCapabilityValue('speaker_playing', playerSettings.onoff);
        if (this.getCapabilityValue('media_input') === 'fmr') {
          this.currentRadioChannel = Number(playerSettings.sndch);

          await this.setCapabilityValue('speaker_track', settings[`name_ch${playerSettings.sndch}`]);
          await this.setCapabilityValue('speaker_artist', `${settings[`frequency_ch${playerSettings.sndch}`].toString()} FM`);
        }
      } catch (error) {
        this.error('Error toggling player:', error);
      }
    });

    this.registerCapabilityListener('speaker_next', async () => {
      try {
        if (this.getCapabilityValue('media_input') === 'fmr') {
          if (++this.currentRadioChannel > 5) {
            this.currentRadioChannel = 1;
          }

          const settings = this.getSettings();
          const playerSettings = await this.somneoClient!.changeRadioChannel(this.currentRadioChannel.toString());

          await this.setCapabilityValue('speaker_track', settings[`name_ch${playerSettings.sndch}`]);
          await this.setCapabilityValue('speaker_artist', `${settings[`frequency_ch${playerSettings.sndch}`].toString()} FM`);
        }
      } catch (error) {
        this.error('Error of next radio channel:', error);
      }
    });

    this.registerCapabilityListener('speaker_prev', async () => {
      try {
        if (this.getCapabilityValue('media_input') === 'fmr') {
          if (--this.currentRadioChannel < 1) {
            this.currentRadioChannel = 5;
          }

          const settings = this.getSettings();
          const playerSettings = await this.somneoClient!.changeRadioChannel(this.currentRadioChannel.toString());

          await this.setCapabilityValue('speaker_track', settings[`name_ch${playerSettings.sndch}`]);
          await this.setCapabilityValue('speaker_artist', `${settings[`frequency_ch${playerSettings.sndch}`].toString()} FM`);
        }
      } catch (error) {
        this.error('Error of prev radio channel:', error);
      }
    });

    this.registerCapabilityListener('button.force_sync', async () => {
      await this.syncAlarms();
    });

    this.registerCapabilityListener('button.polling', async () => {
      const pollingEnabled = !this.getStoreValue('polling_enabled');

      if (pollingEnabled) {
        this.functionsUpdateInterval = this.homey.setInterval(() => this.syncDeviceFunctions(), this.getSetting('functions_polling_frequency') * 1000);
        this.alarmsUpdateInterval = this.homey.setInterval(() => this.syncAlarms(), this.getSetting('alarms_polling_frequency') * 60000);
        await this.homey.notifications.createNotification({ excerpt: `${this.getName()} polling interval enabled` });
      } else {
        this.homey.clearInterval(this.alarmsUpdateInterval);
        this.homey.clearInterval(this.functionsUpdateInterval);
        await this.homey.notifications.createNotification({ excerpt: `${this.getName()} polling interval disabled` });
      }

      await this.setStoreValue('polling_enabled', pollingEnabled).catch(this.error);
    });

    this.registerCapabilityListener('button.reset', async () => {
      try {
        await this.somneoClient!.resetDevice();
      } catch (error) {
        this.error('Error resetting device:', error);
      }
    });
  }

  private registerAlarmsListeners() {
    for (const capability of this.getCapabilities().filter((capabilityID) => /^onoff_alarmclock\.\d+$/.test(capabilityID))) {
      this.registerAlarmListener(capability);
    }
  }

  private registerAlarmListener(capabilityID: string) {
    this.registerCapabilityListener(capabilityID, async (value) => {
      try {
        const somneoAlarm = await this.somneoClient!.toggleAlarm(value, Number(capabilityID.split('.')[1]));
        const title = `${somneoAlarm.almhr.toString().padStart(2, '0')}:${somneoAlarm.almmn.toString().padStart(2, '0')}`;

        if (this.getCapabilityOptions(capabilityID).title !== title) {
          await this.setCapabilityOptions(capabilityID, { title: somneoAlarm.pwrsz === 255 ? `${title} ⏰` : title });
        }

        await this.setCapabilityValue(capabilityID, somneoAlarm.prfen);
      } catch (error) {
        this.error('Error toggling alarm:', error);
      }
    });
  }

  private registerRunListeners() {
    this.homey.flow.getConditionCard('onoff.mainlight_enabled').registerRunListener((args, state) => {
      return this.getCapabilityValue('onoff.mainlight');
    });
    this.homey.flow.getConditionCard('onoff.nightlight_enabled').registerRunListener((args, state) => {
      return this.getCapabilityValue('onoff.nightlight');
    });
    this.homey.flow.getConditionCard('onoff.sunset_enabled').registerRunListener((args, state) => {
      return this.getCapabilityValue('onoff.sunset');
    });
    this.homey.flow.getConditionCard('onoff.relax_breathe_enabled').registerRunListener((args, state) => {
      return this.getCapabilityValue('onoff.relax_breathe');
    });
    this.homey.flow.getConditionCard('onoff.bedtime_tracking_enabled').registerRunListener((args, state) => {
      return this.getCapabilityValue('onoff.bedtime_tracking');
    });
    this.homey.flow.getConditionCard('onoff.alarm_sunrise_enabled').registerRunListener((args, state) => {
      return this.getCapabilityValue('alarmclock_state.sunrise');
    });
    this.homey.flow.getConditionCard('onoff.alarm_enabled').registerRunListener((args, state) => {
      return this.getCapabilityValue('alarmclock_state.alarm');
    });

    this.homey.flow.getActionCard('onoff.mainlight_activate').registerRunListener(async (args, state) => {
      await this.triggerCapabilityListener('onoff.mainlight', args.state === 'true').catch(this.error);
    });
    this.homey.flow.getActionCard('onoff.nightlight_activate').registerRunListener(async (args, state) => {
      await this.triggerCapabilityListener('onoff.nightlight', args.state === 'true').catch(this.error);
    });
    this.homey.flow.getActionCard('onoff.sunset_activate').registerRunListener(async (args, state) => {
      await this.triggerCapabilityListener('onoff.sunset', args.state === 'true').catch(this.error);
    });
    this.homey.flow.getActionCard('onoff.relax_breathe_activate').registerRunListener(async (args, state) => {
      await this.triggerCapabilityListener('onoff.relax_breathe', args.state === 'true').catch(this.error);
    });
    this.homey.flow.getActionCard('onoff.bedtime_tracking_activate').registerRunListener(async (args, state) => {
      await this.triggerCapabilityListener('onoff.bedtime_tracking', args.state === 'true').catch(this.error);
    });
    this.homey.flow.getActionCard('onoff.aod_activate').registerRunListener(async (args, state) => {
      await this.somneoClient?.toggleAlwaysOnDisplay(args.state === 'true').catch(this.error);
    });
  }

};
