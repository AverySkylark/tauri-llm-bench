// Standalone HTML deep-dive (reports/index.html, served by Pages): Pareto scatter, failure
// heatmap, effort scaling per model. Inline SVG rendered here, no external scripts or fonts.
// Palette and mark specs follow the dataviz reference palette; provider colours were validated
// all-pairs in light and dark mode, and each provider also gets its own marker shape.

import { EFFORTS } from '../../adapters/types.ts';
import { banners, routingTable, type ReportContext } from './markdown.ts';
import type { PairStats } from './metrics.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const usd = (x: number) => (x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(3)}`);
const pct = (x: number) => `${Math.round(x * 100)} %`;
const f2 = (x: number) => x.toFixed(2);

// Fixed slot per provider: colour follows the entity, never its rank.
const PROVIDER_SLOT: Record<string, { v: string; shape: 'circle' | 'square' | 'diamond' }> = {
  anthropic: { v: '--series-1', shape: 'circle' },
  openai: { v: '--series-2', shape: 'square' },
  google: { v: '--series-3', shape: 'diamond' },
};

function marker(shape: string, x: number, y: number, r: number, fill: string, attrs = ''): string {
  if (shape === 'square') return `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" rx="1.5" fill="${fill}" ${attrs}/>`;
  if (shape === 'diamond') return `<path d="M${x} ${y - r * 1.3}L${x + r * 1.3} ${y}L${x} ${y + r * 1.3}L${x - r * 1.3} ${y}Z" fill="${fill}" ${attrs}/>`;
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" ${attrs}/>`;
}

function tip(lines: string[]): string {
  return esc(JSON.stringify(lines));
}

function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
    }
  }
  return out;
}

function fmtUsdTick(v: number): string {
  return v >= 1 ? `$${v}` : `$${Number(v.toPrecision(1))}`;
}

