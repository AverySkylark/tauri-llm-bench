# Core-sample archive: stream binary scans

Scan files are often hundreds of megabytes. Today `read_scan` loads a whole file into memory and returns it as a JSON array of numbers, and it also lets a caller read any file on disk via `..`. Replace it with a streaming command, lock down its permissions, and add the frontend side.

## Backend (`src-tauri/src/lib.rs`)

Implement `stream_scan_file`, with the signature already in the file:

```rust
pub async fn stream_scan_file(root: &Path, name: &str, chunk_size: u32, on_chunk: &Channel<Response>)
    -> Result<StreamSummary, ScanError>;
```

- Validate in this order: first the name, then the chunk size, then that the file exists.
- `name` must be a plain file name: 1 to 64 characters made of lowercase ASCII letters, digits, `-` and `_`, starting with a letter or digit, followed by `.scan`. Anything else is `InvalidName { name }`. This must reject traversal, separators, absolute paths and drive prefixes.
- `chunk_size` must be between `MIN_CHUNK` and `MAX_CHUNK` inclusive, otherwise `InvalidChunkSize { min: MIN_CHUNK, max: MAX_CHUNK }`.
- A missing file is `NotFound { name }`. Any other I/O failure is `Io { message }`.
- Read the file asynchronously, without loading it all into memory. Send it in order as raw binary messages (`tauri::ipc::Response`, so the frontend receives an `ArrayBuffer`). Every chunk is exactly `chunk_size` bytes except the last, which may be shorter. An empty file sends nothing.
- Return `StreamSummary { bytes, chunks }` with the totals sent. If sending a chunk fails, stop and return `Io`.

Add a Tauri command `stream_scan(name, chunk_size, on_chunk)` that streams from the managed `ArchiveRoot` using `stream_scan_file`. Register it in `register`, and remove `read_scan` completely. Keep the existing public items (`ArchiveRoot`, `MIN_CHUNK`, `MAX_CHUNK`, `StreamSummary`, `ScanError`, `register`) and their serialised shapes. Errors serialise like `{ "kind": "invalidName", "name": "../x.scan" }` and `{ "kind": "invalidChunkSize", "min": 1024, "max": 1048576 }`.

## Permissions (`src-tauri/capabilities/`)

The app's `build.rs` (not part of this working copy) declares an app manifest with the command `stream_scan`, so Tauri generates the permission `allow-stream-scan`. Add `src-tauri/capabilities/archive.json` with identifier `archive`. It applies only to the `main` window, grants `allow-stream-scan`, and grants nothing else: no wildcards, no plugin permissions, no `remote` access. Leave `default.json` as it is.

## Frontend

Create `src/scanStream.ts` exporting:

```ts
export interface ScanProgress { bytes: number; chunks: number }
export class ScanIncompleteError extends Error {
  readonly expectedChunks: number;
  readonly receivedChunks: number;
}
export function fetchScan(
  name: string,
  chunkSize: number,
  options?: { onProgress?: (progress: ScanProgress) => void; timeoutMs?: number },
): Promise<Uint8Array>;
```

- Create a `Channel<ArrayBuffer>` from `@tauri-apps/api/core` and invoke `stream_scan` with `{ name, chunkSize, onChunk }`.
- Call `onProgress` after each chunk with the running totals.
- Channel messages can still be arriving after the command's promise resolves. Wait until the number of chunks in the returned summary has been received. If they haven't all arrived within `timeoutMs` (default 5000) of the command resolving, reject with `ScanIncompleteError` (with `name` set to `'ScanIncompleteError'`).
- If the total byte count differs from `summary.bytes`, also reject with `ScanIncompleteError`.
- Resolve with all the bytes in order. Re-throw backend errors unchanged.

Delete `src/scanApi.ts`, since `read_scan` no longer exists.

All gates must pass: `cargo check`, `cargo test`, `tsc --noEmit`, `eslint` (zero warnings), `vitest`.
