# Phase 0 — Plan

Status: proposal, awaiting owner approval. Nothing here is built yet.

## 1. Toolchain check (Windows 11 dev box, 2026-10-21)

| Tool | Found | Notes |
|---|---|---|
| rustc / cargo | 1.99.1 (MSVC toolchain) | OK. Tauri 2.12 needs ≥ 1.90 |
| clippy / rustfmt | present | OK |
| node / npm | 24.20.0 / 12.2.0 | OK |
| pnpm | **broken** | Corepack shim points at a missing cache (`pnpm 12.14.0`). Not needed: plan uses npm |
| MSVC build tools | VS Build Tools 2022 (VC x86/x64) | OK |
| WebView2 | 155.0.4283.62 | OK |
| tauri-cli | **missing** | Not needed for gates (no bundling). Only if you want to launch task apps by hand |
| git / gh | 2.51 / 2.79 | OK. No remote configured yet |
| Disk free | 130 GB | OK (shared cargo target dir ≈ 3–5 GB) |

Optional fixes:
```powershell
# pnpm (only if you want it; harness uses npm)
corepack prepare pnpm@latest --activate     # or: npm i -g pnpm
# Tauri CLI (optional, manual inspection only)
cargo install tauri-cli --version "^2" --locked
```
Linux CI (ubuntu-latest), installed in the workflow:
```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev \
  libayatana-appindicator3-dev libssl-dev build-essential pkg-config
```
Version pin: crates.io latest is `tauri 3.0.0-alpha.5`; the spec says Tauri 2, so tasks pin `tauri = "=2.12.4"` and `@tauri-apps/api@2.12.4`.

## 2. Push-back on SPEC.md (needs your call before Phase 1)

1. **"Tool access" is undefined — this is the biggest open decision.** Agentic tool use (model reads files, runs commands) differs by provider and measures the agent framework as much as the model. **Proposal:** harness-driven loop, no tool calling. The model gets the prompt + all scaffold files inline, replies with whole-file replacements in one fixed fence format; the harness applies them, runs the gates, and feeds errors back (R ≤ 2). Same for every provider, cheap, reproducible. Trade-off: doesn't test multi-step exploration. An agentic mode can be added later as a separate suite version.
2. **Hidden tests in a public repo are not hidden.** If the repo is public (Pages from a free account requires public), hidden tests and reference solutions get scraped into training data → contamination. **Proposal:** store them as an AES-256-GCM encrypted archive in the repo, key in env `BENCH_HIDDEN_KEY` (Actions secret). They are decrypted only into the gate sandbox *after* the model's final answer.
3. **Model output executes code on your machine.** `cargo test` runs `build.rs`, proc macros and tests the model wrote. **Proposal:** whitelist of editable paths per task (no `build.rs`, `Cargo.toml`, `package.json`, configs unless the task says so), gates run offline (`cargo --offline`, pre-installed `node_modules`), and on CI inside the ephemeral runner. Locally on Windows there is no real sandbox; I'll say so in the RUNBOOK. Optional: run gates in WSL/Docker.
4. **One task per class ⇒ routing by class is really routing by task.** 4 tasks × C1–C4 means "cheapest pair per class" rests on one task each. I'll build it as specified but label it, and recommend growing to 2 tasks/class in a later suite version.
5. **N=3 is small.** 4 tasks × 3 reps = 12 samples per pair: a 75 % vs 92 % pass rate is not distinguishable. Reports will show Wilson 95 % intervals, and `report diff` will say "no significant difference" rather than rank noise. Recommend N=5 for finalists.
6. **Effort levels are not equivalent across providers.** `high` on one API ≠ `high` on another. The normalised level is a label; the native value is recorded per run and shown in reports. If a model doesn't support a level (e.g. `none` on a reasoning-only model) the pair is marked *unsupported* and skipped, not silently mapped.
7. **Temperature is often not settable.** Reasoning modes on several providers fix or reject temperature. matrix.yaml allows `temperature: provider_default`; the value actually sent is recorded.
8. **"Hallucination rate" and "memory safety" need operational definitions:**
   - Hallucination = first-attempt compiler errors that name things that don't exist (Rust E0425/E0432/E0433/E0599/E0609; TS2305/TS2339/TS2307/TS2724), plus judge-flagged invented APIs. Reported as rate per attempt.
   - Memory safety (safe Rust already rules out most of it) → "panic & unsafe hygiene": new `unsafe` blocks, `unwrap()/expect()` in command/IPC paths, panics in hidden tests, `clippy` warnings.
   - Capability compliance = automated check of `capabilities/*.json`: no wildcard permissions, no permissions beyond the task's allow-list.
