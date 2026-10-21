# Greenhouse sensor hub: bug reports

The sensor hub (`src-tauri/src/lib.rs`) receives `sensor://reading` events, keeps a rolling average per sensor, raises `sensor://alert` when that average goes above a threshold, and flushes pending readings to a slow store. The React dashboard (`src/useSensorFeed.ts`, `src/SensorDashboard.tsx`) shows live readings and alerts.

Users and CI have reported these problems. Find and fix the root causes.

1. Since `flush_readings` was made `async`, the backend no longer compiles.
2. The whole app freezes as soon as a sensor's rolling average goes above the alert threshold.
3. The backend panics on the first readings after startup when `window` is larger than 1.
4. On the dashboard the reading counter never goes above 1, and only the most recent sensor is listed.
5. After leaving the dashboard and coming back, every reading is counted twice. The same happens in React StrictMode.

Intended behaviour (unchanged by the fixes):
- The rolling average for a sensor is the mean of its most recent `window` readings, or of all its readings if it has fewer than `window`.
- A sensor raises one alert when its average goes above `alert_above`. It can alert again only after its average has come back to `alert_above` or below. `alertsRaised` in `hub_stats` counts alerts raised.
- `flush_readings` moves every pending reading to the store and returns how many it moved. Readings that arrive while a flush is in progress must not be lost or flushed twice. Readings, flushes and stats requests can all happen concurrently.
- `useSensorFeed` reports the number of readings received since it mounted, the latest temperature per sensor, and every alert in arrival order. It must stop listening when the component unmounts, including when it unmounts before `listen` has resolved.

Constraints:
- Keep every public Rust item, command name, event name and payload shape as it is.
- Don't add dependencies. Don't use `unsafe`.

All gates must pass: `cargo check`, `cargo test`, `tsc --noEmit`, `eslint` (zero warnings), `vitest`.
