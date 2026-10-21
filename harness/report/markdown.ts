// LEADERBOARD.md, routing.md and the README leaderboard block.

import type { Dataset } from './data.ts';
import { passesNeeded, type PairStats, type RouteRow, type Thresholds } from './metrics.ts';

export interface ReportContext {
  data: Dataset;
  pairs: PairStats[];
  routes: RouteRow[];
  th: Thresholds;
}

const pct = (x: number) => `${Math.round(x * 100)} %`;
const usd = (x: number) => (x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(3)}`);
const num = (x: number | null, d = 1) => (x === null ? 'n/a' : x >= 1000 ? Math.round(x).toLocaleString('en-US') : x.toFixed(d));

export function banners(ctx: { data: Dataset }): string[] {
  const out: string[] = [];
  const d = ctx.data;
  if (d.dry) out.push('> **SIMULATED DATA.** These numbers come from dry runs: scripted replies, fake token counts, no model was called. They test the report, not any model.');
  if (d.crossSuite && d.suites.length > 1) out.push(`> **Mixed suite versions (${d.suites.join(', ')}).** Results from different suites are not comparable; ranked together only because \`--cross-suite\` was passed.`);
  out.push('> Quality **Q** is the hidden-test score only: no judge has scored these attempts yet.');
  if (ctx.data.attempts.length > 0 && ctx.data.attempts.length < 12) out.push(`> **Small sample:** ${ctx.data.attempts.length} attempt(s) in total. Treat every number as an anecdote until each pair has 3+ reps per task.`);
  if (d.runs.some((r) => r.harness_dirty)) out.push('> Some runs used a harness with uncommitted changes (`harness_dirty`).');
  return out.map((b) => `${b}\n`);
}

function metaLine(ctx: ReportContext): string {
  const d = ctx.data;
  const prices = [...new Set(d.runs.map((r) => r.price_table_version))].join(', ') || 'n/a';
  return [
    `Suite **${d.suites.join(', ') || 'n/a'}** · prices **${prices}** · ${d.runs.length} run(s) · ${d.attempts.length} attempt(s) · total spend **${usd(d.totalCostUsd)}**${d.dry ? ' (simulated)' : ''}` +
      (d.finishedAt ? ` · data as of ${d.finishedAt.slice(0, 16).replace('T', ' ')} UTC` : ''),
    `Value Index bar: Q ≥ ${ctx.th.minQuality} and pass-rate Wilson lower bound ≥ ${ctx.th.minPassWilsonLower}. λ = $${ctx.th.latencyUsdPerHour}/h.`,
  ].join('  \n');
}

function highlights(pairs: PairStats[]): string[] {
  const live = pairs.filter((p) => !p.unsupported);
  if (!live.length) return ['No attempts yet.'];
  const ranked = live.filter((p) => p.meetsBar);
  const best = (f: (p: PairStats) => number) => [...live].sort((a, b) => f(b) - f(a))[0]!;
  const lines = [
    ranked.length
      ? `- **Best value:** \`${ranked[0]!.key}\`, ${num(ranked[0]!.VI, 0)} quality points per $1`
      : '- **Best value:** none yet. No pair meets the bar (see the leaderboard notes).',
    `- **Highest quality:** \`${best((p) => p.Q).key}\`, Q ${best((p) => p.Q).Q.toFixed(2)}`,
    `- **Cheapest per attempt:** \`${best((p) => -p.C).key}\`, ${usd(best((p) => -p.C).C)}`,
    `- **Fastest:** \`${best((p) => -p.T).key}\`, ${best((p) => -p.T).T.toFixed(2)} min per attempt`,
  ];
  return lines;
}

