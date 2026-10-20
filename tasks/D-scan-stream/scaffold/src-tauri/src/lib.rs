//! Core-sample archive. Scan files (often hundreds of MB) live in one archive directory.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::ipc::{Channel, Response};
use tauri::{Builder, Runtime, State};

/// Directory that holds the `.scan` files.
pub struct ArchiveRoot(pub PathBuf);

pub const MIN_CHUNK: u32 = 1024;
pub const MAX_CHUNK: u32 = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamSummary {
    pub bytes: u64,
    pub chunks: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, thiserror::Error)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ScanError {
    #[error("invalid scan name {name:?}")]
    InvalidName { name: String },
    #[error("chunk size must be between {min} and {max} bytes")]
    InvalidChunkSize { min: u32, max: u32 },
    #[error("scan {name} not found")]
    NotFound { name: String },
    #[error("i/o error: {message}")]
    Io { message: String },
}

/// Streams `<root>/<name>` to `on_chunk`. To be implemented (see the task description).
pub async fn stream_scan_file(
    root: &Path,
    name: &str,
    chunk_size: u32,
    on_chunk: &Channel<Response>,
) -> Result<StreamSummary, ScanError> {
    let _ = (root, name, chunk_size, on_chunk);
    todo!("stream the scan")
}

/// Current implementation: loads the whole file and returns it as a JSON array of numbers.
#[tauri::command]
fn read_scan(root: State<'_, ArchiveRoot>, name: String) -> Result<Vec<u8>, String> {
    std::fs::read(root.0.join(name)).map_err(|e| e.to_string())
}

pub fn register<R: Runtime>(builder: Builder<R>, root: ArchiveRoot) -> Builder<R> {
    builder.manage(root).invoke_handler(tauri::generate_handler![read_scan])
}