function paretoChart(pairs: PairStats[], minQ: number): string {
  const pts = pairs.filter((p) => !p.unsupported && p.C > 0);
  if (!pts.length) return '<p class="empty">No priced attempts yet.</p>';
  const W = 720, H = 400, L = 56, R = 24, T = 20, B = 48;
  let lo = Math.min(...pts.map((p) => p.C));
  let hi = Math.max(...pts.map((p) => p.C));
  lo /= 2;
  hi *= 2;
  const x = (c: number) => L + ((Math.log10(c) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (W - L - R);
  const y = (q: number) => T + (1 - q) * (H - T - B);
  const g: string[] = [];
  for (const q of [0, 0.25, 0.5, 0.75, 1]) {
    g.push(`<line x1="${L}" x2="${W - R}" y1="${y(q)}" y2="${y(q)}" class="${q === 0 ? 'axis' : 'grid'}"/>`);
    g.push(`<text x="${L - 8}" y="${y(q) + 4}" class="tick" text-anchor="end">${q.toFixed(2)}</text>`);
  }
  for (const t of logTicks(lo, hi)) {
    g.push(`<line x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${H - B}" class="grid"/>`);
    g.push(`<text x="${x(t)}" y="${H - B + 18}" class="tick" text-anchor="middle">${fmtUsdTick(t)}</text>`);
  }
  g.push(`<line x1="${L}" x2="${W - R}" y1="${y(minQ)}" y2="${y(minQ)}" class="ref"/>`);
  g.push(`<text x="${W - R}" y="${y(minQ) - 6}" class="tick" text-anchor="end">quality bar ${minQ}</text>`);
  g.push(`<text x="${(L + W - R) / 2}" y="${H - 8}" class="axis-label" text-anchor="middle">Mean cost per attempt (log scale)</text>`);
  g.push(`<text x="14" y="${(T + H - B) / 2}" class="axis-label" text-anchor="middle" transform="rotate(-90 14 ${(T + H - B) / 2})">Quality Q</text>`);

  // Cost–quality frontier line (2-D projection of the Pareto set).
  const front = [...pts].sort((a, b) => a.C - b.C || b.Q - a.Q).filter((p, i, arr) => arr.slice(0, i).every((o) => o.Q < p.Q));
  if (front.length > 1) g.push(`<polyline class="frontier" points="${front.map((p) => `${x(p.C)},${y(p.Q)}`).join(' ')}"/>`);

  for (const p of pts) {
    const s = PROVIDER_SLOT[p.provider] ?? PROVIDER_SLOT.anthropic!;
    const lines = [p.key, `Q ${f2(p.Q)} · pass ${pct(p.passRate)} (n=${p.n})`, `${usd(p.C)} per attempt · ${f2(p.T)} min`, p.pareto ? 'Pareto (cost, quality, time)' : 'dominated'];
    g.push(`<g class="pt" tabindex="0" data-tip="${tip(lines)}">`);
    g.push(`<circle cx="${x(p.C)}" cy="${y(p.Q)}" r="14" class="hit"/>`);
    g.push(marker(s.shape, x(p.C), y(p.Q), 5, `var(${s.v})`, 'class="mark"'));
    g.push('</g>');
    // Labels on the right half sit left of their point so they never run off the plot.
    const right = x(p.C) > (L + W - R) / 2;
    if (p.pareto) g.push(`<text x="${x(p.C) + (right ? -10 : 10)}" y="${y(p.Q) - 9}" class="dlabel" text-anchor="${right ? 'end' : 'start'}">${esc(p.key)}</text>`);
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cost versus quality per pair">${g.join('')}</svg>`;
}

const SEQ = ['--seq-100', '--seq-250', '--seq-400', '--seq-550', '--seq-700'];
const binOf = (q: number) => Math.min(4, Math.floor(q * 5));

function heatmap(pairs: PairStats[]): string {
  const live = pairs.filter((p) => !p.unsupported);
  const tasks = [...new Set(live.flatMap((p) => p.tasks.map((t) => `${t.task}|${t.class}`)))].sort();
  if (!tasks.length) return '<p class="empty">No attempts yet.</p>';
  const LW = 230, CW = 116, RH = 40, TH = 34;
  const W = LW + CW * tasks.length + 8, H = TH + RH * live.length + 4;
  const g: string[] = [];
  tasks.forEach((tk, j) => {
    const [id, cls] = tk.split('|');
    g.push(`<text x="${LW + CW * j + CW / 2}" y="20" class="tick" text-anchor="middle">Task ${id} · ${cls}</text>`);
  });
  live.forEach((p, i) => {
    const y0 = TH + RH * i;
    g.push(`<text x="${LW - 10}" y="${y0 + RH / 2 + 4}" class="rowlabel" text-anchor="end">${esc(p.key)}</text>`);
    tasks.forEach((tk, j) => {
      const t = p.tasks.find((x) => `${x.task}|${x.class}` === tk);
      const x0 = LW + CW * j;
      if (!t) {
        g.push(`<rect x="${x0 + 1}" y="${y0 + 1}" width="${CW - 2}" height="${RH - 2}" rx="4" class="nodata"/>`);
        g.push(`<text x="${x0 + CW / 2}" y="${y0 + RH / 2 + 4}" class="tick" text-anchor="middle">no data</text>`);
        return;
      }
      const b = binOf(t.meanH);
      const fails = Object.entries(t.statuses).filter(([s]) => s !== 'pass').map(([s, c]) => `${s} × ${c}`);
      const lines = [`${p.key} · task ${t.task}`, `${t.passes}/${t.n} passed gates · Q ${f2(t.meanH)} (best ${f2(t.bestH)})`, `pass@${t.n} ${pct(t.passAtN)}`, ...(fails.length ? [`failures: ${fails.join(', ')}`] : [])];
      g.push(`<g class="cell" tabindex="0" data-tip="${tip(lines)}">`);
      g.push(`<rect x="${x0 + 1}" y="${y0 + 1}" width="${CW - 2}" height="${RH - 2}" rx="4" fill="var(${SEQ[b]})"/>`);
      g.push(`<text x="${x0 + CW / 2}" y="${y0 + RH / 2 + 4}" text-anchor="middle" class="ct t${b}">${t.passes}/${t.n} · ${f2(t.meanH)}</text>`);
      g.push('</g>');
    });
  });
  const legend = SEQ.map((v, i) => `<span class="sw"><i style="background:var(${v})"></i>${(i * 0.2).toFixed(1)}–${((i + 1) * 0.2).toFixed(1)}</span>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Pass count and quality per pair and task">${g.join('')}</svg><div class="legend">Cell colour = Q (hidden-test score): ${legend}</div>`;
}

function effortCharts(pairs: PairStats[]): string {
  const byModel = new Map<string, PairStats[]>();
  for (const p of pairs) byModel.set(p.model, [...(byModel.get(p.model) ?? []), p]);
  const maxC = Math.max(0, ...pairs.filter((p) => !p.unsupported).map((p) => p.C)) || 1;
  const cards: string[] = [];
  for (const [model, list] of [...byModel].sort(([a], [b]) => a.localeCompare(b))) {
    const s = PROVIDER_SLOT[list[0]!.provider] ?? PROVIDER_SLOT.anthropic!;
    const mini = (metric: 'Q' | 'C') => {
      const W = 460, H = 200, L = 54, R = 16, T = 14, B = 30;
      const top = metric === 'Q' ? 1 : maxC;
      const x = (e: string) => L + (EFFORTS.indexOf(e as (typeof EFFORTS)[number]) / (EFFORTS.length - 1)) * (W - L - R);
      const y = (v: number) => T + (1 - v / top) * (H - T - B);
      const g: string[] = [];
      for (const frac of [0, 0.5, 1]) {
        g.push(`<line x1="${L}" x2="${W - R}" y1="${y(top * frac)}" y2="${y(top * frac)}" class="${frac === 0 ? 'axis' : 'grid'}"/>`);
        g.push(`<text x="${L - 6}" y="${y(top * frac) + 4}" class="tick" text-anchor="end">${metric === 'Q' ? (top * frac).toFixed(1) : fmtUsdTick(Number((top * frac).toPrecision(2)))}</text>`);
      }
      for (const e of EFFORTS) g.push(`<text x="${x(e)}" y="${H - 10}" class="tick" text-anchor="middle">${e}</text>`);
      const pts = list.filter((p) => !p.unsupported).sort((a, b) => EFFORTS.indexOf(a.effort) - EFFORTS.indexOf(b.effort));
      const val = (p: PairStats) => (metric === 'Q' ? p.Q : p.C);
      if (pts.length > 1) g.push(`<polyline class="series" style="stroke:var(${s.v})" points="${pts.map((p) => `${x(p.effort)},${y(val(p))}`).join(' ')}"/>`);
      for (const p of pts) {
        const lines = [p.key, metric === 'Q' ? `Q ${f2(p.Q)} (n=${p.n})` : `${usd(p.C)} per attempt (n=${p.n})`, ...(p.effortFlag ? [p.effortFlag] : [])];
        g.push(`<g class="pt" tabindex="0" data-tip="${tip(lines)}"><circle cx="${x(p.effort)}" cy="${y(val(p))}" r="14" class="hit"/>`);
        g.push(marker(s.shape, x(p.effort), y(val(p)), 4.5, `var(${s.v})`, 'class="mark"'));
        g.push('</g>');
      }
      for (const p of list.filter((q) => q.unsupported)) g.push(`<text x="${x(p.effort)}" y="${y(0) - 8}" class="tick" text-anchor="middle">n/a</text>`);
      return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${metric === 'Q' ? 'Quality' : 'Cost'} by effort for ${esc(model)}">${g.join('')}</svg>`;
    };
    const flags = list.filter((p) => p.effortFlag).map((p) => `<li><code>${esc(p.key)}</code>: ${esc(p.effortFlag!)}</li>`).join('');
    cards.push(
      `<div class="card"><h3>${esc(model)} <span class="muted">(${esc(list[0]!.provider)})</span></h3>` +
        `<div class="minis"><figure><figcaption>Quality Q</figcaption>${mini('Q')}</figure><figure><figcaption>Mean $ per attempt</figcaption>${mini('C')}</figure></div>` +
        (flags ? `<ul class="flags">${flags}</ul>` : '') +
        '</div>',
    );
  }
  return `<div class="cards">${cards.join('')}</div>`;
}

function pairTable(pairs: PairStats[]): string {
  const rows = pairs
    .filter((p) => !p.unsupported)
    .map(
      (p) =>
        `<tr><td><code>${esc(p.key)}</code></td><td>${esc(p.provider)}</td><td>${esc(p.nativeEffort ?? '')}</td><td class="n">${p.caps.map((c) => `${Math.round(c / 1000)}k`).join(', ')}</td><td class="n">${p.n}</td><td class="n">${pct(p.passRate)}</td><td class="n">${pct(p.passWilsonLower)}</td>` +
        `<td class="n">${p.firstPassCompile === null ? 'n/a' : pct(p.firstPassCompile)}</td><td class="n">${f2(p.Q)}</td><td class="n">${usd(p.C)}</td><td class="n">${f2(p.T)}</td>` +
        `<td class="n">${p.VI === null ? 'n/a' : Math.round(p.VI).toLocaleString('en-US')}</td><td class="n">${p.VIt === null ? 'n/a' : f2(p.VIt)}</td><td>${p.pareto ? 'yes' : ''}</td><td>${p.meetsBar ? 'yes' : 'no'}</td></tr>`,
    )
    .join('');
  return `<table><thead><tr><th>Pair</th><th>Provider</th><th>Native effort</th><th>Output cap</th><th>n</th><th>Pass</th><th>Wilson lo</th><th>1st-pass compile</th><th>Q</th><th>$ / attempt</th><th>min</th><th>VI</th><th>VI_t</th><th>Pareto</th><th>Meets bar</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function taskTable(pairs: PairStats[]): string {
  const rows = pairs
    .filter((p) => !p.unsupported)
    .flatMap((p) =>
      p.tasks.map(
        (t) =>
          `<tr><td><code>${esc(p.key)}</code></td><td>${t.task} (${t.class})</td><td class="n">${t.passes}/${t.n}</td><td class="n">${f2(t.meanH)}</td><td class="n">${f2(t.bestH)}</td><td class="n">${pct(t.passAtN)}</td>` +
          `<td>${esc(Object.entries(t.statuses).map(([s, c]) => `${s} ${c}`).join(', '))}</td></tr>`,
      ),
    )
    .join('');
  return `<table><thead><tr><th>Pair</th><th>Task</th><th>Passed</th><th>Q mean</th><th>Q best</th><th>pass@n</th><th>Statuses</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function mdToHtml(lines: string[]): string {
  // Only what the banners and routing table use: blockquote, bold, code, pipe tables.
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');
  const out: string[] = [];
  let table: string[][] | null = null;
  const flush = () => {
    if (!table) return;
    const [head, , ...body] = table;
    out.push(`<table><thead><tr>${head!.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    table = null;
  };
  for (const raw of lines) {
    const l = raw.trim();
    if (l.startsWith('|')) {
      (table ??= []).push(l.slice(1, -1).split('|').map((c) => c.trim()));
      continue;
    }
    flush();
    if (l.startsWith('> ')) out.push(`<p class="banner">${inline(l.slice(2))}</p>`);
    else if (l) out.push(`<p>${inline(l)}</p>`);
  }
  flush();
  return out.join('\n');
}

export function deepDiveHtml(ctx: ReportContext): string {
  const d = ctx.data;
  const title = d.dry ? 'Tauri LLM Bench (simulated)' : 'Tauri LLM Bench';
  const meta = `Suite ${esc(d.suites.join(', ') || 'n/a')} · ${d.runs.length} run(s) · ${d.attempts.length} attempt(s) · total spend ${usd(d.totalCostUsd)}${d.dry ? ' (simulated)' : ''}${d.finishedAt ? ` · data as of ${esc(d.finishedAt.slice(0, 16).replace('T', ' '))} UTC` : ''} · λ $${ctx.th.latencyUsdPerHour}/h`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root {
  color-scheme: light;
  --page: #f9f9f7; --surface-1: #fcfcfb; --text-primary: #0b0b0b; --text-secondary: #52514e; --muted: #898781;
  --grid: #e1e0d9; --axis: #c3c2b7; --border: rgba(11,11,11,0.10);
  --series-1: #2a78d6; --series-2: #eb6834; --series-3: #1baf7a;
  --seq-100: #cde2fb; --seq-250: #86b6ef; --seq-400: #3987e5; --seq-550: #1c5cab; --seq-700: #0d366b;
  --banner: #fff6e0;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --page: #0d0d0d; --surface-1: #1a1a19; --text-primary: #f0efec; --text-secondary: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10);
    --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70;
    --seq-100: #104281; --seq-250: #1c5cab; --seq-400: #2a78d6; --seq-550: #6da7ec; --seq-700: #cde2fb;
    --banner: #2f2610;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #0d0d0d; --surface-1: #1a1a19; --text-primary: #f0efec; --text-secondary: #c3c2b7; --muted: #898781;
  --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10);
  --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70;
  --seq-100: #104281; --seq-250: #1c5cab; --seq-400: #2a78d6; --seq-550: #6da7ec; --seq-700: #cde2fb;
  --banner: #2f2610;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--text-primary); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1080px; margin: 0 auto; padding: 24px 16px 64px; }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
h1 { font-size: 24px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 40px 0 8px; } h3 { font-size: 15px; margin: 0 0 8px; }
.muted, .meta { color: var(--text-secondary); } .meta { font-size: 13px; }
.banner { background: var(--banner); border-radius: 8px; padding: 8px 12px; margin: 8px 0; }
.card { background: var(--surface-1); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin: 8px 0; }
.cards { display: grid; gap: 12px; }
.minis { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 16px; }
figure { margin: 0; } figcaption { font-size: 12px; color: var(--text-secondary); }
svg { width: 100%; height: auto; display: block; overflow: visible; }
.grid { stroke: var(--grid); stroke-width: 1; } .axis { stroke: var(--axis); stroke-width: 1; }
.ref { stroke: var(--muted); stroke-width: 1; }
.frontier { fill: none; stroke: var(--text-secondary); stroke-width: 2; opacity: .5; }
.series { fill: none; stroke-width: 2; }
.tick { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.axis-label, .rowlabel { fill: var(--text-secondary); font-size: 12px; }
.dlabel { fill: var(--text-primary); font-size: 12px; }
.mark { stroke: var(--surface-1); stroke-width: 2; }
.hit { fill: transparent; } .pt, .cell { cursor: default; outline: none; }
.pt:focus .mark, .pt:hover .mark { stroke: var(--text-primary); }
.cell:focus rect, .cell:hover rect { stroke: var(--text-primary); stroke-width: 2; }
.nodata { fill: none; stroke: var(--grid); }
.ct { font-size: 12px; font-variant-numeric: tabular-nums; fill: #0b0b0b; }
.t3, .t4 { fill: #ffffff; }
:root[data-theme="dark"] .t0, :root[data-theme="dark"] .t1 { fill: #f0efec; }
:root[data-theme="dark"] .t3, :root[data-theme="dark"] .t4 { fill: #0b0b0b; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .t0, :root:not([data-theme="light"]) .t1 { fill: #f0efec; }
  :root:not([data-theme="light"]) .t3, :root:not([data-theme="light"]) .t4 { fill: #0b0b0b; }
}
.legend { font-size: 12px; color: var(--text-secondary); margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; }
.sw { display: inline-flex; align-items: center; gap: 4px; } .sw i { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
.key { display: inline-flex; align-items: center; gap: 6px; } .key svg { width: 14px; height: 14px; display: inline; }
.scroll { overflow-x: auto; }
.heat > svg { min-width: 560px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; margin: 8px 0; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--grid); vertical-align: top; }
td.n { text-align: right; font-variant-numeric: tabular-nums; }
details { margin-top: 8px; } summary { cursor: pointer; color: var(--text-secondary); font-size: 13px; }
code { font: 12px ui-monospace, "Cascadia Mono", Consolas, monospace; }
.flags { font-size: 13px; color: var(--text-secondary); padding-left: 18px; margin: 8px 0 0; }
.empty { color: var(--muted); }
button.theme { background: var(--surface-1); color: var(--text-primary); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; font: inherit; font-size: 13px; cursor: pointer; }
#tip { position: fixed; pointer-events: none; background: var(--surface-1); color: var(--text-primary); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 12px; box-shadow: 0 4px 16px rgba(0,0,0,.15); display: none; max-width: 320px; z-index: 10; }
#tip strong { display: block; font-size: 13px; }
</style>
</head>
<body>
<main>
<header>
  <div><h1>${title}</h1><div class="meta">${meta}</div></div>
  <button class="theme" type="button" id="theme">Theme</button>
</header>
${mdToHtml(banners(ctx))}

<h2>Cost vs quality</h2>
<div class="card">
  <div class="legend">${Object.entries(PROVIDER_SLOT).filter(([p]) => ctx.pairs.some((x) => x.provider === p)).map(([p, s]) => `<span class="key"><svg viewBox="-8 -8 16 16">${marker(s.shape, 0, 0, 5, `var(${s.v})`)}</svg>${p}</span>`).join('')}<span>Labelled points are on the Pareto front (cost, quality and time); the line is the cost–quality frontier.</span></div>
  ${paretoChart(ctx.pairs, ctx.th.minQuality)}
  <details><summary>Table view</summary><div class="scroll">${pairTable(ctx.pairs)}</div></details>
</div>

<h2>Pass/fail by task</h2>
<div class="card scroll heat">
  ${heatmap(ctx.pairs)}
  <details><summary>Table view</summary>${taskTable(ctx.pairs)}</details>
</div>

<h2>Effort scaling per model</h2>
${effortCharts(ctx.pairs)}

<h2>Routing: cheapest acceptable pair per class</h2>
<div class="card scroll">${mdToHtml(routingTable(ctx.routes, ctx.th))}</div>
</main>
<div id="tip" role="tooltip"></div>
<script>
(() => {
  const tip = document.getElementById('tip');
  const show = (el, x, y) => {
    let lines;
    try { lines = JSON.parse(el.getAttribute('data-tip')); } catch { return; }
    tip.replaceChildren();
    lines.forEach((l, i) => { const n = document.createElement(i ? 'div' : 'strong'); n.textContent = l; tip.appendChild(n); });
    tip.style.display = 'block';
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(x + 14, innerWidth - r.width - 8) + 'px';
    tip.style.top = Math.max(8, y - r.height - 12) + 'px';
  };
  const hide = () => { tip.style.display = 'none'; };
  for (const el of document.querySelectorAll('[data-tip]')) {
    el.addEventListener('pointermove', (e) => show(el, e.clientX, e.clientY));
    el.addEventListener('pointerleave', hide);
    el.addEventListener('focus', () => { const b = el.getBoundingClientRect(); show(el, b.right, b.top); });
    el.addEventListener('blur', hide);
  }
  const root = document.documentElement;
  try { const t = localStorage.getItem('bench-theme'); if (t) root.dataset.theme = t; } catch {}
  document.getElementById('theme').addEventListener('click', () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('bench-theme', root.dataset.theme); } catch {}
  });
})();
</script>
</body>
</html>
`;
}