9. **The harness author is a contestant.** I (Claude Opus 5.5) am writing tasks that Claude models will be scored on. Mitigations: you review tasks before any live run (Phase 2 stop); prompts are plain and provider-neutral (no XML tags or provider-specific phrasing); the judge is **not** a Claude model by default and never judges its own family; optionally ask a non-Claude model to review the task suite for bias.
10. **Judge self-preference.** Blinding: the judge sees only the rustfmt/prettier-normalised diff, comments stripped of model names, random pair IDs. Default: two judges from two other families, median score; when a judged model's family matches a judge, that judge is dropped for that sample.
11. **"Add a model in < 15 min"** is realistic for config + one-task smoke + publish, not including a sweep. The runbook will state the full-sweep time separately (as the spec says).
12. **CI must never spend money on push.** The sweep workflow is `workflow_dispatch` only, with a required dollar-ceiling input; push builds only rebuild reports from committed data.

## 3. Harness language: TypeScript on Node 24

The gates already require Node (tsc, ESLint, Vitest) and Rust, so the harness should add no third runtime — that rules out Python. Between TS and Rust: the harness is I/O glue (HTTP to three providers, YAML/JSON, spawning cargo/npm, writing NDJSON, generating HTML), where TS is faster to write and change, has first-class JSON Schema validation (Ajv) and charting for the HTML report, and you read it fluently; Rust would add compile time to every harness change for no measurable benefit. Node 24 runs `.ts` directly (type stripping), so no build step; `tsc --noEmit` and Vitest check the harness itself. Provider calls use plain `fetch` against the REST APIs rather than three vendor SDKs, so the exact request (effort param, max tokens) is visible, recordable and identical in shape across providers. Works the same on Windows 11 and ubuntu-latest.

## 4. Repo layout

```
harness/            CLI + orchestrator + gates runner + reports (TypeScript)
  cli.ts            bench run | bench report | bench report diff | bench hidden (encrypt/decrypt)
  orchestrator/     matrix expansion, rep/retry loop, caps, NDJSON writer
  gates/            cargo check/test, tsc, eslint, vitest, capability check, error classifier
  report/           leaderboard.md, deep-dive.html, diff, routing table
  judge/            blinded LLM judge (separate output stream)
adapters/           anthropic.ts, openai.ts, google.ts, fake.ts (dry-run), effort.ts (normalisation)
tasks/
  A-ipc-greenfield/   task.yaml (class, editable paths, gates), prompt.md, scaffold/
  B-async-debug/
  C-typed-boundary/
  D-systems/
  _shared/            pinned Cargo.lock, package-lock.json, eslint/tsconfig
hidden/             tasks.enc (encrypted hidden tests + reference solutions); plaintext gitignored
matrix/matrix.yaml  versioned; + matrix/full.yaml later
prices/v1.yaml      $ per MTok in/out/cached/reasoning per model, with source URL + date
schema/             run.schema.json, judgement.schema.json
data/runs/<suite_version>/<run_id>.ndjson
data/judgements/<suite_version>/<run_id>.ndjson
reports/            LEADERBOARD.md, index.html (Pages), routing.md
docs/               PLAN.md, DECISIONS.md, RUNBOOK.md
.github/workflows/  reports.yml (on push), sweep.yml (manual, ceiling input)
```
Gates run in a temp working copy per attempt (outside the repo) with a shared, pre-warmed `CARGO_TARGET_DIR` per suite version so each attempt compiles only the task crate, not Tauri.

## 5. JSON Schema outline (one NDJSON file per run; one JSON object per line)

Discriminated by `record`:

