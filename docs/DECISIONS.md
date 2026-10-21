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
