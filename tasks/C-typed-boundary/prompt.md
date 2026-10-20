# Field survey: typed IPC boundary

The field-survey frontend calls Tauri commands directly with `invoke` and treats every response as `any`. Some calls are also wrong at runtime. Refactor the frontend so that every IPC call goes through one strictly typed, runtime-validated boundary. The Rust backend in `src-tauri/src/lib.rs` is correct; read it for the real command signatures and payload shapes, but don't change it.

## The boundary (`src/ipc/`)

`src/ipc/schemas.ts` exports zod schemas `SiteSchema`, `ObservationSchema` and `NewObservationSchema` (zod 4 is installed), plus the inferred types `Site`, `Observation`, `NewObservation` and `Habitat`. They must match the Rust types exactly, including key casing, and also enforce:
- `id`, `siteId` and `count` are non-negative integers no larger than 4294967295;
- `lat` is between -90 and 90, `lon` between -180 and 180;
- `observedAt` is an RFC 3339 timestamp with a `Z` or numeric offset;
- `species` is non-empty after trimming;
- `notes` is a string or `null`;
- unknown keys are dropped.

`src/ipc/commands.ts` exports:

```ts
export class IpcContractError extends Error {
  readonly command: string;   // e.g. 'get_site'
  readonly issues: string[];  // at least one human-readable problem
}
export function getSite(siteId: number): Promise<Site>;
export function listObservations(siteId: number, since?: string): Promise<Observation[]>;
export function recordObservation(input: NewObservation): Promise<Observation>;
```

- Each function invokes its command with the argument names Tauri expects, and validates the response with the matching schema. An invalid response throws `IpcContractError` with `name` set to `'IpcContractError'`.
- Inputs are validated before anything is sent. `recordObservation` validates `input` with `NewObservationSchema` and sends the parsed value. `listObservations` requires `since`, when given, to be RFC 3339. Invalid input throws `IpcContractError` and makes no IPC call.
- When `since` is not given, the `since` key is left out of the arguments entirely.
- Errors returned by the backend (for example `"site 9 not found"`) are re-thrown unchanged, not wrapped.
- `src/ipc/` is the only place allowed to import `invoke`; the ESLint config enforces this.

## Components (`src/components/`)

Rewrite `SiteHeader`, `ObservationList` and `RecordForm` to use only the boundary, with no `any`. Keep their props, markup and texts, with these behaviours:
- `SiteHeader` and `ObservationList` show their existing `role="alert"` message for any failure, including contract errors.
- `RecordForm` sends `count` as an integer number. When the boundary rejects the input, the status reads `Invalid observation: ` followed by the first issue. Backend errors keep the existing `Could not save: …` text, and success keeps `Saved observation #…`.

All gates must pass: `cargo check`, `cargo test`, `tsc --noEmit`, `eslint` (zero warnings), `vitest`.