function notes(p: PairStats, th: Thresholds): string {
  const n: string[] = [];
  if (p.pareto) n.push('Pareto');
  if (!p.meetsBar) {
    const why: string[] = [];
    if (p.Q < th.minQuality) why.push(`Q < ${th.minQuality}`);
    if (p.passWilsonLower < th.minPassWilsonLower) {
      const need = passesNeeded(p.n, th.minPassWilsonLower);
      why.push(need === null ? `needs more attempts (n=${p.n} can't clear the bar)` : `pass-rate bound < ${th.minPassWilsonLower}`);
    }
    n.push(`below bar: ${why.join(', ')}`);
  }
  if (p.effortFlag) n.push(p.effortFlag);
  return n.join('; ');
}

export function leaderboardTable(pairs: PairStats[], th: Thresholds, limit = Infinity): string[] {
  const rows = [
    '| # | Pair | Provider | Output cap | Attempts | Pass rate (Wilson lo) | 1st-pass compile | Q | $ / attempt | min / attempt | VI (Q per $) | VI_t | Notes |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  let rank = 0;
  for (const p of pairs.filter((x) => !x.unsupported).slice(0, limit)) {
    rank++;
    rows.push(
      `| ${p.meetsBar ? rank : '–'} | \`${p.key}\` | ${p.provider} | ${p.caps.map((c) => `${Math.round(c / 1000)}k`).join(', ')} | ${p.n} | ${pct(p.passRate)} (${pct(p.passWilsonLower)}) | ${p.firstPassCompile === null ? 'n/a' : pct(p.firstPassCompile)} | ` +
        `${p.Q.toFixed(2)} | ${usd(p.C)} | ${p.T.toFixed(2)} | ${p.VI === null ? 'n/a' : num(p.VI, 0)} | ${p.VIt === null ? 'n/a' : num(p.VIt, 2)} | ${notes(p, th)} |`,
    );
  }
  return rows;
}

function taskTable(pairs: PairStats[]): string[] {
  const live = pairs.filter((p) => !p.unsupported);
  const tasks = [...new Set(live.flatMap((p) => p.tasks.map((t) => `${t.task}|${t.class}`)))].sort();
  if (!tasks.length) return [];
  const head = `| Pair | ${tasks.map((t) => `${t.split('|')[0]} (${t.split('|')[1]})`).join(' | ')} |`;
  const rows = [head, `|---|${tasks.map(() => '---').join('|')}|`];
  for (const p of live) {
    const cells = tasks.map((tk) => {
      const t = p.tasks.find((x) => `${x.task}|${x.class}` === tk);
      if (!t) return '·';
      const failures = Object.entries(t.statuses).filter(([s]) => s !== 'pass').map(([s, c]) => `${s} ${c}`).join(', ');
      return `${t.passes}/${t.n} pass · Q ${t.meanH.toFixed(2)} (best ${t.bestH.toFixed(2)}) · pass@${t.n} ${pct(t.passAtN)}${failures ? ` · ${failures}` : ''}`;
    });
    rows.push(`| \`${p.key}\` | ${cells.join(' | ')} |`);
  }
  return rows;
}

export function routingTable(routes: RouteRow[], th: Thresholds): string[] {
  if (!routes.length) return ['No attempts yet.'];
  const rows = ['| Class | Tasks | Cheapest pair meeting the bar | Q | $ / attempt | Highest quality seen |', '|---|---|---|---|---|---|'];
  for (const r of routes) {
    const best = r.best ? `\`${r.best.key}\` (Q ${r.best.Q.toFixed(2)}, ${usd(r.best.C)}, n=${r.best.n})` : '–';
    rows.push(
      r.pick
        ? `| ${r.class} | ${r.tasks.join(', ')} | \`${r.pick.key}\` | ${r.pick.Q.toFixed(2)} | ${usd(r.pick.C)} | ${best} |`
        : `| ${r.class} | ${r.tasks.join(', ')} | none of ${r.candidates} pair(s) meets the bar yet | – | – | ${best} |`,
    );
  }
  rows.push('', `Bar: Q ≥ ${th.minQuality} and pass-rate Wilson lower bound ≥ ${th.minPassWilsonLower} on that class's tasks. With one task per class (suite 1.x), "per class" really means "per task".`);
  return rows;
}

const DEFINITIONS = [
  '## How to read this',
  '',
  '- **Pass**: every visible gate passed (cargo check, cargo test, tsc, ESLint, Vitest) within 1 + R turns. Capped, refused and errored attempts count as failures.',
  '- **Q** (quality): mean hidden-test fraction per attempt; 0 when the final code does not compile or the attempt was capped. Judge scores will add 20 % weight once they exist.',
  '- **VI** = Q ÷ mean $ per attempt. **VI_t** = Q ÷ ($ + λ · hours), which prices waiting time at λ $/h.',
  '- **Pareto**: no other pair is at least as cheap, as good and as fast, and strictly better on one of them.',
  '- **Wilson lo**: lower end of the 95 % interval for the pass rate; small samples get a low bound, so one lucky pass can\'t win.',
  '- Efforts are provider labels, not equivalent settings: `high` on one provider is not `high` on another.',
  '',
];

export function leaderboardMarkdown(ctx: ReportContext): string {
  const unsupported = ctx.pairs.filter((p) => p.unsupported);
  return [
    '# Leaderboard',
    '',
    ...banners(ctx),
    metaLine(ctx),
    '',
    ...highlights(ctx.pairs),
    '',
    '## Rankings',
    '',
    'Ranked by VI among pairs that meet the bar; the rest follow by quality, unranked.',
    '',
    ...leaderboardTable(ctx.pairs, ctx.th),
    '',
    '## Per task',
    '',
    ...taskTable(ctx.pairs),
    '',
    '## Routing: cheapest acceptable pair per class',
    '',
    ...routingTable(ctx.routes, ctx.th),
    '',
    ...(unsupported.length ? ['## Unsupported pairs', '', ...unsupported.map((p) => `- \`${p.key}\`: the model has no setting for this effort level; nothing was sent.`), ''] : []),
    ...DEFINITIONS,
    'Charts: [index.html](index.html).',
    '',
  ].join('\n');
}

export function routingMarkdown(ctx: ReportContext): string {
  return ['# Routing table', '', ...banners(ctx), metaLine(ctx), '', ...routingTable(ctx.routes, ctx.th), ''].join('\n');
}

const README_START = '<!-- leaderboard:start -->';
const README_END = '<!-- leaderboard:end -->';

function badge(label: string, message: string, color: string): string {
  const esc = (s: string) => encodeURIComponent(s.replace(/-/g, '--').replace(/_/g, '__'));
  return `![${label}: ${message}](https://img.shields.io/badge/${esc(label)}-${esc(message)}-${color})`;
}

export function readmeBlock(ctx: ReportContext): string {
  const ranked = ctx.pairs.filter((p) => p.meetsBar);
  const d = ctx.data;
  const badges = [
    badge('suite', d.suites.join(',') || 'n/a', 'blue'),
    badge('attempts', String(d.attempts.length), 'blue'),
    badge('best value', ranked[0]?.key ?? 'none yet', ranked.length ? '2ea44f' : 'lightgrey'),
  ];
  return [
    README_START,
    badges.join(' '),
    '',
    ...banners(ctx),
    ...leaderboardTable(ctx.pairs, ctx.th, 5),
    '',
    'Full tables: [reports/LEADERBOARD.md](reports/LEADERBOARD.md) · routing: [reports/routing.md](reports/routing.md) · charts: [reports/index.html](reports/index.html)',
    README_END,
  ].join('\n');
}

export function updateReadme(readme: string, block: string): string {
  const s = readme.indexOf(README_START);
  const e = readme.indexOf(README_END);
  if (s === -1 || e === -1) return `${readme.trimEnd()}\n\n## Leaderboard\n\n${block}\n`;
  return readme.slice(0, s) + block + readme.slice(e + README_END.length);
}
