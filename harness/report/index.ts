// `bench report` and `bench report diff`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadMatrix } from '../matrix.ts';
import { repoPath } from '../paths.ts';
import { DRY_RUNS_DIR, LIVE_RUNS_DIR } from '../orchestrator/run.ts';
import { loadDataset } from './data.ts';
import { reportDiff } from './diff.ts';
import { deepDiveHtml } from './html.ts';
import { banners, leaderboardMarkdown, readmeBlock, routingMarkdown, updateReadme, type ReportContext } from './markdown.ts';
import { aggregate, routing, type Thresholds } from './metrics.ts';

export const REPORTS_DIR = repoPath('reports');

export function buildContext(o: { runs: string; suite: string; crossSuite: boolean; dry: boolean; th: Thresholds }): ReportContext {
  const data = loadDataset({ dir: o.runs, suite: o.suite, crossSuite: o.crossSuite, dry: o.dry });
  return { data, pairs: aggregate(data.attempts, o.th), routes: routing(data.attempts, o.th), th: o.th };
}

export async function reportCommand(args: string[]): Promise<number> {
  const sub = args[0] === 'diff' ? 'diff' : 'build';
  const { values: v } = parseArgs({
    args: sub === 'diff' ? args.slice(1) : args,
    options: {
      matrix: { type: 'string', default: repoPath('matrix', 'matrix.yaml') },
      runs: { type: 'string' },
      suite: { type: 'string' },
      'cross-suite': { type: 'boolean', default: false },
      dry: { type: 'boolean', default: false },
      out: { type: 'string' },
      base: { type: 'string' },
      target: { type: 'string' },
    },
  });
  const m = loadMatrix(v.matrix).matrix;
  const vi = m.defaults.value_index;
  const th: Thresholds = { latencyUsdPerHour: vi.latency_usd_per_hour, minQuality: vi.min_quality, minPassWilsonLower: vi.min_pass_wilson_lower };
  const ctx = buildContext({ runs: v.runs ?? (v.dry ? DRY_RUNS_DIR : LIVE_RUNS_DIR), suite: v.suite ?? m.suite_version, crossSuite: v['cross-suite'], dry: v.dry, th });

  if (sub === 'diff') {
    if (!v.base || !v.target) throw new Error('report diff needs --base <model@effort> and --target <model@effort>');
    console.log(reportDiff(ctx.data.attempts, v.base, v.target, banners(ctx)));
    return 0;
  }

  // Simulated reports never overwrite the published ones.
  const out = v.out ?? (v.dry ? join(DRY_RUNS_DIR, 'reports') : REPORTS_DIR);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'LEADERBOARD.md'), leaderboardMarkdown(ctx));
  writeFileSync(join(out, 'routing.md'), routingMarkdown(ctx));
  writeFileSync(join(out, 'index.html'), deepDiveHtml(ctx));
  console.log(`${ctx.data.attempts.length} attempt(s) from ${ctx.data.runs.length} run(s) → ${out}`);

  if (out === REPORTS_DIR) {
    const readme = repoPath('README.md');
    const before = existsSync(readme) ? readFileSync(readme, 'utf8') : '';
    const after = updateReadme(before, readmeBlock(ctx));
    if (after !== before) writeFileSync(readme, after);
    console.log('README.md leaderboard block updated');
  }
  return 0;
}
