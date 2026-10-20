mod common;

use std::sync::{Arc, Mutex};

use bench_task::{register, stream_scan_file, ArchiveRoot, MIN_CHUNK};
use serde_json::json;
use tauri::ipc::{Channel, InvokeResponseBody, Response};

fn archive(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("bench-d-{tag}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn streams_a_scan_in_raw_chunks() {
    let dir = archive("visible");
    let data: Vec<u8> = (0..3000u32).map(|i| (i % 251) as u8).collect();
    std::fs::write(dir.join("core-7.scan"), &data).unwrap();

    let chunks = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
    let sink = chunks.clone();
    let channel: Channel<Response> = Channel::new(move |body| {
        match body {
            InvokeResponseBody::Raw(bytes) => sink.lock().unwrap().push(bytes),
            InvokeResponseBody::Json(_) => panic!("chunks must be sent as raw bytes"),
        }
        Ok(())
    });

    let summary = tauri::async_runtime::block_on(stream_scan_file(&dir, "core-7.scan", MIN_CHUNK, &channel)).unwrap();
    assert_eq!(serde_json::to_value(summary).unwrap(), json!({ "bytes": 3000, "chunks": 3 }));
    let got = chunks.lock().unwrap().clone();
    assert_eq!(got.iter().map(Vec::len).collect::<Vec<_>>(), vec![1024, 1024, 952]);
    assert_eq!(got.concat(), data);
}

#[test]
fn stream_scan_command_rejects_traversal() {
    let dir = archive("visible-ipc");
    let (_app, w) = common::mock_app(|b| register(b, ArchiveRoot(dir)));
    assert_eq!(
        common::invoke(&w, "stream_scan", json!({ "name": "../secrets.scan", "chunkSize": 4096, "onChunk": "__CHANNEL__:1" })),
        Err(json!({ "kind": "invalidName", "name": "../secrets.scan" }))
    );
}
