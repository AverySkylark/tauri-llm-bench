# Tauri 2 LLM Benchmark Harness — Requirements

Stack under test: Tauri 2.0 · Rust (IPC commands, state, error handling, Tokio) · React + TypeScript (Vite, hooks).
Goal: an independent, repeatable harness measuring daily dev performance, code quality and value for money of LLM model × reasoning-effort pairs. Standalone Git repo; rerunnable whenever new models drop.

## 1. Task suite (4–5 tasks, each tagged C1 Trivial → C4 Critical)
- A Greenfield: Tauri IPC command bridging Rust state to a typed React component.
- B Debugging: async Rust concurrency / borrow-checker panic in Tauri event listeners.
- C Refactor: untyped frontend IPC calls → strictly validated TS boundaries.
- D Systems: binary payload streaming, capabilities/permissions, or native window management.
Each task: explicit prompt, mock scaffold, acceptance criteria, automated gates (cargo check, cargo test, tsc --noEmit, ESLint, Vitest). Hidden tests the model never sees.

## 2. Matrix & orchestration
- Versioned matrix.yaml: provider, pinned snapshot model ID (never "latest"), effort, max output tokens, temperature, price table version.
- Provider adapter layer mapping normalised effort (none|low|medium|high|max) to native params (named levels, thinking budgets, or none). Record both values per run.
- Identical suite, prompts, scaffold and tool access for every pair. N=3 reps default (mean, best, pass@k). Retry loop feeds compiler/test errors back up to R=2. Hard caps: timeout, token ceiling, dollar ceiling — capped run = failure, never discarded.
- CLI: `bench run --matrix matrix.yaml` · `bench run --model <id> --effort <level> --task <id>` · `bench run --only-new`.
- Escalation analysis: cheapest pair meeting the bar per class; flag effort levels adding cost without measurable gain.

## 3. Metrics
- Quantitative: pass rate, first-pass compile, tokens (in/out/reasoning), latency, $ cost from versioned price snapshot.
- Qualitative: idiomatic Rust/React, memory safety, Tauri capability compliance, hallucination rate. Pinned, blinded LLM judge and/or human; judge scores stored separately from gate results.
- Value Index: defined formula (e.g. quality per $1), latency-adjusted variant, Pareto frontier over cost/quality/latency.

## 4. Storage
- Append-friendly, Git-friendly (NDJSON per run, optional DuckDB/SQLite build). Full JSON Schema: metadata (run ID, timestamp, model, provider, normalised+native effort, matrix hash, suite version, price table version, harness commit), telemetry, per-task results (status, compiler output, retries, rep index, diff, scores).
- Retention/migration rules. Never rank across suite versions without an explicit flag.

## 5. Reports
- README.md + LEADERBOARD.md tables (rankings, badges, best value).
- Standalone HTML deep-dive: Pareto scatter, failure heatmap, effort-scaling chart per model.
- `report diff --base model-a@high --target model-a@low` with significance note from rep variance.
- Routing table: cheapest acceptable pair per task class.

## 6. Repo, CI, runbook
- Clean dirs: harness, adapters, tasks, matrix configs, price tables, data/runs/, reports/.
- GitHub Actions: auto-commit runs, rebuild leaderboard, deploy reports to Pages. Keys in secrets; dollar ceiling per run.
- Runbook: add model + publish report in < 15 min. State full-sweep wall-clock and cost separately.

## Bias flags to address in design
Contamination (public tasks in training data), judge self-preference, prompt favouritism toward one provider, small N, harness author (an LLM) designing tasks that suit itself.
