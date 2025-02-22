'use strict';

export interface SomneoSensorsData {
  mslux: number; // The current amount of light in lux
  mstmp: number; // The current temperature in °C/F
  msrhu: number; // The current humidity in %
  mssnd: number; // The current sound level in dB
}

export interface SomneoStatusesData {
  dspon?: boolean; // Whether the display is permanently shown or automatically disables after a period of time
  brght?: number; // The brightness level of the display
  pwrsz?: boolean; // Restart mode
}

export interface SomneoLightSettings {
  onoff?: boolean; // Whether the main light is enabled or not
  ltlvl?: number; // The level of the main light
  tempy?: boolean; // Whether the sunrise preview is enabled or not
  ctype?: number; // The type of sunrise to show when the alarm is triggered
  ngtlt?: boolean; // Whether the night light is enabled or not
}

export interface SomneoSunsetSettings {
  durat: number; // The duration of the sunset in minutes
  onoff: boolean; // Whether the sunset is enabled or disabled
  curve: number; // The light level of the sunset
  ctype: number; // The type of sunset
  snddv: string; // The type of sound device used for the sunset sound ['off', 'dus', 'fmr', 'aux']
  sndch: string; // The channel or preset that is selected for the sunset sound
  sndlv: number; // The sunset sound's volume level
}

export interface SomneoRelaxBreatheSettings {
  durat: number; // The duration of the relax breathe in minutes
  onoff: boolean; // Whether the relax breathe is enabled or disabled
  progr: number; // Breathing pace [UI number - 3]
  rtype: number // The guidance type [0 - 'Light', 1 - 'Sound']
  intny?: number; // The light level of the relax breathe
  sndlv?: number; // The relax breathe sound's volume level
}

export interface SomneoBedtimeTrackingSettings {
  night: boolean; // Whether the bedtime tracking is enabled or disabled
}

export interface SomneoAlarm {
  prfnr: number; // The alarm's id/index
  prfen: boolean; // Whether the alarm is activated or deactivated
  prfvs: boolean; // Whether the alarm is enabled or disabled
  pname?: string; // The alarm's name
  almhr: number; // The alarm's hours
  almmn: number; // The alarm's minutes
  daynm?: number; // The alarm's repetition
  pwrsz?: number; // Whether the PowerWake activated or deactivated
  pszhr?: number; // The PowerWake hour
  pszmn?: number; // The PowerWake minute
  ctype?: number; // The type of sunrise
  curve?: number; // The light level of the sunrise
  durat?: number; // The duration of the sunrise in minutes
  snddv?: string; // The type of sound device used for the sunset sound ['off', 'dus', 'fmr', 'aux']
  sndch?: string; // The channel or preset that is selected for the sunrise sound
  sndlv?: number; // The sunrise sound's volume level
}

export interface SomneoAlarms {
  prfen: boolean[]; // Activated alarms
  prfvs: boolean[]; // Enabled alarms
  pwrsv: number[]; // Activated power wake-ups
}

export interface SomneoAlarmSchedules {
  almhr: number[]; // Alarms hours
  almmn: number[]; // Alarms minutes
  daynm: number[]; // Alarms days
}

export interface SomneoEvent {
  event: string; // Event name
  ltlvl: number; // The level of the main light
}

export interface SomneoPlayerSettings {
  onoff?: boolean, // Whether the player is enabled or not
  sdvol?: number, // The sound level of the player
  tempy?: boolean, // Whether the sound preview is enabled or not
  snddv?: string, // Player source
  sndch?: string // FM radio channel
}

export interface SomneoRadioChannelsFrequencies {
  1?: string
  2?: string
  3?: string
  4?: string
  5?: string
}

export interface HomeyAlarmClock {
  id: number;
  enabled?: boolean;
  powerWakeEnabled?: boolean;
  time: string;
  repetition?: object;
}

export interface AlarmSettings {
  sunTheme: number,
  duration: number,
  lightIntensity: number,
  volume: number,
  sound: string,
  soundChannel: string,
  powerWake: boolean,
  powerWakeTime: number,
  snoozeDuration?: number
}
