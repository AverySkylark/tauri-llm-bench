// Per-pair aggregates, Value Index, Pareto frontier, effort flags and routing (PLAN §6).

import { EFFORTS, type Effort, type ProviderId } from '../../adapters/types.ts';
import type { AttemptRecord, Status } from '../orchestrator/attempt.ts';
import { bootstrapDiff, mean, passAtK, wilsonLower } from './stats.ts';

export interface Thresholds {
  latencyUsdPerHour: number;
  minQuality: number;
  minPassWilsonLower: number;
}

export interface TaskStats {
  task: string;
  class: string;
  n: number;
  passes: number;
  meanH: number;
  bestH: number;
  passAt1: number;
  passAtN: number;
  statuses: Partial<Record<Status, number>>;
}

export interface PairStats {
  key: string;
  provider: ProviderId;
  model: string;
  effort: Effort;
  nativeEffort: string | null;
  caps: number[];
  n: number;
  unsupported: boolean;
  passes: number;
  passRate: number;
  passWilsonLower: number;
  firstPassCompile: number | null;
  scores: number[];
  H: number;
  Q: number;
  judged: boolean;
  C: number;
  T: number;
  tokensOut: number;
  VI: number | null;
  VIt: number | null;
  meetsBar: boolean;
  pareto: boolean;
  effortFlag: string | null;
  tasks: TaskStats[];
  statuses: Partial<Record<Status, number>>;
}

export const pairKey = (model: string, effort: string) => `${model}@${effort}`;

// Report row key. A model@effort whose attempts ran under different output caps (e.g. before and
// after matrix v2) is split into one row per cap, labelled model@effort/16k, so settings never mix.
export function rowKeyFn(attempts: AttemptRecord[]): (a: AttemptRecord) => string {
  const caps = new Map<string, Set<number>>();
  for (const a of attempts) {
    const k = pairKey(a.pair.model, a.pair.effort_norm);
    caps.set(k, (caps.get(k) ?? new Set()).add(a.pair.max_output_tokens));
  }
  return (a) => {
    const k = pairKey(a.pair.model, a.pair.effort_norm);
    return caps.get(k)!.size > 1 ? `${k}/${Math.round(a.pair.max_output_tokens / 1000)}k` : k;
  };
}

// Quality score of one attempt: hidden-test fraction when the final code compiled, otherwise 0.
// Capped, refused and errored attempts score 0 but keep their full cost (PLAN §6).
export function attemptScore(a: AttemptRecord): number {
  if (a.status !== 'pass' && a.status !== 'fail') return 0;
  if (!a.hidden) return 0;
  const last = [...a.iterations].reverse().find((it) => Object.keys(it.gates).length > 0);
  if (!last) return 0;
  const compiles = ['cargo_check', 'tsc'].every((g) => last.gates[g]?.ok !== false);
  return compiles ? a.hidden.passed / a.hidden.total : 0;
}

function countStatuses(as: AttemptRecord[]): Partial<Record<Status, number>> {
  const out: Partial<Record<Status, number>> = {};
  for (const a of as) out[a.status] = (out[a.status] ?? 0) + 1;
  return out;
}

export function taskStats(as: AttemptRecord[]): TaskStats {
  const scores = as.map(attemptScore);
  const passes = as.filter((a) => a.status === 'pass').length;
  return {
    task: as[0]!.task.id,
    class: as[0]!.task.class,
    n: as.length,
    passes,
    meanH: mean(scores),
    bestH: scores.length ? Math.max(...scores) : 0,
    passAt1: passAtK(as.length, passes, 1),
    passAtN: passAtK(as.length, passes, as.length),
    statuses: countStatuses(as),
  };
}

export function aggregate(attempts: AttemptRecord[], th: Thresholds): PairStats[] {
  const groups = new Map<string, AttemptRecord[]>();
  const rowKey = rowKeyFn(attempts);
  for (const a of attempts) {
    const k = rowKey(a);
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }

  const pairs: PairStats[] = [];
  for (const [key, all] of groups) {
    const first = all[0]!;
    const scored = all.filter((a) => a.status !== 'unsupported');
    const scores = scored.map(attemptScore);
    const passes = scored.filter((a) => a.status === 'pass').length;
    const compiled = scored.filter((a) => a.first_pass_compile !== null);
    const H = mean(scores);
    const C = mean(scored.map((a) => a.telemetry.cost_usd));
    const T = mean(scored.map((a) => a.telemetry.wall_ms / 60000));
    const Q = H; // No judge yet: Q = H, flagged in every report (PLAN §6).
    const byTask = new Map<string, AttemptRecord[]>();
    for (const a of scored) byTask.set(a.task.id, [...(byTask.get(a.task.id) ?? []), a]);
    const n = scored.length;
    const wl = wilsonLower(passes, n);
    pairs.push({
      key,
      provider: first.pair.provider,
      model: first.pair.model,
      effort: first.pair.effort_norm,
      nativeEffort: scored[0]?.pair.effort_native ? `${scored[0].pair.effort_native.param}=${scored[0].pair.effort_native.value}` : null,
      caps: [...new Set(all.map((a) => a.pair.max_output_tokens))].sort((a, b) => a - b),
      n,
      unsupported: n === 0,
      passes,
      passRate: n ? passes / n : 0,
      passWilsonLower: wl,
      firstPassCompile: compiled.length ? compiled.filter((a) => a.first_pass_compile).length / compiled.length : null,
      scores,
      H,
      Q,
      judged: false,
      C,
      T,
      tokensOut: mean(scored.map((a) => a.telemetry.tokens.output)),
      VI: n && C > 0 ? Q / C : null,
      VIt: n ? Q / (C + (th.latencyUsdPerHour * T) / 60) : null,
      meetsBar: n > 0 && Q >= th.minQuality && wl >= th.minPassWilsonLower,
      pareto: false,
      effortFlag: null,
      tasks: [...byTask.values()].map(taskStats).sort((a, b) => a.task.localeCompare(b.task)),
      statuses: countStatuses(all),
    });
  }

  markPareto(pairs);
  flagEfforts(pairs);
  return sortPairs(pairs);
}

