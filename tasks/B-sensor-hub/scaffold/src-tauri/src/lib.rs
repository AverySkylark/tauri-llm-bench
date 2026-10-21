//! Greenhouse sensor hub.
//!
//! Sensors push readings as `sensor://reading` events. The hub keeps a rolling average per
//! sensor, raises `sensor://alert` when that average goes above the configured threshold, and
//! periodically flushes pending readings to the (slow) store.

use std::collections::{BTreeSet, HashMap};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Builder, Emitter, Listener, Manager, Runtime, State};

pub const READING_EVENT: &str = "sensor://reading";
pub const ALERT_EVENT: &str = "sensor://alert";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reading {
    pub sensor: String,
    pub celsius: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Alert {
    pub sensor: String,
    pub celsius: f64,
    pub rolling_avg: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubStats {
    pub pending: usize,
    pub flushed: usize,
    pub alerts_raised: u32,
    pub alerting: Vec<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct HubConfig {
    /// Alert when a sensor's rolling average is strictly above this.
    pub alert_above: f64,
    /// Number of most recent readings per sensor in the rolling average.
    pub window: usize,
}

#[derive(Default)]
struct HubState {
    pending: Vec<Reading>,
    history: HashMap<String, Vec<f64>>,
    alerting: BTreeSet<String>,
    alerts_raised: u32,
    flushed: usize,
}

pub struct Hub {
    config: HubConfig,
    state: Mutex<HubState>,
    store: Mutex<Vec<Reading>>,
}

impl Hub {
    pub fn new(config: HubConfig) -> Self {
        Self { config, state: Mutex::new(HubState::default()), store: Mutex::new(Vec::new()) }
    }

    /// Everything flushed so far, in flush order.
    pub fn stored(&self) -> Vec<Reading> {
        self.store.lock().unwrap().clone()
    }

    fn rolling_avg(&self, history: &[f64]) -> f64 {
        let recent = &history[history.len() - self.config.window..];
        recent.iter().sum::<f64>() / recent.len() as f64
    }
}

/// Simulates the latency of writing a batch to the store.
async fn slow_write() {
    tokio::time::sleep(Duration::from_millis(2)).await;
}

#[tauri::command]
async fn flush_readings(hub: State<'_, Hub>) -> Result<usize, String> {
    let mut state = hub.state.lock().unwrap();
    let batch: Vec<Reading> = state.pending.drain(..).collect();
    slow_write().await;
    hub.store.lock().unwrap().extend(batch.iter().cloned());
    state.flushed += batch.len();
    Ok(batch.len())
}

#[tauri::command]
fn hub_stats(hub: State<'_, Hub>) -> HubStats {
    let state = hub.state.lock().unwrap();
    HubStats {
        pending: state.pending.len(),
        flushed: state.flushed,
        alerts_raised: state.alerts_raised,
        alerting: state.alerting.iter().cloned().collect(),
    }
}

pub fn register<R: Runtime>(builder: Builder<R>, hub: Hub) -> Builder<R> {
    builder
        .manage(hub)
        .invoke_handler(tauri::generate_handler![flush_readings, hub_stats])
        .setup(|app| {
            listen_for_readings(app.handle());
            Ok(())
        })
}

/// Subscribes the hub to sensor events. Called from `setup`; tests call it directly.
pub fn listen_for_readings<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    app.listen_any(READING_EVENT, move |event| {
        let Ok(reading) = serde_json::from_str::<Reading>(event.payload()) else {
            return;
        };
        let hub = handle.state::<Hub>();
        let mut state = hub.state.lock().unwrap();
        state.pending.push(reading.clone());
        let history = state.history.entry(reading.sensor.clone()).or_default();
        history.push(reading.celsius);
        let avg = hub.rolling_avg(history);
        if avg > hub.config.alert_above {
            if state.alerting.insert(reading.sensor.clone()) {
                let alert = Alert { sensor: reading.sensor, celsius: reading.celsius, rolling_avg: avg };
                handle.emit(ALERT_EVENT, alert).unwrap();
            }
        } else {
            state.alerting.remove(&reading.sensor);
        }
    });

    let handle = app.clone();
    app.listen_any(ALERT_EVENT, move |_event| {
        handle.state::<Hub>().state.lock().unwrap().alerts_raised += 1;
    });
}
