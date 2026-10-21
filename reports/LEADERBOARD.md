# Leaderboard

> Quality **Q** is the hidden-test score only: no judge has scored these attempts yet.

> **Small sample:** 1 attempt(s) in total. Treat every number as an anecdote until each pair has 3+ reps per task.

Suite **1.0.0** · prices **v1** · 1 run(s) · 1 attempt(s) · total spend **$0.0033** · data as of 2026-10-21 00:51 UTC  
Value Index bar: Q ≥ 0.6 and pass-rate Wilson lower bound ≥ 0.4. λ = $60/h.

- **Best value:** none yet. No pair meets the bar (see the leaderboard notes).
- **Highest quality:** `claude-haiku-5-5@low`, Q 1.00
- **Cheapest per attempt:** `claude-haiku-5-5@low`, $0.0033
- **Fastest:** `claude-haiku-5-5@low`, 0.62 min per attempt

## Rankings

Ranked by VI among pairs that meet the bar; the rest follow by quality, unranked.

| # | Pair | Provider | Attempts | Pass rate (Wilson lo) | 1st-pass compile | Q | $ / attempt | min / attempt | VI (Q per $) | VI_t | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| – | `claude-haiku-5-5@low` | anthropic | 1 | 100 % (21 %) | 100 % | 1.00 | $0.0033 | 0.62 | 301 | 1.62 | Pareto; below bar: needs more attempts (n=1 can't clear the bar) |

## Per task

| Pair | A (C2) |
|---|---|
| `claude-haiku-5-5@low` | 1/1 pass · Q 1.00 (best 1.00) · pass@1 100 % |

## Routing: cheapest acceptable pair per class

| Class | Tasks | Cheapest pair meeting the bar | Q | $ / attempt | Highest quality seen |
|---|---|---|---|---|---|
| C2 | A | none of 1 pair(s) meets the bar yet | – | – | `claude-haiku-5-5@low` (Q 1.00, $0.0033, n=1) |

Bar: Q ≥ 0.6 and pass-rate Wilson lower bound ≥ 0.4 on that class's tasks. With one task per class (suite 1.x), "per class" really means "per task".

## How to read this

- **Pass**: every visible gate passed (cargo check, cargo test, tsc, ESLint, Vitest) within 1 + R turns. Capped, refused and errored attempts count as failures.
- **Q** (quality): mean hidden-test fraction per attempt; 0 when the final code does not compile or the attempt was capped. Judge scores will add 20 % weight once they exist.
- **VI** = Q ÷ mean $ per attempt. **VI_t** = Q ÷ ($ + λ · hours), which prices waiting time at λ $/h.
- **Pareto**: no other pair is at least as cheap, as good and as fast, and strictly better on one of them.
- **Wilson lo**: lower end of the 95 % interval for the pass rate; small samples get a low bound, so one lucky pass can't win.
- Efforts are provider labels, not equivalent settings: `high` on one provider is not `high` on another.

Charts: [index.html](index.html).