```jsonc
// line 1
{ "record": "run", "schema_version": 1,
  "run_id": "2026-10-21T10-00-00Z_ab12cd", "started_at": "...", "finished_at": "...",
  "harness_commit": "sha", "suite_version": "1.0.0", "matrix_hash": "sha256", "price_table_version": "v1",
  "mode": "matrix|single|only_new", "dry_run": false, "host": { "os": "...", "rustc": "...", "node": "..." },
  "caps": { "timeout_s": 600, "max_output_tokens": 16000, "usd_ceiling": 1.0 } }

// one per (pair × task × rep)
{ "record": "attempt", "run_id": "...", "attempt_id": "...",
  "pair": { "provider": "anthropic", "model": "<pinned snapshot>", "effort_norm": "low",
            "effort_native": { "param": "...", "value": "..." }, "temperature_sent": null, "max_output_tokens": 16000 },
  "task": { "id": "A", "class": "C2", "rep_index": 0 },
  "status": "pass|fail|capped_timeout|capped_tokens|capped_usd|api_error|unsupported",
  "first_pass_compile": true,
  "iterations": [ { "n": 0, "request_tokens": {"in":0,"cached_in":0,"out":0,"reasoning":0},
                    "latency_ms": 0, "cost_usd": 0,
                    "gates": { "cargo_check": {"ok":true,"ms":0,"output_tail":"..."}, "cargo_test": {}, "tsc": {}, "eslint": {}, "vitest": {}, "capabilities": {} },
                    "error_classes": ["E0599"] } ],
  "hidden": { "passed": 7, "total": 9 },
  "telemetry": { "tokens": {...totals}, "latency_ms": 0, "wall_ms": 0, "cost_usd": 0 },
  "diff": "unified diff vs scaffold (normalised)",
  "hygiene": { "unsafe_added": 0, "unwraps_in_ipc": 1, "clippy_warnings": 2, "hallucination_errors": 0 } }

// last line
{ "record": "summary", "run_id": "...", "attempts": 12, "cost_usd": 0.43, "aborted": false, "abort_reason": null }
```
Judge scores live in `data/judgements/…` keyed by `attempt_id`, with judge model, rubric version, blinding salt, and per-criterion scores — never inside the run file. Retention: run files are append-only and never edited; schema changes bump `schema_version` and ship a migration script in `harness/migrate/`. Reports group by `suite_version` and refuse to rank across versions unless `--cross-suite` is passed (rendered with a warning banner).

## 6. Value Index

Per pair, over all its attempts (capped/failed attempts included at full cost, score 0):

- **H** = mean hidden-test pass fraction (an attempt whose gates don't compile scores 0).
- **J** = mean judge score normalised to 0–1 (median of judges per attempt).
- **Quality** `Q = 0.8·H + 0.2·J`  (if no judge run yet: `Q = H`, flagged).
- **C** = mean $ per attempt, including retries.
- **T** = mean wall-clock minutes per attempt (model latency + gate time).

**Value Index** `VI = Q / C` → "quality points per $1".
**Latency-adjusted** `VI_t = Q / (C + λ·T/60)` with λ = developer time value in $/hour (default **$60/h**, set in matrix.yaml and printed on every report). This turns waiting time into dollars, so a slow cheap model and a fast pricey one compare on one axis.
**Bar:** a pair is only ranked on VI if `Q ≥ 0.6` and pass rate's Wilson lower bound ≥ 0.4 — otherwise a near-free model that fails everything would top the table. Both thresholds live in config.
**Pareto frontier** over (C ↓, Q ↑, T ↓): non-dominated pairs, plotted in the HTML report.
**Effort flag:** a higher effort is flagged "no measurable gain" when its Q isn't significantly above the next-lower effort for the same model (bootstrap over attempts, 95 %) while costing more.

## 7. Open questions for you

1. Approve the harness-driven (non-agentic) loop in §2.1?
2. Encrypted hidden tests in-repo (§2.2) OK, or do you prefer a separate private repo?
3. Judge: two non-Claude judges by default (§2.10) — OK? Judge runs cost money, so they get their own ceiling.
4. λ = $60/h for the latency-adjusted index?
5. Will the GitHub repo be public (needed for free Pages)?