// Non-dominated over (cost lower, quality higher, time lower).
export function markPareto(pairs: PairStats[]): void {
  const live = pairs.filter((p) => !p.unsupported);
  for (const p of live) {
    p.pareto = !live.some(
      (o) => o !== p && o.C <= p.C && o.Q >= p.Q && o.T <= p.T && (o.C < p.C || o.Q > p.Q || o.T < p.T),
    );
  }
}

export const MIN_REPS_FOR_SIGNIFICANCE = 3;

// A higher effort is flagged when it costs more than the next lower effort of the same model
// without a significant quality gain (bootstrap 95 % interval of the difference includes 0).
export function flagEfforts(pairs: PairStats[]): void {
  const byModel = new Map<string, PairStats[]>();
  for (const p of pairs.filter((x) => !x.unsupported)) byModel.set(p.model, [...(byModel.get(p.model) ?? []), p]);
  for (const list of byModel.values()) {
    list.sort((a, b) => EFFORTS.indexOf(a.effort) - EFFORTS.indexOf(b.effort));
    for (let i = 1; i < list.length; i++) {
      const lo = list[i - 1]!;
      const hi = list[i]!;
      // Rows split by output cap share an effort; only compare across effort levels.
      if (hi.C <= lo.C || hi.effort === lo.effort) continue;
      if (hi.n < MIN_REPS_FOR_SIGNIFICANCE || lo.n < MIN_REPS_FOR_SIGNIFICANCE) {
        hi.effortFlag = `costs more than @${lo.effort}; too few attempts to test the gain`;
        continue;
      }
      const d = bootstrapDiff(lo.scores, hi.scores);
      if (!(d.lo > 0)) hi.effortFlag = `no measurable gain over @${lo.effort} (ΔQ ${fmtSigned(d.diff)}, 95 % CI ${fmtSigned(d.lo)} to ${fmtSigned(d.hi)}) at ${(hi.C / lo.C).toFixed(1)}× the cost`;
    }
  }
}

const fmtSigned = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;

// Ranked by VI among pairs that meet the bar; the rest follow by quality.
export function sortPairs(pairs: PairStats[]): PairStats[] {
  return [...pairs].sort((a, b) => {
    if (a.unsupported !== b.unsupported) return a.unsupported ? 1 : -1;
    if (a.meetsBar !== b.meetsBar) return a.meetsBar ? -1 : 1;
    if (a.meetsBar) return (b.VI ?? 0) - (a.VI ?? 0);
    return b.Q - a.Q || a.C - b.C;
  });
}

export interface RouteRow {
  class: string;
  tasks: string[];
  pick: { key: string; Q: number; C: number; passRate: number; passWilsonLower: number; n: number } | null;
  best: { key: string; Q: number; C: number; n: number } | null;
  candidates: number;
}

// Cheapest pair that meets the bar on the tasks of each class.
export function routing(attempts: AttemptRecord[], th: Thresholds): RouteRow[] {
  const classes = [...new Set(attempts.map((a) => a.task.class))].sort();
  return classes.map((cls) => {
    const inClass = attempts.filter((a) => a.task.class === cls && a.status !== 'unsupported');
    const byPair = new Map<string, AttemptRecord[]>();
    const rowKey = rowKeyFn(attempts);
    for (const a of inClass) {
      const k = rowKey(a);
      byPair.set(k, [...(byPair.get(k) ?? []), a]);
    }
    const rows = [...byPair].map(([key, as]) => {
      const passes = as.filter((a) => a.status === 'pass').length;
      return {
        key,
        Q: mean(as.map(attemptScore)),
        C: mean(as.map((a) => a.telemetry.cost_usd)),
        passRate: passes / as.length,
        passWilsonLower: wilsonLower(passes, as.length),
        n: as.length,
      };
    });
    const ok = rows.filter((r) => r.Q >= th.minQuality && r.passWilsonLower >= th.minPassWilsonLower).sort((a, b) => a.C - b.C);
    const best = [...rows].sort((a, b) => b.Q - a.Q || a.C - b.C)[0] ?? null;
    return {
      class: cls,
      tasks: [...new Set(inClass.map((a) => a.task.id))].sort(),
      pick: ok[0] ?? null,
      best: best ? { key: best.key, Q: best.Q, C: best.C, n: best.n } : null,
      candidates: rows.length,
    };
  });
}

// Smallest number of passes out of n that clears the Wilson bar, for "why no pick" notes.
export function passesNeeded(n: number, minLower: number): number | null {
  for (let k = 0; k <= n; k++) if (wilsonLower(k, n) >= minLower) return k;
  return null;
}
