# Status

Updated 2026-10-21, end of Phase 4. Awaiting owner approval for Phase 5 (reports).

## Phases

| Phase | State | Branch / commit |
|---|---|---|
| 0 Plan | done | `phase-0-plan` |
| 1 Scaffold, matrix, prices, schemas, adapters | done | `phase-1-scaffold` |
| 2 Task suite A–D, hidden tests, verification | done (tasks approved as-is with "go") | `phase-2-tasks` |
| 3 Orchestrator (`bench run`) | done | `phase-3-orchestrator` |
| 4 Live smoke (1 model, task A, N=1, ≤ $1) | done, **awaiting approval** | `phase-4-smoke` |
| 5 Reports | not started | |
| 6 CI, Pages, RUNBOOK | not started | |
| 7 Full sweep | not started | |

Branches are stacked (each phase branches from the previous one). No remote exists yet, so nothing is merged to `main` and no PRs are open.

## Phase 4 result (live smoke)

`claude-haiku-5-5` @ `low` (sent `thinking: adaptive`, `output_config.effort: low`), task A, N=1, ceiling $1.00. Run `2026-10-21T00-51-21Z_bbde84`, file `data/runs/1.0.0/2026-10-21T00-51-21Z_bbde84.ndjson`.

| | |
|---|---|
| Status | pass on the first turn (no retries) |
| Hidden tests | 23/23 |
| Tokens | 5,571 in, 5,522 out (Anthropic doesn't report thinking tokens separately) |
| Cost | $0.0033 |
| Time | model 20.3 s, wall-clock 36.9 s (gates 10.4 s, hidden tests and setup the rest) |
| Hygiene | 0 new `unsafe`, 0 new unwraps, 0 hallucination-class errors |
| Files | `src-tauri/src/lib.rs`, `src/api.ts`, `src/SeedVaultPanel.tsx`; no rejected edits |

Earlier Phase 3 checks still hold (70 unit tests, dry run of all 4 tasks).

## Decisions made

Full log in `docs/DECISIONS.md`. Key ones:
- Harness: TypeScript on Node 24, raw `fetch` to all three providers, npm.
- Non-agentic loop: whole-file edits in `=== FILE: path ===` / `=== END FILE ===` / `=== DELETE: path ===` blocks.
- Pass = every visible gate passes; hidden tests scored separately after the last turn.
- Capped, refused and errored attempts are recorded as failures. An attempt the dollar ceiling blocks before it sends anything is not recorded; `--only-new` resumes it.
- Spending needs `--live --usd-ceiling <USD>`. Dry runs go to `.bench-work/dry-runs/`, never `data/runs/`.
- Effort levels a model can't express are refused, never remapped.
- Hidden tests and references are encrypted in `hidden/tasks.enc`. Key: `~/.tauri-llm-bench/hidden.key` or `BENCH_HIDDEN_KEY`.

## Open questions for the owner

1. **Task A may be too easy.** The cheapest model at low effort passed all 23 hidden tests on its first try. N=1 proves little, but if every pair aces A, A can't tell them apart (a ceiling effect). The sweep will show it; if so, harden A in suite 1.1.0.
2. ESLint: stay a pass/fail gate (current), or become a hygiene metric only?
3. Back up `~/.tauri-llm-bench/hidden.key`.
4. Still unanswered from Phase 0: judge setup, λ, and whether the repo will be public. Defaults are in use.

## Next step

After the owner says "go": **Phase 5**, reports, generated from the smoke data (and dry-run data where a chart needs more than one point, clearly labelled):
- `bench report` → `reports/LEADERBOARD.md` (rankings, best value, badges) and a README section;
- standalone `reports/index.html`: Pareto scatter, failure heatmap, effort-scaling chart per model;
- `bench report diff --base model@high --target model@low` with a significance note from rep variance;
- routing table: cheapest acceptable pair per task class;
- reports refuse to rank across suite versions without `--cross-suite`.

Live runs need the key copied in per command (see DECISIONS, Phase 4).

## How to resume

```
npm ci && (cd tasks/_shared/frontend && npm ci)
npm run bench -- hidden decrypt
npm run bench -- tasks prepare
npm run bench -- tasks verify
npm test
npm run bench -- run --model claude-haiku-5-5 --effort low --dry-run --reps 1   # end-to-end, no API calls
# live (PowerShell): $env:BENCH_ANTHROPIC_API_KEY = [Environment]::GetEnvironmentVariable('BENCH_ANTHROPIC_API_KEY','User'); npm run bench -- run --live --usd-ceiling <USD> ...
```
