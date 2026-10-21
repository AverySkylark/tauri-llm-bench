// `bench run`: expands the plan (pairs × tasks × reps), runs attempts one after another, and
// writes run / attempt / summary records to one NDJSON file.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { release } from 'node:os';
import { join } from 'node:path';
import { createAdapter, type Adapter } from '../../adapters/index.ts';
import { BUNDLE, decrypt, hiddenDir } from '../hidden.ts';
import type { LoadedMatrix, Pair } from '../matrix.ts';
import { repoPath } from '../paths.ts';
import { priceFor } from '../prices.ts';
import { WORK_DIR, type Task } from '../tasks.ts';
import { readManifest } from '../verify.ts';
import { realDeps, runAttempt, type AttemptDeps } from './attempt.ts';
import { Budget } from './budget.ts';
import { dryReplies, scriptedReply, type DryScript } from './dryreply.ts';
import { RunWriter } from './writer.ts';

export type Mode = 'matrix' | 'single' | 'only_new';

export interface PlanItem {
  pair: Pair;
  task: Task;
  rep: number;
}

export interface RunOptions {
  mode: Mode;
  loaded: LoadedMatrix;
  pairs: Pair[];
  tasks: Task[];
  reps: number;
  maxRetries: number;
  timeoutS: number;
  usdCeiling: number;
  dryRun: boolean;
  dryScript: DryScript;
  outDir: string;
  keepWork: boolean;
  log: (s: string) => void;
  gateTimeoutMs?: number;
  // Test seams.
  adapterFor?: (item: PlanItem) => Adapter;
  deps?: AttemptDeps;
  now?: () => Date;
}

export interface RunResult {
  runId: string;
  file: string;
  attempts: number;
  costUsd: number;
  aborted: boolean;
  abortReason: string | null;
  statuses: Record<string, number>;
}

export const LIVE_RUNS_DIR = repoPath('data', 'runs');
export const DRY_RUNS_DIR = join(WORK_DIR, 'dry-runs');
const GATE_TIMEOUT_MS = 5 * 60 * 1000;

export function makeRunId(d: Date): string {
  return `${d.toISOString().slice(0, 19).replace(/:/g, '-')}Z_${randomBytes(3).toString('hex')}`;
}

// The output cap is part of the identity: an attempt under a different cap is not "done".
export function pairKey(p: { provider: string; model: string; effort: string; maxOutputTokens: number }, task: string, rep: number): string {
  return `${p.provider}/${p.model}/${p.effort}/${p.maxOutputTokens}/${task}/${rep}`;
}

export function buildPlan(pairs: Pair[], tasks: Task[], reps: number): PlanItem[] {
  const plan: PlanItem[] = [];
  // Reps outermost, so a run stopped by the ceiling leaves a balanced partial sample.
  for (let rep = 0; rep < reps; rep++) for (const pair of pairs) for (const task of tasks) plan.push({ pair, task, rep });
  return plan;
}

// Attempts already on disk for this suite version (dry and live kept apart). Any recorded
// attempt counts as done, whatever its status: failures are results, not gaps.
export function recordedKeys(outDir: string, suiteVersion: string, dryRun: boolean): Set<string> {
  const dir = join(outDir, suiteVersion);
  const keys = new Set<string>();
  if (!existsSync(dir)) return keys;
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ndjson'))) {
    let isDry: boolean | null = null;
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as {
        record: string;
        dry_run?: boolean;
        pair?: { provider: string; model: string; effort_norm: string; max_output_tokens: number };
        task?: { id: string; rep_index: number };
      };
      if (r.record === 'run') isDry = r.dry_run ?? false;
      else if (r.record === 'attempt' && isDry === dryRun && r.pair && r.task) {
        keys.add(pairKey({ provider: r.pair.provider, model: r.pair.model, effort: r.pair.effort_norm, maxOutputTokens: r.pair.max_output_tokens }, r.task.id, r.task.rep_index));
      }
    }
  }
  return keys;
}

// Hidden tests must exist before any money is spent; decrypt the bundle if they don't.
export function ensureHidden(tasks: Task[]): void {
  const missing = () => tasks.filter((t) => !existsSync(join(hiddenDir(), t.id, 'tests')) || !readManifest(t.id));
  if (missing().length && existsSync(BUNDLE)) decrypt();
  const still = missing();
  if (still.length) throw new Error(`Hidden tests missing for ${still.map((t) => t.id).join(', ')}; run: bench hidden decrypt, then bench tasks verify`);
}

function sh(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: repoPath(), windowsHide: true });
  return r.status === 0 ? r.stdout.trim() : '';
}

