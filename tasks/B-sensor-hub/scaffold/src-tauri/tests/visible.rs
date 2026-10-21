mod common;

use bench_task::{listen_for_readings, register, Hub, HubConfig, Reading, READING_EVENT};
use serde_json::json;
use tauri::Emitter;

#[test]
fn flush_moves_pending_readings_to_the_store() {
    let (app, w) = common::mock_app(|b| register(b, Hub::new(HubConfig { alert_above: 30.0, window: 3 })));
    listen_for_readings(app.handle());
    for c in [20.0, 21.0, 22.0] {
        app.emit(READING_EVENT, Reading { sensor: "bench-a".into(), celsius: c }).unwrap();
    }
    assert_eq!(common::invoke(&w, "flush_readings", json!({})), Ok(json!(3)));
    assert_eq!(
        common::invoke(&w, "hub_stats", json!({})),
        Ok(json!({ "pending": 0, "flushed": 3, "alertsRaised": 0, "alerting": [] }))
    );
}
