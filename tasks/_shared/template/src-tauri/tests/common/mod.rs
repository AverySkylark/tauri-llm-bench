//! Test helpers shared by visible and hidden tests. Do not edit.
#![allow(dead_code)]

use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, Builder, WebviewWindow, WebviewWindowBuilder};

/// Builds a mock app from `configure` and opens a window labelled "main".
pub fn mock_app(configure: impl FnOnce(Builder<MockRuntime>) -> Builder<MockRuntime>) -> (App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let app = configure(mock_builder()).build(mock_context(noop_assets())).expect("app builds");
    let window = WebviewWindowBuilder::new(&app, "main", Default::default()).build().expect("window builds");
    (app, window)
}

fn local_origin() -> tauri::Url {
    let url = if cfg!(windows) { "http://tauri.localhost" } else { "tauri://localhost" };
    url.parse().unwrap()
}

/// Calls a command through Tauri's real IPC path (argument deserialisation, ACL, response serialisation).
/// Ok = the JSON the frontend would receive; Err = the JSON the frontend's promise would reject with.
pub fn invoke(window: &WebviewWindow<MockRuntime>, cmd: &str, args: serde_json::Value) -> Result<serde_json::Value, serde_json::Value> {
    get_ipc_response(
        window,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: local_origin(),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|body| body.deserialize::<serde_json::Value>().expect("response is JSON"))
}