export function harnessCommit(): { commit: string; dirty: boolean } {
  const commit = sh('git', ['rev-parse', 'HEAD']);
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Cannot read the harness commit; run from a Git checkout');
  // Run data and scratch output don't make the harness itself dirty.
  const dirty = sh('git', ['status', '--porcelain', '--', '.', ':!data', ':!reports']) !== '';
  return { commit, dirty };
}

export async function runBench(o: RunOptions): Promise<RunResult> {
  ensureHidden(o.tasks);
  const now = o.now ?? (() => new Date());
  const startedAt = now();
  const runId = makeRunId(startedAt);
  const m = o.loaded.matrix;
  const file = join(o.outDir, m.suite_version, `${runId}.ndjson`);
  const writer = new RunWriter(file);
  const { commit, dirty } = harnessCommit();

  writer.write({
    record: 'run',
    schema_version: 1,
    run_id: runId,
    started_at: startedAt.toISOString(),
    harness_commit: commit,
    harness_dirty: dirty,
    suite_version: m.suite_version,
    matrix_version: m.version,
    matrix_hash: o.loaded.hash,
    price_table_version: o.loaded.prices.version,
    mode: o.mode,
    dry_run: o.dryRun,
    host: {
      os: `${process.platform} ${release()}`,
      node: process.version,
      rustc: sh('rustc', ['--version']) || 'unknown',
      ...(process.env.CI ? { ci: true } : {}),
    },
    caps: {
      timeout_s: o.timeoutS,
      max_output_tokens: Math.max(...o.pairs.map((p) => p.maxOutputTokens), m.defaults.max_output_tokens),
      usd_ceiling: o.usdCeiling,
      reps: o.reps,
      max_retries: o.maxRetries,
    },
  });

  let plan = buildPlan(o.pairs, o.tasks, o.reps);
  if (o.mode === 'only_new') {
    const done = recordedKeys(o.outDir, m.suite_version, o.dryRun);
    plan = plan.filter((i) => !done.has(pairKey(i.pair, i.task.id, i.rep)));
  }
  o.log(`run ${runId}: ${plan.length} attempt(s), ceiling $${o.usdCeiling.toFixed(2)}${o.dryRun ? ' (dry run, no API calls)' : ''}`);
  o.log(`  writing ${file}`);

  const budget = new Budget(o.usdCeiling);
  const statuses: Record<string, number> = {};
  let attempts = 0;
  let abortReason: string | null = null;

  try {
    for (const item of plan) {
      const { pair, task, rep } = item;
      o.log(`[${attempts + 1}/${plan.length}] ${pair.model} @${pair.effort}  task ${task.id}  rep ${rep}`);
      const adapter = o.adapterFor
        ? o.adapterFor(item)
        : createAdapter(pair.provider, o.dryRun ? { dryRun: true, fake: { reply: scriptedReply(dryReplies(task, o.dryScript)) } } : { dryRun: false });
      const { record, abort } = await runAttempt({
        runId,
        pair,
        task,
        rep,
        adapter,
        price: priceFor(o.loaded.prices, pair.model),
        budget,
        timeoutS: o.timeoutS,
        maxRetries: o.maxRetries,
        gateTimeoutMs: o.gateTimeoutMs ?? GATE_TIMEOUT_MS,
        workRoot: WORK_DIR,
        keepWork: o.keepWork,
        log: o.log,
        deps: o.deps ?? realDeps,
      });
      if (abort && record.iterations.length === 0) {
        // The run's ceiling stopped us before this attempt sent anything: it never started, so it
        // isn't a result. `--only-new` picks it up next time.
        abortReason = abort;
        o.log(`  run stopped before this attempt: ${abort}`);
        break;
      }
      writer.write(record);
      attempts++;
      statuses[record.status] = (statuses[record.status] ?? 0) + 1;
      o.log(`  -> ${record.status}  $${record.telemetry.cost_usd.toFixed(4)}  (run total $${budget.spent.toFixed(4)})`);
      if (abort) {
        abortReason = abort;
        o.log(`  run stopped: ${abort}`);
        break;
      }
    }
  } catch (err) {
    abortReason = `harness error: ${err instanceof Error ? err.message : String(err)}`;
    throw err;
  } finally {
    writer.write({
      record: 'summary',
      run_id: runId,
      finished_at: now().toISOString(),
      attempts,
      cost_usd: budget.spent,
      aborted: abortReason !== null,
      abort_reason: abortReason,
    });
  }

  return { runId, file, attempts, costUsd: budget.spent, aborted: abortReason !== null, abortReason, statuses };
}
