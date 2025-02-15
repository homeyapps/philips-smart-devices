'use strict';

import Homey from 'homey';

module.exports = class PhilipsSmartDevicesApp extends Homey.App {

  async onInit() {
    const createAlarmCards = [
      this.homey.flow.getActionCard('create_alarm'),
      this.homey.flow.getActionCard('create_now_alarm'),
    ];

    for (const createAlarmCard of createAlarmCards) {
      createAlarmCard.registerArgumentAutocompleteListener('color_scheme', async (query, args) => {
        return [
          { ctype: 0, curve: 1, name: 'Sunny Day' },
          { ctype: 1, name: 'Island Red' },
          { ctype: 2, name: 'Nordic White' },
          { ctype: 3, name: 'Caribbean Red' },
          { ctype: 0, curve: 0, name: 'No Light' },
        ].filter((result) => {
          return result.name.toLowerCase().includes(query.toLowerCase());
        });
      });

      createAlarmCard.registerArgumentAutocompleteListener(
        'ambient_sound',
        async (query, args) => {
          let results = [
            { sndch: '1', name: 'Forest Birds' },
            { sndch: '2', name: 'Summer Birds' },
            { sndch: '3', name: 'Buddha Wakeup' },
            { sndch: '4', name: 'Morning Alps' },
            { sndch: '5', name: 'Yoga Harmony' },
            { sndch: '6', name: 'Nepal Bowls' },
            { sndch: '7', name: 'Summer Lake' },
            { sndch: '8', name: 'Ocean Waves' },
          ];

          if (args.ambient_sound_source === 'fmr') {
            const settingsSymbol = Object.getOwnPropertySymbols(args.device).find((symbol) => String(symbol) === 'Symbol(settings)');

            if (settingsSymbol) {
              const settings = args.device[settingsSymbol];
              results = [
                { sndch: '1', name: settings.name_ch1 },
                { sndch: '2', name: settings.name_ch2 },
                { sndch: '3', name: settings.name_ch3 },
                { sndch: '4', name: settings.name_ch4 },
                { sndch: '5', name: settings.name_ch5 },
              ];
            } else {
              this.error('Symbol(settings) not found in device');
            }
          } else if (args.ambient_sound_source === 'off') {
            results = [];
          }

          return results.filter((result) => {
            return result.name.toLowerCase().includes(query.toLowerCase());
          });
        },
      );
    }

    this.log('Philips Smart Devices app has been initialized');
  }

};
