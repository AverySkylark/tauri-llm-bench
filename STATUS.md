# Status

Updated 2026-10-22 (sweep estimate redone for matrix v3), end of Phase 6 (CI, Pages, RUNBOOK). Awaiting owner approval, and an answer to open question 4 before anything is pushed.

## Phases

| Phase | State | Branch / commit |
|---|---|---|
| 0 Plan | done | `phase-0-plan` |
| 1 Scaffold, matrix, prices, schemas, adapters | done | `phase-1-scaffold` |
| 2 Task suite A–D, hidden tests, verification | done (tasks approved as-is with "go") | `phase-2-tasks` |
| 3 Orchestrator (`bench run`) | done | `phase-3-orchestrator` |
| 4 Live smoke (1 model, task A, N=1, ≤ $1) | done | `phase-4-smoke` |
| 5 Reports | done (approved with "go") | `phase-5-reports`, then `mini-sweep-haiku`, `cap-32k-high-effort` |
| 6 CI, Pages, RUNBOOK | done locally, **awaiting approval**; workflows not yet run (no remote) | `phase-6-ci` |
| 7 Full sweep | not started | |

Branches are stacked (each phase branches from the previous one). Remote: https://github.com/AverySkylark/tauri-llm-bench (public). Stacked PRs #3–#10 are open (phase 0 → main, each later one on the previous branch); merge in order. Head branches are deleted on merge, so each next PR retargets automatically. Phase 6 is PR #11 (base `cap-32k-high-effort`). Bug issues: #1 (300 s header timeout, fixed in #10), #2 (gate env leak, fixed in #11), #12 (unit tests needed the real hidden tests, fixed in #11).

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

## Phase 6 result (CI, Pages, runbook)

- `.github/workflows/ci.yml`: on every push and PR, typecheck and unit tests on Ubuntu and Windows; `tasks verify` plus a dry run on Ubuntu (needs the `BENCH_HIDDEN_KEY` secret). Never spends money.
- `.github/workflows/pages.yml`: on push to `main` (runs, reports, matrix, prices), manual, or called by the sweep. Rebuilds reports, commits them if changed, deploys `reports/` to Pages from `main` only.
- `.github/workflows/sweep.yml`: manual dispatch only. Required `usd_ceiling`; scope `only-new` | `matrix` | `single`; optional tasks and reps. Inputs go through `env` and are pattern-checked. Commits the run file even when the run fails or hits the ceiling, rebuilds reports, then calls `pages.yml`. One sweep at a time, never cancelled.
- `.github/actions/setup-bench`: Node 24, Rust 1.99.1 (pinned to the local version), Tauri apt packages, cargo and npm caches, hidden-test decrypt, `tasks prepare`.
- `docs/RUNBOOK.md`: setup, secrets, Pages, add-a-model steps (target under 15 min, not yet timed), full-sweep estimate, safety, troubleshooting. Linked from the README.
- **Security fix:** gates inherited the whole environment, so model-written tests could read the API keys and the hidden-test key. Gates now drop `BENCH_*`, `ACTIONS_*` and anything named like a key, token, secret, password or credential. Unit test added; task A re-verified (scaffold fails, reference passes, 23/23 hidden). Commit `fbb2d1d`. Needs a GitHub issue labelled `bug` once the remote exists.
- Checked locally: YAML parses, the sweep's input checks accept and reject the right values, 91 unit tests and typecheck pass, reports rebuild byte-identical. **Not checked:** the workflows have never run on GitHub (no actionlint here either). Expect a fix-up commit or two on the first push.

### Full-sweep estimate (matrix v3: 84 attempts)

Matrix v3 (commit `aea3094`) drops Gemini and adds Sonnet 5.5 at none, low, medium, high and max; Haiku stays at low and high. Haiku numbers are measured from the 8 live attempts. Sonnet has no data, so its numbers are inferred: Haiku's token counts at Sonnet's prices, and Haiku's speed as a floor.

| | Wall-clock | Cost |
|---|---|---|
| Haiku low + high (24 attempts) | about 20 min | $0.14 |
| Sonnet, 5 efforts (60 attempts, inferred) | about 51 min or more | about $6.90 |
| **Whole matrix** | **about 71 min or more** + CI setup (not measured) | **about $7.04** |

Retries, the 32k cap at high/max and slower runners push these up. Suggested first-sweep ceiling: $15.00. Details in RUNBOOK §3.

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
4. Resolved: public repo `tauri-llm-bench` (owner, 2026-10-22). Owner still adds secrets and sets Pages source (RUNBOOK §1).
7. Resolved: hidden-test leak accepted and watched (owner, 2026-10-22); RUNBOOK §4 says what to look for.
5. Still unanswered from Phase 0: judge setup and λ. Defaults are in use.
6. Resolved: the 300 s fetch header timeout (now `node:https`), and mixed caps (split rows, option b).

**Paused:** a rerun of `haiku@high` at the 32k cap (owner-approved, ceiling $0.50) was stopped during its first attempt; the owner chose to leave it for now. It left an untracked run file holding only its header line, `data/runs/1.0.0/2026-10-21T01-18-50Z_3f5e71.ndjson`, and a scratch copy `.bench-work/attempt-2d7e4824eb30ae2e`. Neither is committed. To resume: `bench run --live --usd-ceiling 0.5 --model claude-haiku-5-5 --effort high --reps 1` (about $0.03).

## Next step

CI on PR #11: unit tests pass on Ubuntu and Windows. `verify-tasks` now skips with a warning while `BENCH_HIDDEN_KEY` is unset (commit `4641902`), so its green check does not yet mean the Linux gates work. Checked 2026-10-22: no repo secrets set, Pages not enabled. Local `phase-6-ci` is ahead of the remote by the matrix-v3 and estimate commits; not pushed.

1. **Owner:** add secrets (`BENCH_HIDDEN_KEY`, `BENCH_ANTHROPIC_API_KEY`, optionally `BENCH_GOOGLE_API_KEY`), set Pages source to GitHub Actions, then re-run CI on #11.
2. Fix whatever `verify-tasks` hits on Linux (first real run of the Tauri build there; `ubuntu-latest` is moving to Ubuntu 26, so apt package names may need a check). Measure CI setup time cold and warm; add it to RUNBOOK §3.
3. Owner merges PRs #3 → #11 in order. The first push to `main` runs `pages.yml`.
4. Phase 7 (full sweep) only when the owner says so, with their ceiling. The paused `haiku@high` 32k rerun is covered by `--only-new`.

Pushing from Claude Code's shell: SSH host key isn't set up, so push over HTTPS with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push`. The `gh` token now has the `workflow` scope.

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
