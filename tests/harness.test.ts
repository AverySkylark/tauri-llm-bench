import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apiKey, availableProviders, createAdapter } from '../adapters/index.ts';
import { canonicalJson, hashMatrix, loadMatrix, type Matrix } from '../harness/matrix.ts';
import { repoPath } from '../harness/paths.ts';
import { costUsd, loadPrices, priceFor } from '../harness/prices.ts';
import { validator } from '../harness/schema.ts';
import { gateEnv } from '../harness/gates.ts';

describe('API keys', () => {
  it('reads only BENCH_* variables, never plain ANTHROPIC_API_KEY', () => {
    const env = { ANTHROPIC_API_KEY: 'claude-code-key', OPENAI_API_KEY: 'x', BENCH_GOOGLE_API_KEY: 'g' };
    expect(apiKey('anthropic', env)).toBeUndefined();
    expect(apiKey('openai', env)).toBeUndefined();
    expect(availableProviders(env)).toEqual(['google']);
    expect(() => createAdapter('anthropic', { dryRun: false, env })).toThrow(/BENCH_ANTHROPIC_API_KEY is not set/);
  });

  it('no source file references a non-BENCH provider key variable', () => {
    for (const dir of ['adapters', 'harness']) {
      for (const f of readdirSync(repoPath(dir)).filter((n) => n.endsWith('.ts'))) {
        const src = readFileSync(repoPath(dir, f), 'utf8');
        expect(src, `${dir}/${f}`).not.toMatch(/['"`](ANTHROPIC|OPENAI|GOOGLE|GEMINI)_API_KEY['"`]/);
        expect(src, `${dir}/${f}`).not.toMatch(/process\.env(\.|\[['"`])(?!BENCH_)\w*API_KEY/);
      }
    }
  });

  it('gates never see keys or tokens', () => {
    const env = gateEnv({
      PATH: '/usr/bin', HOME: '/home/x', CARGO_HOME: '/c',
      BENCH_ANTHROPIC_API_KEY: 'a', BENCH_HIDDEN_KEY: 'h', ANTHROPIC_API_KEY: 'c',
      GITHUB_TOKEN: 't', ACTIONS_RUNTIME_TOKEN: 'r', NPM_TOKEN: 'n', AWS_SECRET_ACCESS_KEY: 's',
    });
    expect(Object.keys(env).sort()).toEqual(
      ['CARGO_HOME', 'CARGO_TARGET_DIR', 'CARGO_TERM_COLOR', 'FORCE_COLOR', 'HOME', 'NO_COLOR', 'PATH', 'RUST_BACKTRACE'],
    );
  });
});

describe('prices', () => {
  const prices = loadPrices('v1');

  it('computes cost from billed tokens', () => {
    const p = priceFor(prices, 'gemini-3.5-flash-lite');
    // 1M input @0.30 + 1M cached @0.03 + 1M output @2.50
    expect(costUsd(p, { input: 1e6, cachedInput: 1e6, output: 1e6, reasoning: 5e5 })).toBeCloseTo(2.83, 8);
  });

  it('switches to the long-context card above the threshold', () => {
    const p = priceFor(prices, 'claude-haiku-5-5');
    expect(costUsd(p, { input: 100_000, cachedInput: 0, output: 1000, reasoning: null })).toBeCloseTo(0.0105, 8);
    expect(costUsd(p, { input: 100_001, cachedInput: 0, output: 1000, reasoning: null })).toBeCloseTo(0.0525005, 8);
  });

  it('rejects models missing from the table', () => {
    expect(() => priceFor(prices, 'gpt-9')).toThrow(/not in price table/);
  });
});

describe('matrix', () => {
  const path = repoPath('matrix', 'matrix.yaml');

  it('hash ignores key order and formatting', () => {
    const { matrix, hash } = loadMatrix(path);
    const reverseKeys = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reverseKeys)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)]))
          : v;
    const shuffled = reverseKeys(matrix) as Matrix;
    expect(hashMatrix(shuffled)).toBe(hash);
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 0 }] })).toBe('{"a":[2,{"c":0,"d":1}],"b":1}');
  });

  function writeVariant(edit: (src: string) => string): string {
    const dir = mkdtempSync(join(tmpdir(), 'bench-matrix-'));
    const file = join(dir, 'm.yaml');
    writeFileSync(file, edit(readFileSync(path, 'utf8')));
    return file;
  }

  it('rejects floating aliases', () => {
    const f = writeVariant((s) => s.replace('model: claude-sonnet-5-5', 'model: claude-sonnet-latest'));
    expect(() => loadMatrix(f)).toThrow(/matrix\.schema\.json/);
  });

  it('rejects models without a price entry', () => {
    const f = writeVariant((s) => s.replace('model: claude-haiku-5-5', 'model: claude-haiku-4-5'));
    expect(() => loadMatrix(f)).toThrow(/not in price table/);
  });

  it('rejects provider mismatches', () => {
    const f = writeVariant((s) => s.replace('provider: anthropic', 'provider: openai'));
    expect(() => loadMatrix(f)).toThrow(/price table says anthropic/);
  });
});

