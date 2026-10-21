// `bench report diff --base model@effort --target model@effort`: side-by-side with a
// significance note derived from the spread across reps.

import type { AttemptRecord } from '../orchestrator/attempt.ts';
import { attemptScore, MIN_REPS_FOR_SIGNIFICANCE, pairKey } from './metrics.ts';
import { bootstrapDiff, mean } from './stats.ts';

interface Side {
  n: number;
  passRate: number;
  Q: number;
  C: number;
  T: number;
  scores: number[];
}

function side(as: AttemptRecord[]): Side {
  const s = as.filter((a) => a.status !== 'unsupported');
  return {
    n: s.length,
    passRate: s.length ? s.filter((a) => a.status === 'pass').length / s.length : 0,
    Q: mean(s.map(attemptScore)),
    C: mean(s.map((a) => a.telemetry.cost_usd)),
    T: mean(s.map((a) => a.telemetry.wall_ms / 60000)),
    scores: s.map(attemptScore),
  };
}

export function significance(base: number[], target: number[]): string {
  if (base.length < MIN_REPS_FOR_SIGNIFICANCE || target.length < MIN_REPS_FOR_SIGNIFICANCE) {
    return `not tested: needs at least ${MIN_REPS_FOR_SIGNIFICANCE} attempts per side (have ${base.length} and ${target.length})`;
  }
  const d = bootstrapDiff(base, target);
  const ci = `95 % CI ${d.lo.toFixed(2)} to ${d.hi.toFixed(2)}`;
  if (d.lo > 0) return `target better (${ci})`;
  if (d.hi < 0) return `target worse (${ci})`;
  return `no significant difference (${ci})`;
}

export function reportDiff(attempts: AttemptRecord[], baseKey: string, targetKey: string, banner: string[]): string {
  const pick = (k: string) => attempts.filter((a) => pairKey(a.pair.model, a.pair.effort_norm) === k);
  const base = pick(baseKey);
  const target = pick(targetKey);
  for (const [k, as] of [[baseKey, base], [targetKey, target]] as const) {
    if (as.length === 0) throw new Error(`No attempts for ${k}. Pairs with data: ${[...new Set(attempts.map((a) => pairKey(a.pair.model, a.pair.effort_norm)))].join(', ') || 'none'}`);
  }

  const rows: string[] = [];
  const line = (label: string, b: Side, t: Side) => {
    const pct = (x: number) => `${(x * 100).toFixed(0)} %`;
    const dq = t.Q - b.Q;
    rows.push(
      `| ${label} | ${b.n} / ${t.n} | ${pct(b.passRate)} → ${pct(t.passRate)} | ${b.Q.toFixed(2)} → ${t.Q.toFixed(2)} (${dq >= 0 ? '+' : ''}${dq.toFixed(2)}) | ` +
        `$${b.C.toFixed(4)} → $${t.C.toFixed(4)} | ${b.T.toFixed(2)} → ${t.T.toFixed(2)} | ${significance(b.scores, t.scores)} |`,
    );
  };
  const tasks = [...new Set([...base, ...target].map((a) => a.task.id))].sort();
  line('**all tasks**', side(base), side(target));
  for (const id of tasks) line(`task ${id}`, side(base.filter((a) => a.task.id === id)), side(target.filter((a) => a.task.id === id)));

  return [
    `# ${baseKey} → ${targetKey}`,
    '',
    ...banner,
    '| Scope | Attempts (base / target) | Pass rate | Quality Q | Mean cost | Mean minutes | Significance of ΔQ |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
    'Quality Q is the mean hidden-test fraction (no judge scores yet). Significance is a bootstrap over attempts; reps are the only source of variance, so few reps means wide intervals.',
    '',
  ].join('\n');
}
