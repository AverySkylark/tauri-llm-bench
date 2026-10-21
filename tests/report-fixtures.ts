// Synthetic, schema-valid run data for report tests. Deterministic (seeded); always dry_run.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AttemptRecord, Status } from '../harness/orchestrator/attempt.ts';
import { rng } from '../harness/report/stats.ts';

interface PairSpec {
  provider: 'anthropic' | 'openai' | 'google';
  model: string;
  effort: 'none' | 'low' | 'medium' | 'high' | 'max';
  skill: number; // chance of passing
  cost: number; // $ per attempt
  minutes: number;
  unsupported?: boolean;
}

export const FIXTURE_PAIRS: PairSpec[] = [
  { provider: 'anthropic', model: 'claude-haiku-5-5', effort: 'low', skill: 0.7, cost: 0.004, minutes: 0.6 },
  { provider: 'anthropic', model: 'claude-haiku-5-5', effort: 'high', skill: 0.72, cost: 0.012, minutes: 1.4 },
  { provider: 'google', model: 'gemini-3.5-flash-lite', effort: 'low', skill: 0.45, cost: 0.003, minutes: 0.5 },
  { provider: 'google', model: 'gemini-3.5-flash-lite', effort: 'high', skill: 0.8, cost: 0.009, minutes: 1.1 },
  { provider: 'google', model: 'gemini-3.5-flash-lite', effort: 'none', skill: 0, cost: 0, minutes: 0, unsupported: true },
  { provider: 'openai', model: 'gpt-5.4-mini-2026-03-17', effort: 'medium', skill: 0.95, cost: 0.03, minutes: 1.0 },
];

const TASKS = [
  { id: 'A', class: 'C2' as const, difficulty: 0 },
  { id: 'B', class: 'C3' as const, difficulty: 0.15 },
  { id: 'C', class: 'C2' as const, difficulty: 0.05 },
  { id: 'D', class: 'C4' as const, difficulty: 0.3 },
];

const gate = (ok: boolean) => ({ ok, ms: 1000, exit_code: ok ? 0 : 1, output_tail: '' });

export function fixtureAttempt(runId: string, i: number, p: PairSpec, task: (typeof TASKS)[number], rep: number, r: () => number): AttemptRecord {
  const tokens = { input: 5000, cached_input: 0, output: 3000, reasoning: null };
  const base = {
    record: 'attempt' as const,
    run_id: runId,
    attempt_id: i.toString(16).padStart(16, '0'),
    pair: {
      provider: p.provider,
      model: p.model,
      effort_norm: p.effort,
      effort_native: p.unsupported ? null : { param: 'effort', value: p.effort },
      temperature_sent: null,
      max_output_tokens: 16000,
    },
    task: { id: task.id, class: task.class, rep_index: rep },
    error: null,
    diff: '',
  };
  if (p.unsupported) {
    return { ...base, status: 'unsupported', first_pass_compile: null, iterations: [], hidden: null, telemetry: { tokens: { ...tokens, input: 0, output: 0 }, model_latency_ms: 0, wall_ms: 0, cost_usd: 0 } };
  }
  const roll = r();
  const capped = roll > 0.97;
  const pass = !capped && roll < p.skill - task.difficulty;
  const status: Status = capped ? 'capped_tokens' : pass ? 'pass' : 'fail';
  const hiddenFrac = pass ? 0.8 + 0.2 * r() : capped ? 0 : 0.6 * r();
  const total = 20;
  const cost = Math.round(p.cost * (0.7 + 0.6 * r()) * 1e6) / 1e6;
  return {
    ...base,
    status,
    first_pass_compile: capped ? null : r() < p.skill,
    iterations: [
      {
        n: 0,
        tokens,
        latency_ms: 1000,
        cost_usd: cost,
        stop_reason: capped ? 'max_tokens' : 'end',
        stop_reason_native: 'x',
        files_changed: [],
        rejected_paths: [],
        gates: capped ? {} : { cargo_check: gate(true), cargo_test: gate(pass), tsc: gate(true), eslint: gate(pass), vitest: gate(pass) },
        error_classes: [],
      },
    ],
    hidden: capped ? null : { passed: Math.round(hiddenFrac * total), total },
    telemetry: { tokens, model_latency_ms: 1000, wall_ms: Math.round(p.minutes * 60000 * (0.8 + 0.4 * r())), cost_usd: cost },
  };
}

// Writes one dry run with reps × pairs × tasks attempts under <dir>/<suite>/.
export function writeFixtureRun(dir: string, opts: { suite?: string; reps?: number; seed?: number; runId?: string } = {}): string {
  const suite = opts.suite ?? '1.0.0';
  const runId = opts.runId ?? '2026-10-21T00-00-00Z_f1f1f1';
  const r = rng(opts.seed ?? 7);
  const lines: object[] = [
    {
      record: 'run',
      schema_version: 1,
      run_id: runId,
      started_at: '2026-10-21T00:00:00.000Z',
      harness_commit: 'abcdef1',
      suite_version: suite,
      matrix_version: 1,
      matrix_hash: 'a'.repeat(64),
      price_table_version: 'v1',
      mode: 'matrix',
      dry_run: true,
      host: { os: 'test', node: 'v24', rustc: 'rustc' },
      caps: { timeout_s: 600, max_output_tokens: 16000, usd_ceiling: 10, reps: opts.reps ?? 3, max_retries: 2 },
    },
  ];
  let i = 0;
  let cost = 0;
  for (let rep = 0; rep < (opts.reps ?? 3); rep++) {
    for (const p of FIXTURE_PAIRS) {
      for (const t of TASKS) {
        const a = fixtureAttempt(runId, i++, p, t, rep, r);
        cost += a.telemetry.cost_usd;
        lines.push(a);
      }
    }
  }
  lines.push({ record: 'summary', run_id: runId, finished_at: '2026-10-21T01:00:00.000Z', attempts: i, cost_usd: Math.round(cost * 1e6) / 1e6, aborted: false, abort_reason: null });
  mkdirSync(join(dir, suite), { recursive: true });
  const file = join(dir, suite, `${runId}.ndjson`);
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}
