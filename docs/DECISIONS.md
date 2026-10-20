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