describe('run schema', () => {
  const v = validator('run');
  const runId = '2026-10-21T10-00-00Z_ab12cd';
  const tokens = { input: 10, cached_input: 0, output: 5, reasoning: null };

  const run = {
    record: 'run',
    schema_version: 1,
    run_id: runId,
    started_at: '2026-10-21T10:00:00Z',
    harness_commit: 'abcdef1',
    suite_version: '1.0.0',
    matrix_version: 1,
    matrix_hash: 'a'.repeat(64),
    price_table_version: 'v1',
    mode: 'single',
    dry_run: true,
    host: { os: 'win32', node: 'v24.20.0', rustc: '1.99.1' },
    caps: { timeout_s: 600, max_output_tokens: 16000, usd_ceiling: 1, reps: 3, max_retries: 2 },
  };

  const attempt = {
    record: 'attempt',
    run_id: runId,
    attempt_id: '0123456789abcdef',
    pair: {
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      effort_norm: 'low',
      effort_native: { param: 'output_config.effort', value: 'low' },
      temperature_sent: null,
      max_output_tokens: 16000,
    },
    task: { id: 'A', class: 'C2', rep_index: 0 },
    status: 'capped_usd',
    first_pass_compile: false,
    iterations: [
      {
        n: 0,
        tokens,
        latency_ms: 1200,
        cost_usd: 0.001,
        stop_reason: 'end',
        gates: { cargo_check: { ok: false, ms: 900, exit_code: 101, output_tail: 'error[E0599]' } },
        error_classes: ['E0599'],
      },
    ],
    hidden: null,
    telemetry: { tokens, model_latency_ms: 1200, wall_ms: 5000, cost_usd: 0.001 },
  };

  const summary = { record: 'summary', run_id: runId, finished_at: '2026-10-21T10:05:00Z', attempts: 1, cost_usd: 0.001, aborted: false, abort_reason: null };

  it.each([
    ['run', run],
    ['attempt', attempt],
    ['summary', summary],
  ])('accepts a valid %s line', (_n, rec) => {
    expect(v(rec), JSON.stringify(v.errors)).toBe(true);
  });

  it('rejects unknown fields, bad statuses and malformed ids', () => {
    expect(v({ ...run, extra: 1 })).toBe(false);
    expect(v({ ...attempt, status: 'discarded' })).toBe(false);
    expect(v({ ...summary, run_id: 'latest' })).toBe(false);
  });
});

describe('output cap per effort', () => {
  it('pair cap wins, then the per-effort default, then the global default', async () => {
    const { outputCap } = await import('../harness/matrix.ts');
    const d = { max_output_tokens: 16000, max_output_tokens_by_effort: { high: 32000, max: 32000 } } as Parameters<typeof outputCap>[0];
    expect(outputCap(d, undefined, 'low')).toBe(16000);
    expect(outputCap(d, undefined, 'high')).toBe(32000);
    expect(outputCap(d, 8000, 'high')).toBe(8000);
  });

  it('matrix.yaml gives high effort 32k', () => {
    const { pairs } = loadMatrix(repoPath('matrix', 'matrix.yaml'));
    for (const p of pairs) expect(p.maxOutputTokens).toBe(p.effort === 'high' || p.effort === 'max' ? 32000 : 16000);
  });
});
