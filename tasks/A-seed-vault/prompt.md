# Seed vault

A botanical garden keeps seed lots in a vault. Each lot has a code such as `TOM-0042` and a weight in whole grams. Build the Tauri backend commands and the React panel that staff use to withdraw seeds.

## Backend (`src-tauri/src/lib.rs`)

Keep these public items with these signatures; tests use them:

```rust
pub struct SeedVault { /* your fields */ }
impl SeedVault {
    pub fn with_lots<I, S>(lots: I) -> Self
    where I: IntoIterator<Item = (S, u32)>, S: Into<String>;
}
pub fn register<R: tauri::Runtime>(builder: tauri::Builder<R>, vault: SeedVault) -> tauri::Builder<R>;
```

`register` must put the vault in Tauri managed state and register three commands:

| Command | Arguments | Returns |
|---|---|---|
| `list_lots` | none | every lot, sorted by code ascending |
| `withdraw` | `code: string`, `grams: number` | the updated lot |
| `deposit` | `code: string`, `grams: number` | the updated (or newly created) lot |

A lot is serialised as `{ "code": "TOM-0042", "grams": 120 }`.

Rules:
- `grams` of 0 is rejected with `invalidAmount`. Check this first.
- `withdraw` on a code that doesn't exist: `unknownLot`. Withdrawing more than the lot holds: `insufficient`, and the lot is unchanged. A lot that reaches 0 g stays in the list.
- `deposit` to an unknown code creates the lot, but only if the code is three uppercase ASCII letters, a hyphen and four digits; otherwise `invalidCode`. A lot can never hold more than 10 000 g: a deposit that would exceed it fails with `capacityExceeded` and changes nothing.
- Commands can be called concurrently. A check and its update must be atomic, so the vault never goes negative and no update is lost.

Errors are returned as the command's error value and must serialise exactly as:

```json
{ "kind": "unknownLot", "code": "TOM-9999" }
{ "kind": "insufficient", "code": "TOM-0042", "available": 5, "requested": 10 }
{ "kind": "invalidAmount" }
{ "kind": "invalidCode", "code": "tom-1" }
{ "kind": "capacityExceeded", "code": "TOM-0042", "capacity": 10000 }
```

## Frontend

Create `src/api.ts` exporting:

```ts
export interface Lot { code: string; grams: number }
export type VaultError =
  | { kind: 'unknownLot'; code: string }
  | { kind: 'insufficient'; code: string; available: number; requested: number }
  | { kind: 'invalidAmount' }
  | { kind: 'invalidCode'; code: string }
  | { kind: 'capacityExceeded'; code: string; capacity: number };
export function listLots(): Promise<Lot[]>;
export function withdraw(code: string, grams: number): Promise<Lot>;
export function deposit(code: string, grams: number): Promise<Lot>;
export function isVaultError(value: unknown): value is VaultError;
export function describeVaultError(error: VaultError): string;
```

The three command wrappers call the backend with `invoke` from `@tauri-apps/api/core`, passing arguments as `{ code, grams }`. `isVaultError` must check the shape at runtime, including the fields each kind requires. `describeVaultError` returns exactly:

| kind | message |
|---|---|
| `unknownLot` | `Lot TOM-9999 does not exist` |
| `insufficient` | `Only 5 g left in TOM-0042 (requested 10 g)` |
| `invalidAmount` | `Amount must be at least 1 g` |
| `invalidCode` | `Lot code tom-1 must look like ABC-1234` |
| `capacityExceeded` | `Lot TOM-0042 cannot hold more than 10000 g` |

Create `src/SeedVaultPanel.tsx` exporting `function SeedVaultPanel(props: { step?: number })` (`step` defaults to 10):
- While the first `listLots` call is pending, show the text `Loading lots…`. If there are no lots, show `The vault is empty`.
- Show a table with one row per lot: the code, the weight as `120 g`, and a button labelled `Withdraw 10 g` (using `step`) with `aria-label="Withdraw 10 g from TOM-0042"`.
- The button is disabled when the lot holds less than `step` grams, and while a withdrawal for that lot is in progress.
- Clicking it calls `withdraw(code, step)` and updates that row with the returned lot.
- On failure show an element with `role="alert"` containing `describeVaultError(error)` for a vault error, or `Unexpected error` for anything else. Clear the alert after the next successful withdrawal. A failed `listLots` is reported the same way, and the loading text is removed.

`src/App.tsx` already renders the panel. All gates must pass: `cargo check`, `cargo test`, `tsc --noEmit`, `eslint` (zero warnings), `vitest`.
