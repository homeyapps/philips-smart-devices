'use strict';

import Homey, { DiscoveryResultMDNSSD } from 'homey';
import { HomeyAPI, HomeyAPIV2 } from 'homey-api';
import LocalLogger from '../../src/core/LocalLogger';
import PhilipsSomneoClient from '../../src/api/PhilipsSomneoClient';
import { HomeyAPITypes } from '../../types';
import Alarm = HomeyAPIV2.ManagerAlarms.Alarm;

module.exports = class SomneoDevice extends Homey.Device {

  private homeyClient?: HomeyAPITypes;
  private somneoClient?: PhilipsSomneoClient;
  private localLogger: LocalLogger = new LocalLogger(this);

  private sensorsUpdateInterval?: NodeJS.Timeout;
  private alarmsUpdateInterval?: NodeJS.Timeout;
  private functionsUpdateInterval?: NodeJS.Timeout;

  async onAdded() {
    this.log('Somneo device has been added');
  }

  async onInit() {
    this.sensorsUpdateInterval = this.homey.setInterval(this.syncSensors.bind(this), this.getSetting('sensors_polling_frequency') * 1000);
    this.alarmsUpdateInterval = this.homey.setInterval(this.syncAlarms.bind(this), this.getSetting('alarms_polling_frequency') * 60 * 1000);

    await this.syncSensors();
    await this.syncAlarms();
    await this.registerActionsListeners();
    await this.registerAlarmsListeners();
    await this.syncDeviceActions();

    await this.registerRunListeners();

    this.functionsUpdateInterval = this.homey.setInterval(this.syncDeviceActions.bind(this), 4000);
    this.log('Somneo device has been initialized');
  }

  async onDiscoveryAvailable(discoveryResult: DiscoveryResultMDNSSD) {
    this.homeyClient = await HomeyAPI.createAppAPI({ homey: this.homey });
    this.somneoClient = new PhilipsSomneoClient(discoveryResult.address, this.localLogger);

    await this.syncSensors();
    await this.syncAlarms();
    await this.syncDeviceActions();
  }

  async onDiscoveryAddressChanged(discoveryResult: DiscoveryResultMDNSSD) {
    await this.onDiscoveryAvailable(discoveryResult);
  }

  async onDiscoveryLastSeenChanged(discoveryResult: DiscoveryResultMDNSSD) {
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
  }): Promise<string | void> {
    if (changedKeys.includes('display_always_on') || changedKeys.includes('display_brightness')) {
      await this.somneoClient?.changeDisplaySettings(
        Boolean(newSettings.display_always_on),
        Number(newSettings.display_brightness),
      ).catch(this.error);
    }

    if (changedKeys.includes('sensors_polling_frequency')) {
      this.homey.clearInterval(this.sensorsUpdateInterval);
      this.sensorsUpdateInterval = this.homey.setInterval(this.syncSensors.bind(this), this.getSetting('sensors_polling_frequency') * 1000);
    }
    if (changedKeys.includes('alarms_polling_frequency')) {
      this.homey.clearInterval(this.alarmsUpdateInterval);
      this.alarmsUpdateInterval = this.homey.setInterval(this.syncAlarms.bind(this), this.getSetting('alarms_polling_frequency') * 60 * 1000);
    }

    if (changedKeys.includes('alarms_device_sync') && newSettings.alarms_device_sync) {
      await this.syncAlarms();
    }

    if (changedKeys.includes('sunrise_preview')) {
      await this.somneoClient?.toggleSunrisePreview(
        Boolean(newSettings.sunrise_preview),
        Number(newSettings.sunrise_color_scheme),
      ).catch(this.error);
    } else if (changedKeys.includes('sunrise_color_scheme') && Boolean(this.getSettings().sunrise_preview)) {
      await this.somneoClient?.toggleSunrisePreview(false, 0).catch(this.error);
      this.homey.setTimeout(() => {
        this.somneoClient?.toggleSunrisePreview(true, Number(newSettings.sunrise_color_scheme)).catch(this.error);
      }, 5000);
    }

    this.log('Somneo device settings where changed');
  }

  async onDeleted() {
    this.homey.clearInterval(this.sensorsUpdateInterval);
    this.homey.clearInterval(this.alarmsUpdateInterval);
    this.homey.clearInterval(this.functionsUpdateInterval);

    await this.unsetStoreValue('alarmsIDs');
    this.log('Somneo device has been deleted');
  }

  private async syncSensors() {
    if (this.somneoClient !== undefined) {
      if (!this.getAvailable()) {
        await this.setAvailable().catch(this.error);
      }

      try {
        const sensorsData = await this.somneoClient.getSensors();

        await this.setCapabilityValue('measure_temperature', sensorsData.mstmp).catch(this.error);
        await this.setCapabilityValue('measure_humidity', sensorsData.msrhu).catch(this.error);
        await this.setCapabilityValue('measure_luminance', sensorsData.mslux).catch(this.error);
        await this.setCapabilityValue('measure_noise', sensorsData.mssnd).catch(this.error);

        this.log('Sensors updated');
      } catch (err) {
        this.error(err);
      }
    } else {
      await this.setUnavailable('Device not responding, please restart the application or device.').catch(this.error);
    }
  }

  private async syncAlarms() {
    try {
      const alarms = await this.somneoClient?.getAlarms();
      const homeyAlarmsIDs: Map<number, string> = new Map(
        Object.entries(this.getStoreValue('alarmsIDs') || {}).map(([key, value]) => [Number(key), value as string]),
      );

      if (!alarms) {
        this.log('No alarms returned');
        return;
      }

      const alarmsIDs = alarms.map((alarm) => alarm.id);
      const capabilitiesToRemove = this.getCapabilities().filter((capabilityID) => /^button\.\d+$/.test(capabilityID)).filter((capabilityID) => {
        return !alarmsIDs.includes(Number(capabilityID.split('.')[1]));
      });

      for (const capabilityID of capabilitiesToRemove) {
        await this.removeCapability(capabilityID).catch(this.error);

        const alarmID = Number(capabilityID.split('.')[1]);
        if (!homeyAlarmsIDs.has(alarmID)) {
          await this.homeyClient?.alarms.deleteAlarm({ id: `${homeyAlarmsIDs.get(alarmID)}` }).then(() => homeyAlarmsIDs.delete(alarmID));
        }
      }

      for (const alarm of alarms) {
        const capabilityID = `button.${alarm.id}`;

        if (!this.hasCapability(capabilityID)) {
          try {
            await this.addCapability(capabilityID).catch(this.error);
            await this.registerAlarmsListeners(capabilityID);
          } catch (error) {
            this.error(`Error adding capability or registering listeners for ${capabilityID}: `, error);
          }
        }

        if (this.getSettings().alarms_device_sync) {
          if (!homeyAlarmsIDs.has(alarm.id)) {
            const alarmName = `${this.getSettings().alarms_generative_name} #${alarm.id}`;
            await this.homeyClient?.alarms.createAlarm({
              alarm: {
                name: alarmName,
                time: alarm.time,
                enabled: alarm.enabled,
                repetition: alarm.repetition,
              },
            }).then((homeyAlarm) => {
              homeyAlarmsIDs.set(alarm.id, (<Alarm> homeyAlarm).id);
              this.homey.notifications.createNotification({ excerpt: `Alarm **${alarmName}** was created` }).catch(this.error);
            });
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
    } catch (error) {
      this.error('Error syncing alarms: ', error);
    }
  }

  private async syncDeviceActions() {
    if (this.somneoClient !== undefined) {
      try {
        if (!this.getAvailable()) {
          await this.setAvailable().catch(this.error);
        }

        const lightSettings = await this.somneoClient.getLightSettings();

        await this.setCapabilityValue('onoff.mainlight', lightSettings.onoff).catch(this.error);
        await this.setCapabilityValue('dim', lightSettings.ltlvl).catch(this.error);
        await this.setCapabilityValue('onoff.nightlight', lightSettings.ngtlt).catch(this.error);
      } catch (error) {
        this.error('Error syncing device actions: ', error);
        await this.setUnavailable('Something is wrong with the device controller, please use maintenance action.').catch(this.error);
      }

      await this.somneoClient.getSunsetSettings().then(async (sunsetSettings) => {
        await this.setCapabilityValue('onoff.sunset', sunsetSettings.onoff).catch(this.error);
      }).catch(this.error);

      await this.somneoClient.getRelaxBreatheSettings().then(async (relaxBreatheSettings) => {
        await this.setCapabilityValue('onoff.relax_breathe', relaxBreatheSettings.onoff).catch(this.error);
      }).catch(this.error);

      await this.somneoClient.getBedtimeTracking().then(async (bedtimeTrackingSettings) => {
        await this.setCapabilityValue('onoff.bedtime_tracking', bedtimeTrackingSettings.night).catch(this.error);
      }).catch(this.error);

      this.log('Device actions updated');
    }
  }

  private async registerActionsListeners() {
    this.registerMultipleCapabilityListener(['onoff.mainlight', 'dim'], async ({ 'onoff.mainlight': onoff, dim }) => {
      if (this.somneoClient !== undefined) {
        if (dim > 0 && onoff === false) {
          await this.somneoClient.toggleMainLight(false).then(async (lightSettings) => {
            await this.setCapabilityValue('onoff.mainlight', lightSettings.onoff).catch(this.error);
          }).catch(this.error);
        } else if (dim <= 0 && onoff === true) {
          await this.somneoClient.toggleMainLight(true).then(async (lightSettings) => {
            await this.setCapabilityValue('onoff.mainlight', lightSettings.onoff).catch(this.error);
          }).catch(this.error);
        } else if (dim > 0) {
          await this.somneoClient.toggleMainLight(true, dim).then(async (lightSettings) => {
            await this.setCapabilityValue('onoff.mainlight', lightSettings.onoff).catch(this.error);
          }).catch(this.error);
        } else if (onoff === true) {
          await this.somneoClient.toggleMainLight(true).then(async (lightSettings) => {
            await this.setCapabilityValue('onoff.mainlight', lightSettings.onoff).catch(this.error);
          }).catch(this.error);
        } else {
          await this.somneoClient.toggleMainLight(false).then(async (lightSettings) => {
            await this.setCapabilityValue('onoff.mainlight', lightSettings.onoff).catch(this.error);
          }).catch(this.error);
        }
      }
    });

    this.registerCapabilityListener('onoff.nightlight', async (value) => {
      if (this.somneoClient !== undefined) {
        await this.somneoClient.toggleNightLight(value).then(async (lightSettings) => {
          await this.setCapabilityValue('onoff.nightlight', lightSettings.ngtlt).catch(this.error);
        }).catch(this.error);
      }
    });

    this.registerCapabilityListener('onoff.sunset', async (value) => {
      if (this.somneoClient !== undefined) {
        const settings = await this.getSettings();

        let ambientSoundType = 'dus';
        let ambientSoundChannel = settings.sunset_ambient_sound;

        if (Number.isNaN(Number(ambientSoundChannel))) {
          ambientSoundType = settings.sunset_ambient_sound;
          if (ambientSoundType === 'fmr') {
            ambientSoundChannel = settings.sunset_ambient_radio_channel;
          }
        }

        await this.somneoClient.toggleSunset({
          durat: settings.sunset_duration,
          onoff: value,
          curve: settings.sunset_light_intensity,
          ctype: settings.sunset_color_scheme,
          snddv: ambientSoundType,
          sndch: ambientSoundChannel,
          sndlv: settings.sunset_ambient_volume,
        }).then(async (sunsetSettings) => {
          await this.setCapabilityValue('onoff.sunset', sunsetSettings.onoff).catch(this.error);
        }).catch(this.error);
      }
    });

    this.registerCapabilityListener('onoff.relax_breathe', async (value) => {
      if (this.somneoClient !== undefined) {
        const settings = await this.getSettings();

        await this.somneoClient.toggleRelaxBreathe({
          durat: settings.relax_duration,
          onoff: value,
          progr: settings.relax_breathing_pace - 3,
          rtype: settings.relax_guidance_type,
          intny: settings.relax_light_intensity,
          sndlv: settings.relax_sound_intensity,
        }).then(async (relaxBreatheSettings) => {
          await this.setCapabilityValue('onoff.relax_breathe', relaxBreatheSettings.onoff).catch(this.error);
        }).catch(this.error);
      }
    });

    this.registerCapabilityListener('onoff.bedtime_tracking', async (value) => {
      if (this.somneoClient !== undefined) {
        await this.somneoClient.toggleBedtimeTracking(value).then(async (bedtimeTrackingSettings) => {
          await this.setCapabilityValue('onoff.bedtime_tracking', bedtimeTrackingSettings.night).catch(this.error);
        }).catch(this.error);
      }
    });

    this.registerCapabilityListener('button.restart', async () => {
      await this.somneoClient?.restartDevice().catch(this.error);
    });
  }

  private async registerAlarmsListeners(capabilityID: string | undefined = undefined) {
    if (capabilityID !== undefined) {
      await this.registerAlarmListener(capabilityID);
    } else {
      for (const capability of this.getCapabilities().filter((capabilityID) => /^button\.\d+$/.test(capabilityID))) {
        await this.registerAlarmListener(capability);
      }
    }
  }

  private async registerAlarmListener(capabilityID: string) {
    this.registerCapabilityListener(capabilityID, async (value) => {
      try {
        this.log(`Toggle alarm with status: ${value}`);
        const response = await this.somneoClient?.toggleAlarm(value, Number(capabilityID.split('.')[1]));
        await this.setCapabilityOptions(capabilityID, {
          title: `${response?.almhr.toString().padStart(2, '0')}:${response?.almmn.toString().padStart(2, '0')}`,
        }).catch(this.error);
        await this.setCapabilityValue(capabilityID, response?.prfen).catch(this.error);
      } catch (error) {
        this.error('Error toggling alarm: ', error);
      }
    });
  }

  private async registerRunListeners() {
    this.homey.flow.getConditionCard('onoff.mainlight_enabled').registerRunListener(async (args, state) => {
      return this.getCapabilityValue('onoff.mainlight');
    });
    this.homey.flow.getConditionCard('onoff.nightlight_enabled').registerRunListener(async (args, state) => {
      return this.getCapabilityValue('onoff.nightlight');
    });
    this.homey.flow.getConditionCard('onoff.sunset_enabled').registerRunListener(async (args, state) => {
      return this.getCapabilityValue('onoff.sunset');
    });
    this.homey.flow.getConditionCard('onoff.relax_breathe_enabled').registerRunListener(async (args, state) => {
      return this.getCapabilityValue('onoff.relax_breathe');
    });
    this.homey.flow.getConditionCard('onoff.bedtime_tracking_enabled').registerRunListener(async (args, state) => {
      return this.getCapabilityValue('onoff.bedtime_tracking');
    });

    this.homey.flow.getActionCard('onoff.mainlight_activate').registerRunListener(async (args, state) => {
      await this.triggerCapabilityListener('onoff.mainlight', state).catch(this.error);
    });
    this.homey.flow.getActionCard('onoff.nightlight_activate').registerRunListener(async (args, state) => {
      await this.triggerCapabilityListener('onoff.nightlight', state).catch(this.error);
    });
    this.homey.flow.getActionCard('onoff.sunset_activate').registerRunListener(async (args, state) => {
      await this.triggerCapabilityListener('onoff.sunset', state).catch(this.error);
    });
    this.homey.flow.getActionCard('onoff.relax_breathe_activate').registerRunListener(async (args, state) => {
      await this.triggerCapabilityListener('onoff.relax_breathe', state).catch(this.error);
    });
    this.homey.flow.getActionCard('onoff.bedtime_tracking_activate').registerRunListener(async (args, state) => {
      await this.triggerCapabilityListener('onoff.bedtime_tracking', state).catch(this.error);
    });
  }

};
