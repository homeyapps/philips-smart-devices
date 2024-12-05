'use strict';

export interface SomneoStatuses {
  dspon: boolean;
  brght: number;
}

export interface SomneoAlarms {
  prfen: boolean[];
  prfvs: boolean[];
  pwrsv: number[];
}

export interface SomneoAlarmTimes {
  almhr: number[];
  almmn: number[];
}

export interface SomneoAlarm {
  id: number;
  enabled: boolean;
  powerWakeEnabled: boolean;
  time: string;
}

export interface SomneoEditAlarm {
  prfnr: number;
  prfen: boolean;
  almhr: number;
  almmn: number;
}
