# Runbook

How to add a model, run it, and publish the reports. Commands are for PowerShell on Windows unless marked bash. Every `npm run bench -- …` command works the same on Linux.

## 1. One-time setup

### Local machine

```powershell
npm ci; Push-Location tasks/_shared/frontend; npm ci; Pop-Location
npm run bench -- hidden decrypt      # needs ~/.tauri-llm-bench/hidden.key or $env:BENCH_HIDDEN_KEY
npm run bench -- tasks prepare       # fetch crates, warm .bench-work/target (a few minutes the first time)
npm test
```

Toolchain: Node 24, Rust 1.99.1 (the version CI pins), MSVC build tools and WebView2. See `docs/PLAN.md` §1.

API keys live in your Windows user environment, never in files. Set them once in System Properties → Environment Variables, or:

```powershell
[Environment]::SetEnvironmentVariable('BENCH_ANTHROPIC_API_KEY', '<key>', 'User')
```

A shell opened before you set it won't see it. Copy it into the current one with:

```powershell
$env:BENCH_ANTHROPIC_API_KEY = [Environment]::GetEnvironmentVariable('BENCH_ANTHROPIC_API_KEY','User')
```

Providers without a key are skipped. Never set plain `ANTHROPIC_API_KEY` for the bench; that one belongs to Claude Code.

### GitHub (once the remote exists)

1. **Secrets** (Settings → Secrets and variables → Actions): `BENCH_HIDDEN_KEY` (the base64 line from `~/.tauri-llm-bench/hidden.key`), and any of `BENCH_ANTHROPIC_API_KEY`, `BENCH_OPENAI_API_KEY`, `BENCH_GOOGLE_API_KEY`.
2. **Pages**: Settings → Pages → Source: **GitHub Actions**. A free account needs a public repo for Pages. Hidden tests stay encrypted either way.
3. **Branch protection on `main`**, if you add it, must let `github-actions[bot]` push, or the sweep and Pages workflows can't commit run files and rebuilt reports.

### The workflows

| Workflow | Trigger | Spends money? | What it does |
|---|---|---|---|
| `ci.yml` | every push and PR | no | Typecheck and unit tests on Ubuntu and Windows; `tasks verify` and a dry run on Ubuntu |
| `pages.yml` | push to `main` touching runs, reports, matrix or prices; manual; called by the sweep | no | Rebuilds reports, commits them if they changed, deploys `reports/` to Pages |
| `sweep.yml` | **manual only** | **yes**, up to the ceiling you type | Live run, commits the run file and reports, then calls `pages.yml` |

Pages deploys from `main` only. A sweep dispatched on another branch commits there and skips the deploy.

## 2. Add a model and publish (target: under 15 minutes)

The steps below are the target, not yet timed end to end. Most of the time is the run itself.

1. **Price** (2 min). Add the model to `prices/v1.yaml` with the pinned ID, `$ per MTok` for input, cached input and output, the source URL and today's date. Use a dated snapshot ID where the provider has one, never an alias like `latest`. If an *existing* model's price changed, don't edit `v1`: copy it to `v2.yaml`, change it there, and set `price_table: v2` in the matrix. Old runs keep pointing at `v1`.
2. **Effort mapping** (3 min). If no rule in `adapters/effort.ts` matches the model ID, add one: map each of `none|low|medium|high|max` to the provider's native setting, or `null` where the model can't express it. Cite the doc page in `source`. Unsupported levels are refused, never remapped.
3. **Matrix** (1 min). Add the pair to `matrix/matrix.yaml` and bump `version`. Add `max_output_tokens` on the pair if the model's limit is below the per-effort default (32k for high and max).
4. **Check without spending** (2 min).
   ```powershell
   npm run bench -- matrix                       # the new pair is listed, "key ok"
   npm test
   npm run bench -- run --model <id> --effort low --task A --dry-run --reps 1
   ```
