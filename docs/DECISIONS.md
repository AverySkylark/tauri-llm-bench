# Decision log

Format: **Chose / Alternative / Why**. Reasons not witnessed from the owner are marked "(inferred)". Never rewrite entries; add a superseding one.

## 2026-10-21 — Phase 0 (proposals pending owner approval)

**Harness language.** Chose TypeScript on Node 24 (type stripping, no build step). Alternative: Rust or Python. Why: gates already need Node + Rust, so no third runtime; harness is I/O glue where TS is quicker to change; owner is a senior JS developer (from global CLAUDE.md).

**Provider calls via raw `fetch`.** Chose plain REST. Alternative: three vendor SDKs. Why: exact request (effort params, token caps) is visible, recordable and uniform across providers.

**Package manager.** Chose npm. Alternative: pnpm. Why: pnpm shim is broken on the dev box and npm is guaranteed on ubuntu-latest; no feature of pnpm is needed.

**Tauri version.** Chose pinned `tauri =2.12.4`. Alternative: latest (3.0.0-alpha). Why: SPEC.md specifies Tauri 2; alpha would add noise.

**Non-agentic loop (proposed).** Chose harness applies whole-file replacements, runs gates, feeds errors back (R ≤ 2). Alternative: provider tool-calling agent loop. Why: identical across providers and reproducible; agentic tool use mixes framework quality into the score.

**Hidden tests encrypted in-repo (proposed).** Chose AES-256-GCM archive, key in `BENCH_HIDDEN_KEY`. Alternative: plaintext folder outside working copy, or private repo. Why: a public repo (needed for free Pages) would leak plaintext tests into training data.

**Value Index.** Chose `Q / $` with Q = 0.8·hidden pass + 0.2·judge, quality bar before ranking, latency variant via λ $/h. Alternative: pass rate / $ alone. Why: without a bar, near-free failing models win; λ makes latency comparable in dollars.

**Judges not from Claude family by default (proposed).** Alternative: single Claude judge. Why: harness author is Claude; avoid self-preference.

## 2026-10-21 — Phase 1

**Phase 0 defaults adopted.** Owner replied "go" without answering the five open questions in PLAN §7, so the proposed defaults stand: non-agentic loop, encrypted in-repo hidden tests, two non-Claude judges, λ = $60/h, repo assumed public. (Approval inferred from "go"; revisit if the owner objects.)

**Starter matrix: Claude Haiku 5.5 + Gemini 3.5 Flash-Lite, efforts low and high.** Alternative: GPT-5.4 mini. Why: cheapest current model per provider with a non-floating ID, and two providers exercise two adapters. GPT-5.4 mini is 3–7x the price; its adapter and price entry exist but it is not in the matrix yet. low/high is the widest range both models support.

