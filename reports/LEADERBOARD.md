# Leaderboard

> Quality **Q** is the hidden-test score only: no judge has scored these attempts yet.

> **Small sample:** 8 attempt(s) in total. Treat every number as an anecdote until each pair has 3+ reps per task.

Suite **1.0.0** · prices **v1** · 2 run(s) · 8 attempt(s) · total spend **$0.046** · data as of 2026-10-21 01:12 UTC  
Value Index bar: Q ≥ 0.6 and pass-rate Wilson lower bound ≥ 0.4. λ = $60/h.

- **Best value:** `claude-haiku-5-5@low`, 236 quality points per $1
- **Highest quality:** `claude-haiku-5-5@low`, Q 0.99
- **Cheapest per attempt:** `claude-haiku-5-5@low`, $0.0042
- **Fastest:** `claude-haiku-5-5@low`, 0.66 min per attempt

## Rankings

Ranked by VI among pairs that meet the bar; the rest follow by quality, unranked.

| # | Pair | Provider | Output cap | Attempts | Pass rate (Wilson lo) | 1st-pass compile | Q | $ / attempt | min / attempt | VI (Q per $) | VI_t | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `claude-haiku-5-5@low` | anthropic | 16k | 4 | 100 % (51 %) | 75 % | 0.99 | $0.0042 | 0.66 | 236 | 1.49 | Pareto |
| – | `claude-haiku-5-5@high` | anthropic | 16k | 4 | 75 % (30 %) | 100 % | 0.75 | $0.0073 | 1.04 | 103 | 0.71 | below bar: pass-rate bound < 0.4; no measurable gain over @low (ΔQ -0.24, 95 % CI -0.74 to +0.03) at 1.7× the cost |

## Per task

| Pair | A (C2) | B (C3) | C (C2) | D (C4) |
|---|---|---|---|---|
| `claude-haiku-5-5@low` | 1/1 pass · Q 1.00 (best 1.00) · pass@1 100 % | 1/1 pass · Q 1.00 (best 1.00) · pass@1 100 % | 1/1 pass · Q 0.95 (best 0.95) · pass@1 100 % | 1/1 pass · Q 1.00 (best 1.00) · pass@1 100 % |
| `claude-haiku-5-5@high` | 1/1 pass · Q 1.00 (best 1.00) · pass@1 100 % | 1/1 pass · Q 1.00 (best 1.00) · pass@1 100 % | 0/1 pass · Q 0.00 (best 0.00) · pass@1 0 % · capped_tokens 1 | 1/1 pass · Q 1.00 (best 1.00) · pass@1 100 % |

## Routing: cheapest acceptable pair per class

| Class | Tasks | Cheapest pair meeting the bar | Q | $ / attempt | Highest quality seen |
|---|---|---|---|---|---|
| C2 | A, C | none of 2 pair(s) meets the bar yet | – | – | `claude-haiku-5-5@low` (Q 0.97, $0.0041, n=2) |
| C3 | B | none of 2 pair(s) meets the bar yet | – | – | `claude-haiku-5-5@low` (Q 1.00, $0.0033, n=1) |
| C4 | D | none of 2 pair(s) meets the bar yet | – | – | `claude-haiku-5-5@low` (Q 1.00, $0.0052, n=1) |

Bar: Q ≥ 0.6 and pass-rate Wilson lower bound ≥ 0.4 on that class's tasks. With one task per class (suite 1.x), "per class" really means "per task".

## How to read this

- **Pass**: every visible gate passed (cargo check, cargo test, tsc, ESLint, Vitest) within 1 + R turns. Capped, refused and errored attempts count as failures.
- **Q** (quality): mean hidden-test fraction per attempt; 0 when the final code does not compile or the attempt was capped. Judge scores will add 20 % weight once they exist.
- **VI** = Q ÷ mean $ per attempt. **VI_t** = Q ÷ ($ + λ · hours), which prices waiting time at λ $/h.
- **Pareto**: no other pair is at least as cheap, as good and as fast, and strictly better on one of them.
- **Wilson lo**: lower end of the 95 % interval for the pass rate; small samples get a low bound, so one lucky pass can't win.
- Efforts are provider labels, not equivalent settings: `high` on one provider is not `high` on another.

Charts: [index.html](index.html).
