import { useSensorFeed } from './useSensorFeed';

export function SensorDashboard() {
  const { count, latest, alerts } = useSensorFeed();
  const sensors = Object.keys(latest).sort();

  return (
    <section>
      <p data-testid="reading-count">{count} readings</p>
      <ul aria-label="Latest readings">
        {sensors.map((s) => (
          <li key={s}>
            {s}: {latest[s]} °C
          </li>
        ))}
      </ul>
      <ul aria-label="Alerts">
        {alerts.map((a, i) => (
          <li key={`${a.sensor}-${i}`}>
            {a.sensor} average {a.rollingAvg.toFixed(1)} °C
          </li>
        ))}
      </ul>
    </section>
  );
}
