'use strict';

import Homey, { DiscoveryResultMDNSSD } from 'homey';
import { HomeyAPI, HomeyAPIV2 } from 'homey-api';
import Bottleneck from 'bottleneck';
import LocalLogger from '../../src/core/LocalLogger';
import SomneoClient from '../../src/api/SomneoClient';
import { HomeyAPITypes } from '../../types';
import Alarm = HomeyAPIV2.ManagerAlarms.Alarm;

module.exports = class SomneoDevice extends Homey.Device {

  private homeyClient?: HomeyAPITypes;
  private somneoClient?: SomneoClient;
  private localLogger: LocalLogger = new LocalLogger(this);

  private alarmsUpdateInterval?: NodeJS.Timeout;
  private functionsUpdateInterval?: NodeJS.Timeout;

  private limiter = new Bottleneck({
    maxConcurrent: 1,
    minTime: 1000,
  });

  async onAdded() {
    this.log('Somneo device has been added');
  }

  async onInit() {
    await this.syncDeviceFunctions();
    this.registerFunctionsListeners();
    await this.syncSomneoAlarms();
    this.registerAlarmsListeners();
    this.registerRunListeners();

    this.functionsUpdateInterval = this.homey.setInterval(() => this.syncDeviceFunctions(), this.getSetting('functions_polling_frequency') * 1000);
    this.alarmsUpdateInterval = this.homey.setInterval(() => this.syncSomneoAlarms(), this.getSetting('alarms_polling_frequency') * 60000);

    await this.setStoreValue('polling_enabled', true).catch(this.error);
    this.log('Somneo device has been initialized');
  }

  async onDiscoveryAvailable(discoveryResult: DiscoveryResultMDNSSD) {
    this.homeyClient = await HomeyAPI.createAppAPI({ homey: this.homey });
    this.somneoClient = new SomneoClient(discoveryResult.address, this.localLogger);

    await this.syncDeviceFunctions();
    await this.syncSomneoAlarms();
    this.registerAlarmsListeners();
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
      this.alarmsUpdateInterval = this.homey.setInterval(() => this.syncSomneoAlarms(), this.getSetting('alarms_polling_frequency') * 60000);
    }

    if (changedKeys.includes('alarms_device_sync') && newSettings.alarms_device_sync) {
      await this.syncSomneoAlarms();
    }

    if (changedKeys.includes('sunrise_preview')) {
      await this.somneoClient?.toggleSunrisePreview(
        Boolean(newSettings.sunrise_preview),
        Number(newSettings.sunrise_color_scheme),
      ).catch(this.error);
    } else if (changedKeys.includes('sunrise_color_scheme') && Boolean(this.getSettings().sunrise_preview)) {
      await this.somneoClient?.toggleSunrisePreview(false, 0).catch(this.error);
      this.homey.setTimeout(async () => {
        await this.somneoClient?.toggleSunrisePreview(true, Number(newSettings.sunrise_color_scheme)).catch(this.error);
      }, 5000);
    }

    this.log('Somneo device settings were changed');
  }

  async onDeleted() {
    this.homey.clearInterval(this.alarmsUpdateInterval);
    this.homey.clearInterval(this.functionsUpdateInterval);

    await this.unsetStoreValue('alarmsIDs').catch(this.error);
    this.log('Somneo device has been deleted');
  }

  async onUninit() {
    await Promise.all(this.getCapabilities()
      .filter((capabilityID) => /^onoff_alarmclock\.\d+$/.test(capabilityID))
      .map((capabilityID) => this.removeCapability(capabilityID))).catch(this.error);
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

      const lightSettings = await this.limiter.schedule(() => this.somneoClient!.getLightSettings());
      await Promise.all([
        this.setCapabilityValue('dim', lightSettings.ltlvl),
        this.setCapabilityValue('onoff.mainlight', lightSettings.onoff && !lightSettings.tempy),
        this.setCapabilityValue('onoff.nightlight', lightSettings.ngtlt),
        this.setSettings({ sunrise_preview: lightSettings.onoff && lightSettings.tempy }),
      ]);

      const lastEvent = await this.limiter.schedule(() => this.somneoClient!.getLastEvent());
      const eventsSpecification: Record<string, [string, boolean]> = {
        [this.somneoClient.events.mainLightOn]: ['onoff.mainlight', true],
        [this.somneoClient.events.mainLightOff]: ['onoff.mainlight', false],
        [this.somneoClient.events.nightLightOn]: ['onoff.nightlight', true],
        [this.somneoClient.events.nightLightOff]: ['onoff.nightlight', false],
        [this.somneoClient.events.sunsetOn]: ['onoff.sunset', true],
        [this.somneoClient.events.sunsetOff]: ['onoff.sunset', false],
        [this.somneoClient.events.relaxBreatheOn]: ['onoff.relax_breathe', true],
        [this.somneoClient.events.relaxBreatheOff]: ['onoff.relax_breathe', false],
        [this.somneoClient.events.bedtimeTrackingOn]: ['onoff.bedtime_tracking', true],
        [this.somneoClient.events.bedtimeTrackingOff]: ['onoff.bedtime_tracking', false],
      };

      if (lastEvent.event in eventsSpecification) {
        const [capability, value] = eventsSpecification[lastEvent.event];
        await this.setCapabilityValue(capability, value);
        this.log('Last event name:', lastEvent.event);
      } else {
        this.log('Unnecessary event name:', lastEvent.event);
      }

      this.log('Device functions updated');
    } catch (error) {
      this.error('Error syncing device functions:', error);
    }
  }

  private async syncSensors() {
    try {
      const somneoSensorsData = await this.limiter.schedule(() => this.somneoClient!.getSensors());
      await Promise.all([
        this.setCapabilityValue('measure_temperature', somneoSensorsData.mstmp),
        this.setCapabilityValue('measure_humidity', somneoSensorsData.msrhu),
        this.setCapabilityValue('measure_luminance', somneoSensorsData.mslux),
        this.setCapabilityValue('measure_noise', somneoSensorsData.mssnd),
      ]);

      this.log('Sensors updated');
    } catch (error) {
      this.error('Error syncing sensors:', error);
    }
  }

  private async syncSomneoAlarms() {
    await this.limiter.schedule(async () => {
      if (this.somneoClient) {
        const somneoAlarms = await this.somneoClient!.getAlarms().catch(this.error);
        const homeyAlarmsIDs: Map<number, string> = new Map(
          Object.entries(this.getStoreValue('alarmsIDs') || {}).map(([key, value]) => [Number(key), value as string]),
        );

        if (!somneoAlarms) {
          this.log('No alarms on device');
          return;
        }

        const somneoAlarmsIDs = somneoAlarms.map((alarm) => alarm.id);
        await Promise.all(this.getCapabilities().filter((capabilityID) => /^onoff_alarmclock\.\d+$/.test(capabilityID)).filter((capabilityID) => {
          return !somneoAlarmsIDs.includes(Number(capabilityID.split('.')[1]));
        }).map(async (capabilityID) => {
          await this.removeCapability(capabilityID).catch(this.error);

          const alarmID = Number(capabilityID.split('.')[1]);
          if (homeyAlarmsIDs.has(alarmID)) {
            await this.homeyClient?.alarms.deleteAlarm({ id: `${homeyAlarmsIDs.get(alarmID)}` }).catch(this.error);
            homeyAlarmsIDs.delete(alarmID);
          }
        }));

        for (const alarm of somneoAlarms) {
          const capabilityID = `onoff_alarmclock.${alarm.id}`;

          if (!this.hasCapability(capabilityID)) {
            await this.addCapability(capabilityID).catch(this.error);
            this.registerAlarmsListeners(capabilityID);
          }

          if (this.getSettings().alarms_device_sync) {
            if (!homeyAlarmsIDs.has(alarm.id)) {
              try {
                const alarmName = `${this.getSettings().alarms_generative_name} #${alarm.id}`;
                const homeyAlarm = await this.homeyClient?.alarms.createAlarm({
                  alarm: {
                    name: alarmName,
                    time: alarm.time,
                    enabled: alarm.enabled,
                    repetition: alarm.repetition,
                  },
                });

                homeyAlarmsIDs.set(alarm.id, (<Alarm> homeyAlarm).id);
                this.log(`Alarm #${alarm.id} was added in Homey application`);
                await this.homey.notifications.createNotification({ excerpt: `Alarm **${alarmName}** was created` });
              } catch (error) {
                this.error('Error Homey alarm creation:', error);
              }
            } else {
              try {
                await this.homeyClient?.alarms.updateAlarm({
                  id: `${homeyAlarmsIDs.get(alarm.id)}`,
                  alarm: {
                    time: alarm.time,
                    enabled: alarm.enabled,
                    repetition: alarm.repetition,
                  },
                });
              } catch (error) {
                this.log(`Alarm #${alarm.id} was deleted in Homey application`, error);
                homeyAlarmsIDs.delete(alarm.id);
              }
            }

            await this.setStoreValue('alarmsIDs', Object.fromEntries(homeyAlarmsIDs)).catch(this.error);
          }

          await this.setCapabilityOptions(capabilityID, { title: alarm.time }).catch(this.error);
          await this.setCapabilityValue(capabilityID, alarm.enabled).catch(this.error);
        }

        this.log('Alarms updated');
      }
    }).catch(this.error);
  }

  private registerFunctionsListeners() {
    const toggleMainLight = async (onoff: boolean, dim: number) => {
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
    };

    this.registerMultipleCapabilityListener(['onoff.mainlight', 'dim'], async ({ 'onoff.mainlight': onoff, dim }) => {
      await this.limiter.schedule(() => toggleMainLight(onoff, dim));
    });

    this.registerCapabilityListener('onoff.nightlight', async (value) => {
      try {
        const lightSettings = await this.limiter.schedule(() => this.somneoClient!.toggleNightLight(value));
        await this.setCapabilityValue('onoff.nightlight', lightSettings.ngtlt);
      } catch (error) {
        this.error('Error toggling night light:', error);
      }
    });

    this.registerCapabilityListener('onoff.sunset', async (value) => {
      try {
        const settings = this.getSettings();
        const ambientSoundType = Number.isNaN(Number(settings.sunset_ambient_sound)) ? settings.sunset_ambient_sound : 'dus';
        const ambientSoundChannel = ambientSoundType === 'fmr' ? settings.sunset_ambient_radio_channel : settings.sunset_ambient_sound;

        const sunsetSettings = await this.limiter.schedule(() => this.somneoClient!.toggleSunset({
          durat: settings.sunset_duration,
          onoff: value,
          curve: settings.sunset_light_intensity,
          ctype: settings.sunset_color_scheme,
          snddv: ambientSoundType,
          sndch: ambientSoundChannel,
          sndlv: settings.sunset_ambient_volume,
        }));
        await this.setCapabilityValue('onoff.sunset', sunsetSettings.onoff);
      } catch (error) {
        this.error('Error toggling sunset:', error);
      }
    });

    this.registerCapabilityListener('onoff.relax_breathe', async (value) => {
      try {
        const settings = this.getSettings();
        const relaxBreatheSettings = await this.limiter.schedule(() => this.somneoClient!.toggleRelaxBreathe({
          durat: settings.relax_duration,
          onoff: value,
          progr: settings.relax_breathing_pace - 3,
          rtype: settings.relax_guidance_type,
          intny: settings.relax_light_intensity,
          sndlv: settings.relax_sound_intensity,
        }));
        await this.setCapabilityValue('onoff.relax_breathe', relaxBreatheSettings.onoff);
      } catch (error) {
        this.error('Error toggling RelaxBreathe:', error);
      }
    });

    this.registerCapabilityListener('onoff.bedtime_tracking', async (value) => {
      try {
        const bedtimeTrackingSettings = await this.limiter.schedule(() => this.somneoClient!.toggleBedtimeTracking(value));
        await this.setCapabilityValue('onoff.bedtime_tracking', bedtimeTrackingSettings.night);
      } catch (error) {
        this.error('Error toggling bedtime tracking:', error);
      }
    });

    this.registerCapabilityListener('button.reset', async () => {
      try {
        await this.somneoClient!.resetDevice();
      } catch (error) {
        this.error('Error resetting device:', error);
      }
    });

    this.registerCapabilityListener('button.polling', async () => {
      const pollingEnabled = !this.getStoreValue('polling_enabled');

      if (pollingEnabled) {
        this.functionsUpdateInterval = this.homey.setInterval(() => this.syncDeviceFunctions(), this.getSetting('functions_polling_frequency') * 1000);
        this.alarmsUpdateInterval = this.homey.setInterval(() => this.syncSomneoAlarms(), this.getSetting('alarms_polling_frequency') * 60000);
        await this.homey.notifications.createNotification({ excerpt: `${this.getName()} polling interval enabled` });
      } else {
        this.homey.clearInterval(this.alarmsUpdateInterval);
        this.homey.clearInterval(this.functionsUpdateInterval);
        await this.homey.notifications.createNotification({ excerpt: `${this.getName()} polling interval disabled` });
      }

      await this.setStoreValue('polling_enabled', pollingEnabled).catch(this.error);
    });
  }

  private registerAlarmsListeners(capabilityID: string | undefined = undefined) {
    if (capabilityID !== undefined) {
      this.registerAlarmListener(capabilityID);
    } else {
      for (const capability of this.getCapabilities().filter((capabilityID) => /^onoff_alarmclock\.\d+$/.test(capabilityID))) {
        this.registerAlarmListener(capability);
      }
    }
  }

  private registerAlarmListener(capabilityID: string) {
    this.registerCapabilityListener(capabilityID, async (value) => {
      try {
        await this.limiter.schedule(async () => {
          const somneoAlarm = await this.somneoClient!.toggleAlarm(value, Number(capabilityID.split('.')[1]));
          await this.setCapabilityOptions(capabilityID, {
            title: `${somneoAlarm.almhr.toString().padStart(2, '0')}:${somneoAlarm.almmn.toString().padStart(2, '0')}`,
          });
          await this.setCapabilityValue(capabilityID, somneoAlarm.prfen);
        });
      } catch (error) {
        this.error(error);
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
      await this.limiter.schedule(async () => {
        await this.somneoClient?.toggleAlwaysOnDisplay(args.state === 'true').catch(this.error);
      });
    });
  }

};
