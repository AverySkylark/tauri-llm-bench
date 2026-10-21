# Tauri LLM Bench

An independent, repeatable benchmark of LLM model × reasoning-effort pairs on everyday Tauri 2 work: Rust IPC commands, state and async, React + TypeScript boundaries. Each pair gets the same four tasks (greenfield, debugging, refactor, systems), the same prompts and the same whole-file reply protocol. Visible gates (cargo check/test, tsc, ESLint, Vitest) decide pass/fail; encrypted hidden tests score quality.

- What's measured and why: [docs/PLAN.md](docs/PLAN.md)
- The tasks: [docs/TASKS.md](docs/TASKS.md)
- Decisions: [docs/DECISIONS.md](docs/DECISIONS.md)

## Leaderboard

<!-- leaderboard:start -->
![suite: 1.0.0](https://img.shields.io/badge/suite-1.0.0-blue) ![attempts: 1](https://img.shields.io/badge/attempts-1-blue) ![best value: none yet](https://img.shields.io/badge/best%20value-none%20yet-lightgrey)

> Quality **Q** is the hidden-test score only: no judge has scored these attempts yet.

> **Small sample:** 1 attempt(s) in total. Treat every number as an anecdote until each pair has 3+ reps per task.

| # | Pair | Provider | Attempts | Pass rate (Wilson lo) | 1st-pass compile | Q | $ / attempt | min / attempt | VI (Q per $) | VI_t | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| – | `claude-haiku-5-5@low` | anthropic | 1 | 100 % (21 %) | 100 % | 1.00 | $0.0033 | 0.62 | 301 | 1.62 | Pareto; below bar: needs more attempts (n=1 can't clear the bar) |

Full tables: [reports/LEADERBOARD.md](reports/LEADERBOARD.md) · routing: [reports/routing.md](reports/routing.md) · charts: [reports/index.html](reports/index.html)
<!-- leaderboard:end -->
