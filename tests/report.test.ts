import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDataset } from '../harness/report/data.ts';
import { reportDiff, significance } from '../harness/report/diff.ts';
import { deepDiveHtml } from '../harness/report/html.ts';
import { buildContext } from '../harness/report/index.ts';
import { leaderboardMarkdown, readmeBlock, updateReadme } from '../harness/report/markdown.ts';
import { aggregate, attemptScore, markPareto, passesNeeded, routing, rowKeyFn, type PairStats, type Thresholds } from '../harness/report/metrics.ts';
import { bootstrapDiff, passAtK, wilsonLower } from '../harness/report/stats.ts';
import { fixtureAttempt, FIXTURE_PAIRS, writeFixtureRun } from './report-fixtures.ts';
import { rng } from '../harness/report/stats.ts';

const th: Thresholds = { latencyUsdPerHour: 60, minQuality: 0.6, minPassWilsonLower: 0.4 };

describe('stats', () => {
  it('Wilson lower bound', () => {
    expect(wilsonLower(0, 0)).toBe(0);
    expect(wilsonLower(1, 1)).toBeCloseTo(0.2065, 3);
    expect(wilsonLower(12, 12)).toBeCloseTo(0.7575, 3);
    expect(wilsonLower(5, 10)).toBeCloseTo(0.2366, 3);
  });

  it('pass@k', () => {
    expect(passAtK(3, 0, 1)).toBe(0);
    expect(passAtK(3, 1, 1)).toBeCloseTo(1 / 3, 10);
    expect(passAtK(3, 1, 3)).toBe(1);
    expect(passAtK(5, 2, 2)).toBeCloseTo(1 - (3 / 5) * (2 / 4), 10);
  });

  it('bootstrap is deterministic and detects a clear difference', () => {
    const a = [0, 0.1, 0.05, 0.1, 0];
    const b = [0.9, 1, 0.95, 1, 0.9];
    const d1 = bootstrapDiff(a, b);
    expect(d1).toEqual(bootstrapDiff(a, b));
    expect(d1.lo).toBeGreaterThan(0.7);
    const same = bootstrapDiff([0, 1, 0, 1], [1, 0, 1, 0]);
    expect(same.lo).toBeLessThan(0);
    expect(same.hi).toBeGreaterThan(0);
  });

  it('passes needed to clear the bar', () => {
    expect(passesNeeded(1, 0.4)).toBeNull();
    expect(passesNeeded(2, 0.4)).toBeNull();
    expect(passesNeeded(3, 0.4)).toBe(3);
    expect(passesNeeded(12, 0.4)).toBe(9); // 8/12 gives 0.391
  });
});

describe('scoring', () => {
  const r = rng(1);
  const p = FIXTURE_PAIRS[0]!;
  const t = { id: 'A', class: 'C2' as const, difficulty: 0 };

  it('capped, unsupported and non-compiling attempts score 0; others score the hidden fraction', () => {
    const a = fixtureAttempt('2026-10-21T00-00-00Z_000000', 0, p, t, 0, r);
    a.status = 'fail';
    a.hidden = { passed: 15, total: 20 };
    expect(attemptScore(a)).toBe(0.75);
    a.iterations[0]!.gates.tsc = { ok: false, ms: 1, exit_code: 2, output_tail: '' };
    expect(attemptScore(a)).toBe(0);
    a.iterations[0]!.gates.tsc = { ok: true, ms: 1, exit_code: 0, output_tail: '' };
    a.status = 'capped_timeout';
    expect(attemptScore(a)).toBe(0);
  });

  it('Pareto marks only non-dominated pairs', () => {
    const mk = (key: string, C: number, Q: number, T: number) => ({ key, C, Q, T, unsupported: false, pareto: false }) as PairStats;
    const ps = [mk('cheap', 1, 0.5, 1), mk('good', 3, 0.9, 1), mk('dominated', 3, 0.5, 2), mk('fast', 5, 0.5, 0.1)];
    markPareto(ps);
    expect(ps.map((p) => p.pareto)).toEqual([true, true, false, true]);
  });
});

