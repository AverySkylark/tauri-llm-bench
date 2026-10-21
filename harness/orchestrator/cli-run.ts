// Argument handling for `bench run`. Spending money needs --live plus an explicit --usd-ceiling.

import { parseArgs } from 'node:util';
import { availableProviders, EFFORTS, isSupported, KEY_ENV, type Effort } from '../../adapters/index.ts';
import { loadMatrix, outputCap, type Pair } from '../matrix.ts';
import { repoPath } from '../paths.ts';
import { priceFor } from '../prices.ts';
import { findTask, listTasks } from '../tasks.ts';
import { DRY_SCRIPTS, type DryScript } from './dryreply.ts';
import { DRY_RUNS_DIR, LIVE_RUNS_DIR, runBench, type Mode } from './run.ts';

export async function runCommand(args: string[]): Promise<number> {
  const { values: v } = parseArgs({
    args,
    options: {
      matrix: { type: 'string', default: repoPath('matrix', 'matrix.yaml') },
      'dry-run': { type: 'boolean', default: false },
      live: { type: 'boolean', default: false },
      'usd-ceiling': { type: 'string' },
      model: { type: 'string' },
      effort: { type: 'string' },
      task: { type: 'string' },
      reps: { type: 'string' },
      'max-retries': { type: 'string' },
      'only-new': { type: 'boolean', default: false },
      'keep-work': { type: 'boolean', default: false },
      'dry-reply': { type: 'string', default: 'fix-on-retry' },
      out: { type: 'string' },
    },
  });

  if (v['dry-run'] === v.live) throw new Error('Pass exactly one of --dry-run or --live');
  const loaded = loadMatrix(v.matrix);
  const d = loaded.matrix.defaults;

  let usdCeiling = d.usd_ceiling_per_run;
  if (v.live) {
    const c = Number(v['usd-ceiling']);
    if (!v['usd-ceiling'] || !Number.isFinite(c) || c <= 0) throw new Error('--live needs an explicit --usd-ceiling <USD> greater than 0');
    usdCeiling = c;
  } else if (v['usd-ceiling']) usdCeiling = Number(v['usd-ceiling']);

  if (!DRY_SCRIPTS.includes(v['dry-reply'] as DryScript)) throw new Error(`--dry-reply must be one of ${DRY_SCRIPTS.join(', ')}`);

  let mode: Mode = 'matrix';
  let pairs: Pair[] = loaded.pairs;
  if (v.model) {
    if (v['only-new']) throw new Error('--only-new works on the matrix; drop --model');
    if (!v.effort || !EFFORTS.includes(v.effort as Effort)) throw new Error(`--model needs --effort ${EFFORTS.join('|')}`);
    mode = 'single';
    const effort = v.effort as Effort;
    const price = priceFor(loaded.prices, v.model);
    const entry = loaded.matrix.pairs.find((p) => p.model === v.model);
    pairs = [
      {
        provider: price.provider,
        model: v.model,
        effort,
        maxOutputTokens: outputCap(d, entry?.max_output_tokens, effort),
        temperature: entry?.temperature ?? d.temperature,
        supported: isSupported(price.provider, v.model, effort),
      },
    ];
  } else if (v.effort) throw new Error('--effort needs --model');
  else if (v['only-new']) mode = 'only_new';

  if (v.live) {
    const keys = availableProviders();
    for (const p of pairs.filter((x) => !keys.includes(x.provider))) console.log(`skipping ${p.model} @${p.effort}: ${KEY_ENV[p.provider]} not set`);
    pairs = pairs.filter((p) => keys.includes(p.provider));
    if (pairs.length === 0) throw new Error('No pair has an API key set; nothing to run');
  }

  const tasks = v.task ? v.task.split(',').map((id) => findTask(id.trim())) : listTasks();
  const int = (s: string | undefined, def: number, name: string) => {
    if (s === undefined) return def;
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a whole number`);
    return n;
  };
  const reps = int(v.reps, d.reps, '--reps');
  if (reps < 1) throw new Error('--reps must be at least 1');

  const result = await runBench({
    mode,
    loaded,
    pairs,
    tasks,
    reps,
    maxRetries: int(v['max-retries'], d.max_retries, '--max-retries'),
    timeoutS: d.timeout_s,
    usdCeiling,
    dryRun: v['dry-run'],
    dryScript: v['dry-reply'] as DryScript,
    outDir: v.out ?? (v.live ? LIVE_RUNS_DIR : DRY_RUNS_DIR),
    keepWork: v['keep-work'],
    log: (s) => console.log(s),
  });

  const counts = Object.entries(result.statuses).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
  console.log(`\nrun ${result.runId}: ${result.attempts} attempt(s) [${counts}], cost $${result.costUsd.toFixed(4)}${v['dry-run'] ? ' (simulated)' : ''}`);
  console.log(`  ${result.file}`);
  if (result.aborted) {
    console.log(`  stopped early: ${result.abortReason}`);
    return 3;
  }
  return 0;
}