5. **Commit and push** to `main` (or merge the PR).
6. **Run** (time depends on the model, see §3). Either:
   - GitHub: Actions → *Sweep (live, spends money)* → Run workflow. Enter the ceiling, scope `only-new` (runs just what isn't recorded yet, which is the new model). Pages updates when it finishes.
   - Local:
     ```powershell
     npm run bench -- run --only-new --live --usd-ceiling 1.00
     npm run bench -- report
     git add data/runs reports README.md; git commit -m "Add <model>"; git push
     ```
     The push triggers `pages.yml`.

To test one pair first: scope `single` with model and effort (GitHub), or `--model <id> --effort <level>` locally.

## 3. Full-sweep estimate

Current matrix v3: 7 pairs (Haiku at low and high, Sonnet at none, low, medium, high and max) × 4 tasks × 3 reps = **84 attempts**, run one after another.

Measured from the 8 live attempts (Claude Haiku 5.5, tasks A–D, one rep each, local Windows machine):

| Pair | Attempts measured | Mean wall-clock / attempt | Mean tokens in / out | Mean cost / attempt |
|---|---|---|---|---|
| `claude-haiku-5-5@low` | 4 | 39.5 s | 12,635 / 5,855 | $0.0042 |
| `claude-haiku-5-5@high` | 4 (one hit the old 16k cap) | 62.7 s | 6,472 / 13,340 | $0.0073 |
| `claude-sonnet-5-5@*` | 0 | not measured | not measured | not measured |

**Sonnet is inferred, not measured.** The estimate takes Haiku's mean token counts at Sonnet's prices ($2 in, $10 out per MTok): `none` and `low` use Haiku-low's tokens, `high` and `max` use Haiku-high's, `medium` sits halfway. Sonnet's thinking lengths will differ, `max` most of all.

**Wall-clock** (12 attempts per pair):
- Haiku: low 7.9 min + high 12.5 min = **about 20 min**.
- Sonnet, if as fast as Haiku: none 7.9 + low 7.9 + medium 10.2 + high 12.5 + max 12.5 = **about 51 min**. Sonnet is usually slower than Haiku, so treat this as a floor.
- Whole matrix: **about 71 min or more**.
- CI adds setup: Rust install, apt packages and, on a cold cache, crate fetch and a warm build. Not yet measured; expect several minutes cold and less with the cache. The sweep job's limit is 350 min.

**Cost** (12 attempts per pair):
- Haiku: low $0.050 + high $0.088 = **$0.14** (measured).
- Sonnet (inferred): about $0.084 per attempt at none/low, $0.115 at medium, $0.146 at high/max, so **about $6.90**.
- Whole matrix: **about $7.04**.

Things that push it up: retries (none happened in the 8 attempts; each attempt can take up to 3 model turns), the 32k cap at high and max (the capped Haiku attempt stopped at 16k, so a 32k rerun costs more), and slower Linux runners. The worst single Sonnet attempt at the 32k cap with 3 turns is about $1.08. **Suggested ceiling for the first full sweep: $15.00.** Live runs always take the ceiling you pass (`--usd-ceiling` locally, `usd_ceiling` in the sweep workflow); the matrix default `usd_ceiling_per_run: 1.00` applies to dry runs only. The run stops before any request whose worst case would cross the ceiling, and `--only-new` resumes from there.

Re-estimate after each sweep: the per-pair means are in `reports/LEADERBOARD.md`.

## 4. Safety

- **Model-written code runs on the machine.** Gates run `cargo test` (including any `build.rs` or tests the model wrote) and Vitest. Edits are limited to each task's allowed paths and builds are `--offline`, but nothing stops that code from opening a network connection or reading files. On CI it runs on a throwaway runner. Locally there is no sandbox; run in WSL or a VM if that worries you.
- **Gates never get secrets.** The gate environment drops every `BENCH_*`, `ACTIONS_*` and any variable named like a key, token, secret, password or credential (`harness/gates.ts`). In `sweep.yml`, API keys are set only on the run step.
- **Known gap: the decrypted hidden tests sit in `hidden/plain/` during a run**, and gate code could read them and print them into the error feedback the model sees on a retry. A model would have to do this on purpose. Watch for it in the run files (hidden-test paths or contents in a gate's `output_tail`). The fix is to decrypt hidden tests only after the last turn; not done yet.
- **Hidden key.** Back up `~/.tauri-llm-bench/hidden.key` somewhere private. Without it the hidden tests can't be decrypted. To rotate: `bench hidden keygen`, `bench hidden encrypt`, commit `hidden/tasks.enc`, update the `BENCH_HIDDEN_KEY` secret.

## 5. When something goes wrong

| Symptom | What to do |
|---|---|
| Run stopped at the ceiling (`stopped early`, exit code 3) | Expected. Results so far are committed. Rerun with `--only-new` (scope `only-new`) and a new ceiling. |
| Attempt shows `capped_tokens` | It counts as a failure by design. If the cap is too low for that model, raise it in the matrix (new version); attempts under the new cap show as a separate row. |
| `BENCH_HIDDEN_KEY secret is not set` in CI | Add the secret (§1). |
| `cargo … --offline` can't find a crate | Run `bench tasks prepare` (locally), or clear the Actions cache named `bench-cargo-*`. |
| Reports show a "harness_dirty" warning | A run was made with uncommitted harness changes. Commit first next time; the data is still valid. |
| Pages shows an old report | Check that `pages.yml` ran on `main` and that Pages' source is "GitHub Actions". |
