Shared files for every task.

- `template/` is copied into each working copy first; the task scaffold is laid over it.
- `frontend/` holds the one `node_modules` every working copy links to (installed once, offline afterwards).
- `Cargo.lock` is copied into `src-tauri/` so every attempt builds with `--locked --offline` against one warm target dir.
