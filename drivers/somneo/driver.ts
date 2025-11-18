'use strict';

import Homey from 'homey';

module.exports = class SomneoDriver extends Homey.Driver {

  async onInit() {
    this.log('Somneo driver has been initialized');
    this.registerFlowCards();
  }

  private registerFlowCards() {
    // Register condition cards
    const mainlightCondition = this.homey.flow.getConditionCard('onoff.mainlight_enabled');
    mainlightCondition.registerRunListener(async (args) => {
      return args.device.getCapabilityValue('onoff.mainlight');
    });

    const nightlightCondition = this.homey.flow.getConditionCard('onoff.nightlight_enabled');
    nightlightCondition.registerRunListener(async (args) => {
      return args.device.getCapabilityValue('onoff.nightlight');
    });

    const sunsetCondition = this.homey.flow.getConditionCard('onoff.sunset_enabled');
    sunsetCondition.registerRunListener(async (args) => {
      return args.device.getCapabilityValue('onoff.sunset');
    });

    const relaxBreatheCondition = this.homey.flow.getConditionCard('onoff.relax_breathe_enabled');
    relaxBreatheCondition.registerRunListener(async (args) => {
      return args.device.getCapabilityValue('onoff.relax_breathe');
    });

    const bedtimeTrackingCondition = this.homey.flow.getConditionCard('onoff.bedtime_tracking_enabled');
    bedtimeTrackingCondition.registerRunListener(async (args) => {
      return args.device.getCapabilityValue('onoff.bedtime_tracking');
    });

    const alarmSunriseCondition = this.homey.flow.getConditionCard('onoff.alarm_sunrise_enabled');
    alarmSunriseCondition.registerRunListener(async (args) => {
      return args.device.getCapabilityValue('alarmclock_state.sunrise');
    });

    const alarmCondition = this.homey.flow.getConditionCard('onoff.alarm_enabled');
    alarmCondition.registerRunListener(async (args) => {
      return args.device.getCapabilityValue('alarmclock_state.alarm');
    });

    // Register action cards
    const mainlightAction = this.homey.flow.getActionCard('onoff.mainlight_activate');
    mainlightAction.registerRunListener(async (args) => {
      await args.device.triggerCapabilityListener('onoff.mainlight', args.state === 'true');
    });

    const nightlightAction = this.homey.flow.getActionCard('onoff.nightlight_activate');
    nightlightAction.registerRunListener(async (args) => {
      await args.device.triggerCapabilityListener('onoff.nightlight', args.state === 'true');
    });

    const sunsetAction = this.homey.flow.getActionCard('onoff.sunset_activate');
    sunsetAction.registerRunListener(async (args) => {
      await args.device.triggerCapabilityListener('onoff.sunset', args.state === 'true');
    });

    const relaxBreatheAction = this.homey.flow.getActionCard('onoff.relax_breathe_activate');
    relaxBreatheAction.registerRunListener(async (args) => {
      await args.device.triggerCapabilityListener('onoff.relax_breathe', args.state === 'true');
    });

    const bedtimeTrackingAction = this.homey.flow.getActionCard('onoff.bedtime_tracking_activate');
    bedtimeTrackingAction.registerRunListener(async (args) => {
      await args.device.triggerCapabilityListener('onoff.bedtime_tracking', args.state === 'true');
    });

    const aodAction = this.homey.flow.getActionCard('onoff.aod_activate');
    aodAction.registerRunListener(async (args) => {
      await args.device.somneoClient?.toggleAlwaysOnDisplay(args.state === 'true');
    });

    const createAlarmAction = this.homey.flow.getActionCard('create_alarm');
    createAlarmAction.registerRunListener(async (args) => {
      return args.device.createAlarm(args);
    });

    const createNowAlarmAction = this.homey.flow.getActionCard('create_now_alarm');
    createNowAlarmAction.registerRunListener(async (args) => {
      return args.device.createNowAlarm(args);
    });

    const removeAlarmAction = this.homey.flow.getActionCard('remove_alarm');
    removeAlarmAction.registerRunListener(async (args) => {
      return args.device.removeAlarm(args);
    });
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
