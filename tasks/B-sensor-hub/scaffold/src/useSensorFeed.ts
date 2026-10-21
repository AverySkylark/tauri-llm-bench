import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import { ALERT_EVENT, READING_EVENT, type Alert, type Reading } from './types';

export interface SensorFeed {
  /** Number of readings received since the hook mounted. */
  count: number;
  /** Latest temperature per sensor. */
  latest: Record<string, number>;
  /** Alerts received since the hook mounted, oldest first. */
  alerts: Alert[];
}

export function useSensorFeed(): SensorFeed {
  const [count, setCount] = useState(0);
  const [latest, setLatest] = useState<Record<string, number>>({});
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    void listen<Reading>(READING_EVENT, (event) => {
      setCount(count + 1);
      setLatest({ ...latest, [event.payload.sensor]: event.payload.celsius });
    });
    void listen<Alert>(ALERT_EVENT, (event) => {
      setAlerts([...alerts, event.payload]);
    });
  }, []);

  return { count, latest, alerts };
}
