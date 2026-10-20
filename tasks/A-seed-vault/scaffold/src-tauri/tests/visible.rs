mod common;

use bench_task::{register, SeedVault};
use serde_json::json;

fn app() -> (tauri::App<tauri::test::MockRuntime>, tauri::WebviewWindow<tauri::test::MockRuntime>) {
    common::mock_app(|b| register(b, SeedVault::with_lots([("TOM-0042", 120), ("BEA-0007", 40)])))
}

#[test]
fn lists_lots_sorted_by_code() {
    let (_app, w) = app();
    assert_eq!(
        common::invoke(&w, "list_lots", json!({})),
        Ok(json!([{ "code": "BEA-0007", "grams": 40 }, { "code": "TOM-0042", "grams": 120 }]))
    );
}

#[test]
fn withdraw_returns_updated_lot() {
    let (_app, w) = app();
    assert_eq!(
        common::invoke(&w, "withdraw", json!({ "code": "TOM-0042", "grams": 20 })),
        Ok(json!({ "code": "TOM-0042", "grams": 100 }))
    );
}

#[test]
fn withdraw_too_much_is_rejected() {
    let (_app, w) = app();
    assert_eq!(
        common::invoke(&w, "withdraw", json!({ "code": "BEA-0007", "grams": 50 })),
        Err(json!({ "kind": "insufficient", "code": "BEA-0007", "available": 40, "requested": 50 }))
    );
}
