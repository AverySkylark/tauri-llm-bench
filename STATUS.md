# Status

Updated 2026-10-21, end of Phase 5 (+ mini-sweep, output cap 32k for high/max effort). Awaiting owner approval for Phase 6 (CI, Pages, RUNBOOK).

## Phases

| Phase | State | Branch / commit |
|---|---|---|
| 0 Plan | done | `phase-0-plan` |
| 1 Scaffold, matrix, prices, schemas, adapters | done | `phase-1-scaffold` |
| 2 Task suite A–D, hidden tests, verification | done (tasks approved as-is with "go") | `phase-2-tasks` |
| 3 Orchestrator (`bench run`) | done | `phase-3-orchestrator` |
| 4 Live smoke (1 model, task A, N=1, ≤ $1) | done | `phase-4-smoke` |
| 5 Reports | done, **awaiting approval** | `phase-5-reports` |
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

## Phase 5 result (reports)

`bench report` writes `reports/LEADERBOARD.md`, `reports/routing.md`, `reports/index.html` and the README leaderboard block. `bench report diff --base m@e --target m@e` prints a per-task comparison with a bootstrap significance note.
- Built from the one live attempt: it ranks nothing yet. One pass out of one has a Wilson lower bound of 21 %, below the 40 % bar, and the report says so instead of crowning a winner.
- Charts (Pareto scatter, pass/fail heatmap, effort scaling per model) were checked against a 72-attempt synthetic dataset. Screenshots were taken in light, dark and narrow mode. Simulated reports go to `.bench-work/dry-runs/reports/` with a SIMULATED banner and never into `reports/`.
- Rebuilding from the same data gives byte-identical files.
- 84 unit tests pass (14 new for reports).

## Mini-sweep (owner-approved, ceiling $0.50)

Run `2026-10-21T01-06-01Z_59ad6d`: Claude Haiku 5.5 at low and high effort × tasks A–D × 1 rep, with `--only-new` (A@low came from the smoke run). Gemini skipped at the owner's request. 7 attempts, $0.0427: 6 passed, and C@high was `capped_tokens` (16,000-token cap hit while thinking). Reports rebuilt from 8 live attempts. `haiku@low` is the first pair ranked; `haiku@high` is flagged "no measurable gain" at 1.7× the cost.

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

1. **Task A may be too easy.** Claude Haiku 5.5 at low effort passed all 23 hidden tests on its first try. The sweep will show whether every pair aces it; if so, harden A in suite 1.1.0.
2. ESLint: stay a pass/fail gate (current), or become a hygiene metric only?
3. Back up `~/.tauri-llm-bench/hidden.key`.
4. **Public repo?** GitHub Pages on a free account needs a public repo. Hidden tests stay encrypted either way. Phase 6 needs the answer, plus a repo name and permission to create the remote and push.
5. Still unanswered from Phase 0: judge setup and λ. Defaults are in use.
6. **Mixed caps in `haiku@high`.** Its 4 recorded attempts ran with a 16k cap; new ones run with 32k (matrix v2). Reports group by model@effort, so they will mix unless the owner wants pairs split by cap, or those 4 attempts left out of rankings.
7. **Long requests may hit Node's 300 s header timeout.** Non-streaming `fetch` waits for the whole reply before headers arrive; undici's default `headersTimeout` is 300 s, below the 600 s attempt timeout. Such a failure looks like a network error and would be retried (and billed) up to 3 more times. Fine for Haiku (about 2 min at 32k); fix before the full sweep (raise undici timeouts, or stream).

## Next step

After the owner says "go" (and answers question 4): **Phase 6**:
- `.github/workflows/reports.yml`: on push, test, rebuild reports, deploy `reports/` to Pages. Never spends money.
- `.github/workflows/sweep.yml`: `workflow_dispatch` only, with a required dollar-ceiling input. Secrets: `BENCH_*_API_KEY`, `BENCH_HIDDEN_KEY`. Commits the run file and the rebuilt reports.
- CI needs Rust, Node 24 and the shared caches (`tasks prepare`) on ubuntu-latest.
- `docs/RUNBOOK.md`: add a model and publish in under 15 minutes. State full-sweep wall-clock and cost separately, estimated from the smoke data: about 37 s and $0.0033 per Haiku attempt on task A.

## How to resume

```
npm ci && (cd tasks/_shared/frontend && npm ci)
npm run bench -- hidden decrypt
npm run bench -- tasks prepare
npm run bench -- tasks verify
npm test
npm run bench -- run --model claude-haiku-5-5 --effort low --dry-run --reps 1   # end-to-end, no API calls
npm run bench -- report        # rebuild reports/ and the README block from data/runs
# live (PowerShell): $env:BENCH_ANTHROPIC_API_KEY = [Environment]::GetEnvironmentVariable('BENCH_ANTHROPIC_API_KEY','User'); npm run bench -- run --live --usd-ceiling <USD> ...
```
