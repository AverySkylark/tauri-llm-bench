# Tauri LLM Bench

An independent, repeatable benchmark of LLM model × reasoning-effort pairs on everyday Tauri 2 work: Rust IPC commands, state and async, React + TypeScript boundaries. Each pair gets the same four tasks (greenfield, debugging, refactor, systems), the same prompts and the same whole-file reply protocol. Visible gates (cargo check/test, tsc, ESLint, Vitest) decide pass/fail; encrypted hidden tests score quality.

- What's measured and why: [docs/PLAN.md](docs/PLAN.md)
- The tasks: [docs/TASKS.md](docs/TASKS.md)
- Decisions: [docs/DECISIONS.md](docs/DECISIONS.md)

## Leaderboard

<!-- leaderboard:start -->
![suite: 1.0.0](https://img.shields.io/badge/suite-1.0.0-blue) ![attempts: 8](https://img.shields.io/badge/attempts-8-blue) ![best value: claude-haiku-5-5@low](https://img.shields.io/badge/best%20value-claude--haiku--5--5%40low-2ea44f)

> Quality **Q** is the hidden-test score only: no judge has scored these attempts yet.

> **Small sample:** 8 attempt(s) in total. Treat every number as an anecdote until each pair has 3+ reps per task.

| # | Pair | Provider | Attempts | Pass rate (Wilson lo) | 1st-pass compile | Q | $ / attempt | min / attempt | VI (Q per $) | VI_t | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `claude-haiku-5-5@low` | anthropic | 4 | 100 % (51 %) | 75 % | 0.99 | $0.0042 | 0.66 | 236 | 1.49 | Pareto |
| – | `claude-haiku-5-5@high` | anthropic | 4 | 75 % (30 %) | 100 % | 0.75 | $0.0073 | 1.04 | 103 | 0.71 | below bar: pass-rate bound < 0.4; no measurable gain over @low (ΔQ -0.24, 95 % CI -0.74 to +0.03) at 1.7× the cost |

Full tables: [reports/LEADERBOARD.md](reports/LEADERBOARD.md) · routing: [reports/routing.md](reports/routing.md) · charts: [reports/index.html](reports/index.html)
<!-- leaderboard:end -->
