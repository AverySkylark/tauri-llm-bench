# Status

Updated 2026-10-21, end of Phase 3. Awaiting owner approval and a dollar ceiling for the Phase 4 live smoke.

## Phases

| Phase | State | Branch / commit |
|---|---|---|
| 0 Plan | done | `phase-0-plan` |
| 1 Scaffold, matrix, prices, schemas, adapters | done | `phase-1-scaffold` |
| 2 Task suite A–D, hidden tests, verification | done (tasks approved as-is with "go") | `phase-2-tasks` |
| 3 Orchestrator (`bench run`) | done, **awaiting approval** | `phase-3-orchestrator` |
| 4 Live smoke (1 model, task A, N=1, ≤ $1) | not started | |
| 5 Reports | not started | |
| 6 CI, Pages, RUNBOOK | not started | |
| 7 Full sweep | not started | |

Branches are stacked (each phase branches from the previous one). No remote exists yet, so nothing is merged to `main` and no PRs are open.

## Phase 3 result

`harness/orchestrator/`: prompt builder and whole-file reply parser (writes and deletes), editable-path whitelist, retry loop with gate errors fed back (R = 2), caps (model-time timeout, output-token cap, run dollar ceiling checked before every request), transient-error retries, NDJSON writer that validates every line, `--only-new`, unified diff and hygiene counts per attempt.

Verified:
- 70 unit tests pass (`npm test`), 22 of them new for the orchestrator.
- Real dry run (fake model, real gates and hidden tests), `bench run --model claude-haiku-5-5 --effort low --dry-run --dry-reply fix-on-retry`: all 4 tasks fail the gates on turn 0, get the errors back, pass on turn 1, and score 100 % on the hidden tests (23/23, 14/14, 20/20, 19/19). 77 s wall-clock for 4 attempts.
- Fail path (`--dry-reply empty`): 3 turns, `fail`, hidden 0/20. `--only-new` skipped the recorded pair. Unsupported effort is recorded and nothing is sent. `--live` without `--usd-ceiling` is refused.

Prompt size: 3.7k–4.7k tokens per task. Worst-case cost of one Claude Haiku 5.5 turn is about $0.0085, so the Phase 4 smoke (task A, N=1, up to 3 turns) is at most about $0.03.

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

1. **Phase 4 go-ahead and ceiling.** Proposed: `claude-haiku-5-5` at `low`, task A, N=1, ceiling USD 1.00 (expected cost under $0.03). Needs `BENCH_ANTHROPIC_API_KEY` set in the shell that runs it.
2. ESLint: stay a pass/fail gate (current), or become a hygiene metric only? Reports can show both views, since every gate is stored separately.
3. Back up `~/.tauri-llm-bench/hidden.key`.
4. Still unanswered from Phase 0: judge setup, λ, and whether the repo will be public. Defaults are in use.

## Next step

After the owner says "go" and confirms the ceiling: **Phase 4**, live smoke:

```
npm run bench -- run --live --usd-ceiling 1 --model claude-haiku-5-5 --effort low --task A --reps 1
```

Then show the cost and results from `data/runs/1.0.0/<run_id>.ndjson`, commit the run file, update STATUS.md, and stop.

## How to resume

```
npm ci && (cd tasks/_shared/frontend && npm ci)
npm run bench -- hidden decrypt
npm run bench -- tasks prepare
npm run bench -- tasks verify
npm test
npm run bench -- run --model claude-haiku-5-5 --effort low --dry-run --reps 1   # end-to-end, no API calls
```
