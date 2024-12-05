'use strict';

import Homey, { DiscoveryResultMDNSSD } from 'homey';
import { SomneoService } from 'homebridge-somneo/dist/lib/somneoService';
import { SomneoConstants } from 'homebridge-somneo/dist/lib/somneoConstants';
import LocalLogger from '../../src/core/LocalLogger';
import PhilipsSomneoClient from '../../src/api/PhilipsSomneoClient';

module.exports = class SomneoDevice extends Homey.Device {

  private somneoClient?: SomneoService;
  private somneoClientExtended?: PhilipsSomneoClient;
  private localLogger: LocalLogger = new LocalLogger(this);

  private sensorsUpdateInterval?: NodeJS.Timeout;
  private alarmsUpdateInterval?: NodeJS.Timeout;
  private functionsUpdateInterval?: NodeJS.Timeout;

  async onAdded() {
    this.log('SomneoDevice has been added');
  }

  async onInit() {
    this.sensorsUpdateInterval = this.homey.setInterval(async () => this.updateSensors(), this.getSetting('sensors_polling_frequency') * 1000);
    this.alarmsUpdateInterval = this.homey.setInterval(async () => this.updateAlarms(), this.getSetting('alarms_polling_frequency') * 60 * 1000);

    await this.updateSensors();
    await this.updateAlarms();
    await this.registerFunctionsListeners();
    await this.registerAlarmsListeners();
    await this.updateDeviceFunctions();

    await this.registerRunListeners();

    this.functionsUpdateInterval = this.homey.setInterval(async () => this.updateDeviceFunctions(), 4000);
    this.log('SomneoDevice has been initialized');
  }

  async onDiscoveryAvailable(discoveryResult: DiscoveryResultMDNSSD) {
    this.somneoClient = new SomneoService(discoveryResult.address, this.localLogger);
    this.somneoClientExtended = new PhilipsSomneoClient(discoveryResult.address, this.localLogger);

    Object.defineProperty(SomneoConstants, 'BRIGHTNESS_STEP_INTERVAL', {
      value: 1,
      writable: true,
    });

    await this.updateSensors();
    await this.updateAlarms();
    await this.updateDeviceFunctions();
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
      if (this.somneoClientExtended !== undefined) {
        await this.somneoClientExtended.updateStatuses({
          dspon: Boolean(newSettings.display_always_on),
          brght: Number(newSettings.display_brightness),
        }).catch(this.error);
      }
    }

    if (changedKeys.includes('sunset_ambient_sound') && newSettings['sunset_ambient_sound'] === 'fm') {
      Object.defineProperty(SomneoConstants, 'SOUND_SOURCE_SUNSET_PROGRAM', {
        value: 'fmr',
        writable: true,
      });
    } else if (changedKeys.includes('sunset_ambient_sound')) {
      Object.defineProperty(SomneoConstants, 'SOUND_SOURCE_SUNSET_PROGRAM', {
        value: 'dus',
        writable: true,
      });
    }

    if (changedKeys.includes('sensors_polling_frequency')) {
      this.homey.clearInterval(this.sensorsUpdateInterval);
      this.sensorsUpdateInterval = this.homey.setInterval(async () => this.updateSensors(), this.getSetting('sensors_polling_frequency') * 1000);
    }
    if (changedKeys.includes('alarms_polling_frequency')) {
      this.homey.clearInterval(this.alarmsUpdateInterval);
      this.alarmsUpdateInterval = this.homey.setInterval(async () => this.updateAlarms(), this.getSetting('alarms_polling_frequency') * 60 * 1000);
    }

    this.log('SomneoDevice settings where changed');
  }

  async onDeleted() {
    this.homey.clearInterval(this.sensorsUpdateInterval);
    this.homey.clearInterval(this.alarmsUpdateInterval);
    this.homey.clearInterval(this.functionsUpdateInterval);
    this.log('SomneoDevice has been deleted');
  }

  private async updateSensors() {
    if (this.somneoClient !== undefined && this.somneoClientExtended !== undefined) {
      if (!this.getAvailable()) {
        await this.setAvailable();
      }

      await this.somneoClient.getSensorReadings().then((sensorReadings) => {
        this.setCapabilityValue('measure_temperature', sensorReadings.mstmp).catch(this.error);
        this.setCapabilityValue('measure_humidity', sensorReadings.msrhu).catch(this.error);
        this.setCapabilityValue('measure_luminance', sensorReadings.mslux).catch(this.error);
        // @ts-ignore mssnd not exists in client
        this.setCapabilityValue('measure_noise', sensorReadings.mssnd).catch(this.error);
      }).catch(this.error);

      this.log('Sensors Updated');
    } else {
      await this.setUnavailable('Device not responding, please restart the application.');
    }
  }

  private async updateAlarms() {
    await this.somneoClientExtended?.getAlarms().then((alarms) => {
      let capabilityID: string;
      const capabilities = this.getCapabilities();

      capabilities.filter((capabilityID) => /^button\.\d+$/.test(capabilityID))
        .filter((capabilityID) => !alarms.map((alarm) => alarm.id).includes(Number(capabilityID.split('.')[1])))
        .forEach((capabilityID) => {
          this.removeCapability(capabilityID).catch(this.error);
        });

      alarms.forEach((alarm) => {
        capabilityID = `button.${alarm.id}`;

        if (!this.hasCapability(capabilityID)) {
          this.addCapability(capabilityID).catch(this.error);
          this.registerAlarmsListeners(capabilityID).catch(this.error);
        }

        this.setCapabilityValue(capabilityID, alarm.enabled).catch(this.error);
        this.setCapabilityOptions(capabilityID, { title: alarm.time }).catch(this.error);
      });

      this.log('Alarms Updated');
    }).catch(this.error);
  }

  private async updateDeviceFunctions() {
    if (this.somneoClient !== undefined) {
      await this.somneoClient.getLightSettings().then((lightSettings) => {
        if (!this.getAvailable()) {
          this.setAvailable().catch(this.error);
        }

        this.setCapabilityValue('onoff.mainlight', lightSettings.onoff).catch(this.error);
        this.setCapabilityValue('dim', lightSettings.ltlvl).catch(this.error);
        this.setCapabilityValue('onoff.nightlight', lightSettings.ngtlt).catch(this.error);
      }).catch((error) => {
        this.error(error);
        this.setUnavailable('Something is wrong with the device controller, please disconnect for 30 seconds and reconnect the power to the device and wait 30 seconds again.').catch(this.error);
      });

      await this.somneoClient.getSunsetProgram().then((sunsetProgramSettings) => {
        this.setCapabilityValue('onoff.sunset', sunsetProgramSettings.onoff).catch(this.error);
      }).catch(this.error);

      await this.somneoClient.getRelaxBreatheProgramSettings().then((relaxBreatheProgramSettings) => {
        this.setCapabilityValue('onoff.relax_breathe', relaxBreatheProgramSettings.onoff).catch(this.error);
      }).catch(this.error);

      this.log('Functions Updated');
    }
  }

  private async registerFunctionsListeners() {
    this.registerMultipleCapabilityListener(['onoff.mainlight', 'dim'], async ({ 'onoff.mainlight': onoff, dim }) => {
      if (this.somneoClient !== undefined) {
        if (dim > 0 && onoff === false) {
          await this.somneoClient.turnOffMainLight().catch(this.error);
          await this.setCapabilityValue('onoff.mainlight', false);
        } else if (dim <= 0 && onoff === true) {
          await this.somneoClient.turnOnMainLight().catch(this.error);
          await this.setCapabilityValue('onoff.mainlight', true);
        } else if (dim > 0) {
          await this.somneoClient.turnOnMainLight().catch(this.error);
          await this.setCapabilityValue('onoff.mainlight', true);
          await this.somneoClient.updateMainLightBrightness(dim).catch(this.error);
        } else if (onoff === true) {
          await this.somneoClient.turnOnMainLight().catch(this.error);
          await this.setCapabilityValue('onoff.mainlight', true);
        } else {
          await this.somneoClient.turnOffMainLight().catch(this.error);
          await this.setCapabilityValue('onoff.mainlight', false);
        }
      }
    });

    this.registerCapabilityListener('onoff.nightlight', async (value) => {
      if (this.somneoClient !== undefined) {
        if (value) {
          await this.somneoClient.turnOnNightLight().catch(this.error);
          await this.setCapabilityValue('onoff.nightlight', true);
        } else {
          await this.somneoClient.turnOffNightLight().catch(this.error);
          await this.setCapabilityValue('onoff.nightlight', false);
        }
      }
    });
    this.registerCapabilityListener('onoff.sunset', async (value) => {
      if (this.somneoClient !== undefined) {
        if (value) {
          const settings = await this.getSettings();
          let ambientSound = settings.sunset_ambient_sound;

          if (settings.sunset_ambient_sound === 'fm') {
            ambientSound = settings.sunset_ambient_radio_channel;
          }

          await this.somneoClient.turnOnSunsetProgram({
            Duration: settings.sunset_duration,
            LightIntensity: settings.sunset_light_intensity,
            ColorScheme: settings.sunset_color_scheme,
            AmbientSounds: ambientSound,
            Volume: settings.sunset_ambient_volume,
          }).catch(this.error);
          await this.setCapabilityValue('onoff.sunset', true);
        } else {
          await this.somneoClient.turnOffSunsetProgram().catch(this.error);
          await this.setCapabilityValue('onoff.sunset', false);
        }
      }
    });
    this.registerCapabilityListener('onoff.relax_breathe', async (value) => {
      if (this.somneoClient !== undefined) {
        if (value) {
          const settings = await this.getSettings();

          await this.somneoClient.turnOnRelaxBreatheProgram({
            BreathsPerMin: settings.relax_breathing_pace,
            Duration: settings.relax_duration,
            GuidanceType: settings.relax_guidance_type,
            LightIntensity: settings.relax_light_intensity,
            Volume: settings.relax_sound_intensity,
          }).catch(this.error);
          await this.setCapabilityValue('onoff.relax_breathe', true);
        } else {
          await this.somneoClient.turnOffRelaxBreatheProgram().catch(this.error);
          await this.setCapabilityValue('onoff.relax_breathe', false);
        }
      }
    });
  }

  private async registerAlarmsListeners(capabilityID: string | undefined = undefined) {
    if (capabilityID !== undefined) {
      this.registerAlarmListener(capabilityID);
    } else {
      this.getCapabilities().filter((capabilityID) => /^button\.\d+$/.test(capabilityID)).forEach((capabilityID) => {
        this.registerAlarmListener(capabilityID);
      });
    }
  }

  private registerAlarmListener(capabilityID: string) {
    this.registerCapabilityListener(capabilityID, async (value) => {
      await this.somneoClientExtended?.toggleAlarm(Number(capabilityID.split('.')[1]), value).then((response) => {
        this.setCapabilityValue(capabilityID, response.prfen).catch(this.error);
        this.setCapabilityOptions(capabilityID, {
          title: `${response.almhr.toString().padStart(2, '0')}:${response.almmn.toString().padStart(2, '0')}`,
        }).catch(this.error);
      }).catch(this.error);
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
  }

};
