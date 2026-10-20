You are building and then running the benchmark harness specified in SPEC.md in this folder (Windows, repo root = current directory). Read SPEC.md fully before doing anything.

Rules:
- Work in phases. At the end of EACH phase: commit to Git, print a short summary, and STOP for my approval. Do not start the next phase until I say "go".
- Push back on any requirement in SPEC.md that is flawed or unmeasurable before building it.
- Before each phase print: `[Tier] Class: Cx | Recommended: <model>/<effort> | Current fit: OK/Under/Over`.
- Never spend API money without my explicit go-ahead and a dollar ceiling I confirm.
- Harness language: your call (justify in one paragraph in Phase 0). Must run on Windows 11 and ubuntu-latest in GitHub Actions.
- Never put API keys in files. Read from env vars: BENCH_ANTHROPIC_API_KEY, BENCH_OPENAI_API_KEY, BENCH_GOOGLE_API_KEY (skip providers whose key is missing). Never read plain ANTHROPIC_API_KEY — that belongs to Claude Code itself.

Phases:
0. Plan: check toolchain (rustc, cargo, node, pnpm/npm, Tauri prerequisites: MSVC build tools + WebView2 on Windows, webkit2gtk on Linux CI). Report what's missing with install commands. Propose repo layout, harness language, JSON Schema outline, Value Index formula. STOP.
1. Scaffold repo, matrix.yaml (2 cheap models × 2 efforts only, to start), price table v1, JSON Schema, provider adapters with effort normalisation + dry-run mode (no API calls, fake responses). Unit tests for adapters. STOP.
2. Task suite A–D with scaffolds, prompts, acceptance criteria, visible gates, and HIDDEN tests stored outside the model's working copy. Verify every task's scaffold FAILS the gates before a fix and a reference solution PASSES. STOP — I will review tasks for bias before any live run.
3. Orchestrator: `bench run` (all three modes), retry loop, caps, NDJSON writer, dry-run end to end. STOP.
4. Smoke test LIVE: one cheap model, one effort, task A, N=1, ceiling USD 1. Show cost and results. STOP.
5. Reports: leaderboard Markdown, HTML deep-dive, `report diff`, routing table. Generate from smoke data. STOP.
6. GitHub Actions workflow + Pages deploy + RUNBOOK.md. Estimate full-sweep time and cost from smoke data. STOP.
7. Full sweep only when I say so, with the ceiling I give.