**Raw `fetch` kept for Anthropic too.** Alternative: `@anthropic-ai/sdk` (Anthropic's own guidance defaults to the SDK). Why: same reasoning as Phase 0 — one uniform, fully recorded request shape across three providers; SDK convenience isn't needed for single non-streaming calls.

**Model pinning has three accepted kinds: `dated_snapshot`, `fixed_id`, `stable_code`.** Alternative: dated snapshots only. Why: Anthropic 5.x IDs are fixed with no date suffix, and Google publishes no dated snapshot for Gemini 3.5 Flash-Lite. Anything containing "latest" is rejected by schema; the pin kind is recorded so reports can flag `stable_code` models as less reproducible.

**Unsupported effort levels are refused, not remapped.** Alternative: map to the nearest level. Why: Gemini 3.5 Flash-Lite has no "off" (lowest is `minimal`) and nothing above `high`; mapping would make `none`/`max` mean different things per provider. Unknown models also fail until a rule is added to `adapters/effort.ts`.

**Anthropic reasoning tokens recorded as null.** Why: the Messages API bills thinking inside `output_tokens` and doesn't break it out; cost is still exact.

**Dry-run uses fake transports behind the real adapters.** Alternative: a separate fake adapter. Why: the real request builders and response parsers run in dry-run, so it tests what a live run will do.

## 2026-10-21 — Phase 2

**Tauri mock runtime for gates.** Chose `tauri` with `default-features = false, features = ["test"]`. Alternative: full Tauri build with WebView (webkit2gtk / WebView2). Why: no WebView system dependency, cold build 41 s and ~1 s warm, while still exercising real IPC deserialisation, ACL, events and channels. Verified by probe before committing to it.

**One shared Cargo.lock, crate name and target dir for all tasks.** Alternative: a lock and target dir per task. Why: dependencies compile once; each attempt only rebuilds the task crate. Gates run `--offline --locked`, so a model can't pull in crates.

**Materialised files get a fresh mtime.** Why: on Windows, copies keep the source mtime, and cargo reused stale test binaries from an earlier working copy at the same path (the scaffold "passed" cargo test). Found during Task A verification.

**ESLint preset `recommendedTypeChecked`, not `strictTypeChecked`.** Alternative: strict. Why: strict flags idiomatic React (`onChange={(e) => setX(e.target.value)}`) and deprecated-type notices, which measures style, not correctness, and the scaffolds themselves use the pattern. `no-explicit-any` stays an error.

**B's listeners moved to a public `listen_for_readings(&AppHandle)`.** Why: Tauri runs `setup` only when the event loop starts, which the mock app never does in tests.

**D's data path is tested by calling `stream_scan_file` directly.** Why: a `Channel` passed through mock IPC sends to the mock webview, where nothing can observe it. The command's error contract and registration are still tested through IPC.

**Hidden-test key lives at `~/.tauri-llm-bench/hidden.key` (or `BENCH_HIDDEN_KEY`).** Alternative: owner supplies a key. Why: needed to encrypt now; outside the repo; the owner must back it up and add it as a CI secret.

**Suite version 1.0.0.**

## 2026-10-21 — Phase 3

**Tasks approved as they stand.** Owner said "go" to Phase 3 without bias-review comments, so suite 1.0.0 is unchanged. (Approval inferred from "go".) ESLint stays a pass/fail gate for now. Every gate result is stored separately, so reports can also show pass rate without ESLint, with no rerun.

**Reply format: line markers, not code fences.** Chose `=== FILE: path ===` … `=== END FILE ===` and `=== DELETE: path ===`. Alternative: Markdown fences with a path label. Why: a file can contain fences, and fence label styles vary by model. A fence wrapped around a whole file body is stripped (a habit of every provider). A block missing its END line is dropped, never applied half-written, and the model is told.

**Pass = every visible gate passes.** Hidden tests are scored separately (passed/total) after the last turn, also for failed or capped attempts. The Value Index rules (PLAN §6) decide how those count. Hidden tests are copied into the working copy only after the model's final reply.

**Output-token cap hit = `capped_tokens`, and the reply is not applied.** Alternative: apply the complete blocks and continue. Why: SPEC says capped runs are failures; a truncated reply is usually missing files.

**Timeout counts model time only.** Gate time depends on the machine, not the model, and each gate has its own 5-minute limit. A provider timeout is `capped_timeout` and is not retried.

**Dollar ceiling is checked before every request against its worst case** (prompt chars ÷ 3 as input tokens + the full output cap), so a run stops short of the ceiling instead of crossing it. If the ceiling blocks an attempt before it sends anything, no attempt record is written (it never started) and `--only-new` picks it up later. If it blocks a retry mid-attempt, the attempt is recorded as `capped_usd`, a failure.

**Transient API errors (429, 5xx, dropped connection) retry up to 3 times (2 s, 10 s, 30 s).** These retries are not counted against R, which is only for the model fixing its own errors. Other 4xx errors are `api_error`.

**Spending needs `--live` and an explicit `--usd-ceiling`.** Alternative: live by default with the matrix ceiling. Why: the owner's rule is no spend without a confirmed ceiling. Dry runs write to `.bench-work/dry-runs/` (gitignored) so they never mix with real data in `data/runs/`.

**`--only-new` treats any recorded attempt as done, including failures.** Dry and live runs are kept apart. The plan runs reps outermost, so a run stopped early leaves an even sample across pairs.

**Attempts run one after another.** Alternative: run model calls in parallel. Why: all gates share one cargo target dir. Model calls could overlap later if sweep time matters.

**Gate errors fed back are trimmed.** At most 6000 characters per failing gate and 24 000 in total, keeping the end of the output, with working-copy paths replaced by `.`.

## 2026-10-21 — Phase 4

**API key lives in the owner's Windows user environment, set by the owner outside Claude Code.** Alternative: paste it into the chat, or keep a `.env` file. Why: anything pasted into the chat stays in the transcript, and PROMPT.md forbids keys in files. Claude Code's own process predates the variable, so each live command copies it from the user scope into that one process (`$env:X = [Environment]::GetEnvironmentVariable('X','User')`). The key is never printed.

**Smoke result: committed as real data.** The run file `data/runs/1.0.0/2026-10-21T00-51-21Z_bbde84.ndjson` is the first live record. It's kept, not discarded as a test, because SPEC says runs are append-only results.
