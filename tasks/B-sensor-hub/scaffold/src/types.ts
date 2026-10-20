export const READING_EVENT = 'sensor://reading';
export const ALERT_EVENT = 'sensor://alert';

export interface Reading {
  sensor: string;
  celsius: number;
}

export interface Alert {
  sensor: string;
  celsius: number;
  rollingAvg: number;
}