describe('aggregate over fixture data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-rep-'));
  writeFixtureRun(dir, { reps: 3 });
  const data = loadDataset({ dir, suite: '1.0.0', crossSuite: false, dry: true });
  const pairs = aggregate(data.attempts, th);

  it('loads only matching dry/live data and the requested suite', () => {
    expect(data.attempts).toHaveLength(3 * 6 * 4);
    expect(loadDataset({ dir, suite: '1.0.0', crossSuite: false, dry: false }).attempts).toHaveLength(0);
    writeFixtureRun(dir, { suite: '2.0.0', reps: 1, runId: '2026-10-22T00-00-00Z_f2f2f2' });
    expect(loadDataset({ dir, suite: '1.0.0', crossSuite: false, dry: true }).suites).toEqual(['1.0.0']);
    const cross = loadDataset({ dir, suite: '1.0.0', crossSuite: true, dry: true });
    expect(cross.suites).toEqual(['1.0.0', '2.0.0']);
  });

  it('unsupported pairs are listed but never scored or ranked', () => {
    const u = pairs.find((p) => p.key === 'gemini-3.5-flash-lite@none')!;
    expect(u.unsupported).toBe(true);
    expect(u.n).toBe(0);
    expect(pairs.at(-1)!.key).toBe(u.key);
  });

  it('ranked pairs come first, sorted by VI; every metric is finite', () => {
    const ranked = pairs.filter((p) => p.meetsBar);
    expect(pairs.slice(0, ranked.length)).toEqual(ranked);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1]!.VI!).toBeGreaterThanOrEqual(ranked[i]!.VI!);
    for (const p of pairs.filter((x) => !x.unsupported)) {
      for (const v of [p.Q, p.C, p.T, p.passRate, p.passWilsonLower, p.VI!, p.VIt!]) expect(Number.isFinite(v)).toBe(true);
      expect(p.n).toBe(12);
    }
  });

  it('flags a costlier effort only with evidence (or says there is too little)', () => {
    const hi = pairs.find((p) => p.key === 'claude-haiku-5-5@high')!;
    expect(hi.effortFlag).toMatch(/no measurable gain over @low/);
  });

  it('routing picks the cheapest pair meeting the bar per class', () => {
    const routes = routing(data.attempts, th);
    expect(routes.map((r) => r.class)).toEqual(['C2', 'C3', 'C4']);
    for (const r of routes) {
      if (!r.pick) continue;
      expect(r.pick.Q).toBeGreaterThanOrEqual(th.minQuality);
      expect(r.pick.passWilsonLower).toBeGreaterThanOrEqual(th.minPassWilsonLower);
    }
  });

  it('diff reports per task with a significance note', () => {
    const md = reportDiff(data.attempts, 'claude-haiku-5-5@high', 'claude-haiku-5-5@low', []);
    expect(md).toContain('| **all tasks** | 12 / 12 |');
    expect(md).toContain('| task D | 3 / 3 |');
    expect(md).toMatch(/no significant difference|target (better|worse)/);
    expect(() => reportDiff(data.attempts, 'nope@low', 'claude-haiku-5-5@low', [])).toThrow(/No attempts for nope@low/);
    expect(significance([1], [0])).toMatch(/needs at least 3 attempts per side/);
  });

  it('renders Markdown and HTML with the simulated banner and no NaN', () => {
    const ctx = buildContext({ runs: dir, suite: '1.0.0', crossSuite: false, dry: true, th });
    const md = leaderboardMarkdown(ctx);
    const html = deepDiveHtml(ctx);
    for (const s of [md, html]) {
      expect(s).toContain('SIMULATED');
      expect(s).not.toMatch(/NaN|undefined|Infinity/);
    }
    expect(md).toContain('## Unsupported pairs');
    expect(html.match(/<svg /g)!.length).toBeGreaterThanOrEqual(3);
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it('README block is replaced in place', () => {
    const ctx = buildContext({ runs: dir, suite: '1.0.0', crossSuite: false, dry: true, th });
    const block = readmeBlock(ctx);
    const once = updateReadme('# T\n\nintro\n\n<!-- leaderboard:start -->\nold\n<!-- leaderboard:end -->\n\nafter\n', block);
    expect(once).toContain('intro');
    expect(once).toContain('after');
    expect(once).not.toContain('old');
    expect(updateReadme(once, block)).toBe(once);
  });
});

describe('rows split by output cap', () => {
  const r = rng(3);
  const t = { id: 'A', class: 'C2' as const, difficulty: 0 };
  const hi = FIXTURE_PAIRS[1]!;
  const lo = FIXTURE_PAIRS[0]!;
  const mk = (p: typeof hi, i: number, cap: number) => {
    const a = fixtureAttempt('2026-10-21T00-00-00Z_000000', i, p, t, i, r);
    a.pair.max_output_tokens = cap;
    return a;
  };

  it('labels a model@effort by cap only when its attempts used more than one', () => {
    const as = [mk(hi, 0, 16000), mk(hi, 1, 32000), mk(lo, 2, 16000)];
    const key = rowKeyFn(as);
    expect(as.map(key)).toEqual(['claude-haiku-5-5@high/16k', 'claude-haiku-5-5@high/32k', 'claude-haiku-5-5@low']);
    const rows = aggregate(as, th).map((p) => p.key).sort();
    expect(rows).toEqual(['claude-haiku-5-5@high/16k', 'claude-haiku-5-5@high/32k', 'claude-haiku-5-5@low']);
    expect(reportDiff(as, 'claude-haiku-5-5@high/16k', 'claude-haiku-5-5@high/32k', [])).toContain('| **all tasks** | 1 / 1 |');
  });
});
