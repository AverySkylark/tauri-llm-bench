import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAdapter, AdapterError, type Adapter, type ChatRequest } from '../adapters/index.ts';
import type { GateResult } from '../harness/gates.ts';
import { loadMatrix, type Pair } from '../harness/matrix.ts';
import { repoPath } from '../harness/paths.ts';
import { priceFor } from '../harness/prices.ts';
import { validator } from '../harness/schema.ts';
import { findTask, type Task } from '../harness/tasks.ts';
import { chatWithRetry, runAttempt, type AttemptDeps } from '../harness/orchestrator/attempt.ts';
import { Budget, worstCaseUsd } from '../harness/orchestrator/budget.ts';
import { buildFeedback, buildTaskMessage, parseReply, renderFileBlock, scrubPaths, SYSTEM_PROMPT } from '../harness/orchestrator/format.ts';
import { buildPlan, makeRunId, pairKey, recordedKeys, runBench } from '../harness/orchestrator/run.ts';
import { scriptedReply } from '../harness/orchestrator/dryreply.ts';
import { applyEdits, hygiene, unifiedDiff } from '../harness/orchestrator/workspace.ts';
import { RunWriter } from '../harness/orchestrator/writer.ts';

const task = (over: Partial<Task> = {}): Task => ({
  id: 'Z',
  dir: '',
  title: 't',
  class: 'C2',
  kind: 'greenfield',
  editable: ['src/**', 'src-tauri/src/**', 'src-tauri/capabilities/archive.json'],
  readonly: ['src/__tests__/**'],
  gates: ['cargo_check', 'tsc'],
  hidden: { rust_tests: [], vitest_dir: null },
  prompt: 'Do the thing.',
  ...over,
});

describe('reply parser', () => {
  it('reads file and delete blocks', () => {
    const r = parseReply(`Sure.\n\n=== FILE: src/a.ts ===\nexport const a = 1;\n=== END FILE ===\n\n=== DELETE: src/old.ts ===\nDone.`);
    expect(r.issues).toEqual([]);
    expect(r.edits).toEqual([
      { kind: 'write', path: 'src/a.ts', content: 'export const a = 1;\n' },
      { kind: 'delete', path: 'src/old.ts' },
    ]);
  });

  it('round-trips the block it renders, including CRLF input', () => {
    const content = 'line 1\n\n  indented\n';
    expect(parseReply(renderFileBlock('src/x.ts', content)).edits[0]).toEqual({ kind: 'write', path: 'src/x.ts', content });
    expect(parseReply('=== FILE: src/x.ts ===\r\na\r\n=== END FILE ===\r\n').edits[0]).toMatchObject({ content: 'a\n' });
  });

  it('strips a Markdown fence wrapped around the whole body only', () => {
    const fenced = parseReply('=== FILE: src/a.rs ===\n```rust\nfn main() {}\n```\n=== END FILE ===');
    expect(fenced.edits[0]).toMatchObject({ content: 'fn main() {}\n' });
    const inner = parseReply('=== FILE: README.md ===\ntext\n```ts\nx\n```\nmore\n=== END FILE ===');
    expect(inner.edits[0]).toMatchObject({ content: 'text\n```ts\nx\n```\nmore\n' });
  });

  it('normalises paths: backticks, ./ and backslashes', () => {
    const r = parseReply('=== FILE: `.\\src\\b.ts` ===\nx\n=== END FILE ===');
    expect(r.edits[0]).toMatchObject({ path: 'src/b.ts' });
  });

  it('drops unterminated blocks and says so', () => {
    const r = parseReply('=== FILE: src/a.ts ===\nconst a = 1;\n=== FILE: src/b.ts ===\nconst b = 2;\n=== END FILE ===\n=== FILE: src/c.ts ===\ncut off');
    expect(r.edits.map((e) => e.path)).toEqual(['src/b.ts']);
    expect(r.issues).toHaveLength(2);
    expect(r.issues[0]).toMatch(/src\/a\.ts has no "=== END FILE ===" line/);
  });

  it('keeps the last of duplicate blocks and reports no blocks', () => {
    const r = parseReply('=== FILE: src/a.ts ===\n1\n=== END FILE ===\n=== FILE: src/a.ts ===\n2\n=== END FILE ===');
    expect(r.edits).toEqual([{ kind: 'write', path: 'src/a.ts', content: '2\n' }]);
    expect(r.issues[0]).toMatch(/more than once/);
    expect(parseReply('No changes needed.').issues).toEqual(['No file blocks were found in your reply.']);
  });
});

describe('applying edits', () => {
  it('enforces the editable whitelist, including deletes and traversal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-apply-'));
    mkdirSync(join(dir, 'src', '__tests__'), { recursive: true });
    writeFileSync(join(dir, 'src', 'old.ts'), 'x');
    writeFileSync(join(dir, 'src', '__tests__', 't.test.ts'), 'x');
    const r = applyEdits(task(), dir, [
      { kind: 'write', path: 'src/new.ts', content: 'new\n' },
      { kind: 'write', path: 'src/__tests__/t.test.ts', content: 'cheat\n' },
      { kind: 'write', path: 'package.json', content: '{}' },
      { kind: 'write', path: 'src/../package.json', content: '{}' },
      { kind: 'write', path: 'src-tauri/capabilities/evil.json', content: '{}' },
      { kind: 'delete', path: 'src/old.ts' },
      { kind: 'delete', path: 'src/__tests__/t.test.ts' },
      { kind: 'delete', path: 'src/missing.ts' },
    ]);
    expect(r.changed).toEqual(['src/new.ts', 'src/old.ts']);
    expect(r.rejected).toEqual(['src/__tests__/t.test.ts', 'package.json', 'src/../package.json', 'src-tauri/capabilities/evil.json', 'src/__tests__/t.test.ts']);
    expect(r.issues).toEqual(['Cannot delete src/missing.ts: it does not exist.']);
    expect(existsSync(join(dir, 'src', 'old.ts'))).toBe(false);
    expect(readFileSync(join(dir, 'src', '__tests__', 't.test.ts'), 'utf8')).toBe('x');
    expect(existsSync(join(dir, 'package.json'))).toBe(false);
  });

  it('does not count an identical rewrite as a change', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-apply-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.ts'), 'same\n');
    expect(applyEdits(task(), dir, [{ kind: 'write', path: 'src/a.ts', content: 'same\n' }]).changed).toEqual([]);
  });
});

describe('prompt', () => {
  it('lists editable paths, marks read-only files, and stays provider-neutral', () => {
    const msg = buildTaskMessage(task(), [
      { path: 'src/App.tsx', content: 'app', editable: true },
      { path: 'package.json', content: '{}', editable: false },
    ]);
    expect(msg).toContain('- `src/**`');
    expect(msg).toContain('- package.json (read-only)');
    expect(msg).toContain('=== FILE: src/App.tsx ===\napp\n=== END FILE ===');
    for (const text of [msg, SYSTEM_PROMPT]) expect(text).not.toMatch(/claude|anthropic|openai|gpt|gemini|google|<\/?[a-z_]+>/i);
  });

  it('never shows hidden tests or references to the model', () => {
    const t = findTask('D');
    const msg = buildTaskMessage(t, [{ path: 'src/scanApi.ts', content: '', editable: true }]);
    expect(msg).not.toMatch(/__hidden__|hidden\.rs|reference/i);
  });

  it('feedback shows only failing gates, scrubs the working-copy path and bounds length', () => {
    const work = 'C:\\dev\\x\\.bench-work\\attempt-1';
    const g = (ok: boolean, out: string): GateResult => ({ ok, ms: 1, exit_code: ok ? 0 : 1, output_tail: out });
    const fb = buildFeedback({
      gates: { cargo_check: g(false, `error[E0425] at ${work}\\src-tauri\\src\\lib.rs\n${'x'.repeat(50_000)}`), tsc: g(true, 'fine') },
      parseIssues: ['No file blocks were found in your reply.'],
      rejectedPaths: ['package.json'],
      workDir: work,
      retriesLeft: 2,
    });
    expect(fb).toContain('## cargo_check failed (exit code 1)');
    expect(fb).not.toContain('## tsc failed');
    expect(fb).toContain('Passed: tsc.');
    expect(fb).toContain('- package.json');
    expect(fb).toContain('Attempts left after this one: 1');
    expect(fb.length).toBeLessThan(8000);
    expect(scrubPaths(`at ${work}\\a and C:/dev/x/.bench-work/attempt-1/b`, work)).toBe('at .\\a and ./b');
  });
});

describe('workspace measurements', () => {
  it('diffs changed, added and deleted files', () => {
    const d = unifiedDiff(new Map([['src/a.ts', 'one\n'], ['src/gone.ts', 'bye\n'], ['same.ts', 's\n']]), new Map([['src/a.ts', 'two\n'], ['src/new.ts', 'hi\n'], ['same.ts', 's\n']]));
    expect(d).toContain('diff --git a/src/a.ts b/src/a.ts');
    expect(d).toContain('-one\n+two');
    expect(d).toMatch(/\+\+\+ b\/src\/new\.ts/);
    expect(d).toMatch(/--- a\/src\/gone\.ts/);
    expect(d).not.toContain('same.ts');
    expect(unifiedDiff(new Map([['a', 'x']]), new Map([['a', 'x']]))).toBe('');
  });

  it('counts new unsafe, unwraps and hallucination-class errors', () => {
    const base = new Map([['src-tauri/src/lib.rs', 'x.unwrap();']]);
    const final = new Map([['src-tauri/src/lib.rs', 'unsafe { x.unwrap(); y.expect("e"); }'], ['src/a.ts', 'unsafe']]);
    expect(hygiene(base, final, ['error[E0425]: cannot find value', 'error[E0308]: mismatched', 'src/a.ts(1,1): error TS2339: x'])).toEqual({
      unsafe_added: 1,
      unwraps_in_ipc: 1,
      hallucination_errors: 2,
    });
  });
});

describe('budget', () => {
  it('blocks a request whose worst case would cross the ceiling', () => {
    const price = priceFor(loadMatrix(repoPath('matrix', 'matrix.yaml')).prices, 'claude-haiku-5-5');
    const worst = worstCaseUsd(price, 30_000, 16_000);
    expect(worst).toBeGreaterThan(0);
    const b = new Budget(worst * 2);
    expect(b.allows(worst)).toBe(true);
    b.add(worst);
    expect(b.allows(worst)).toBe(true);
    b.add(0.000001);
    expect(b.allows(worst)).toBe(false);
  });
});

describe('transient API errors', () => {
  const req = {} as ChatRequest;
  it('retries 429/5xx/network but not timeouts or 4xx', async () => {
    const slept: number[] = [];
    let calls = 0;
    const flaky: Adapter = {
      provider: 'anthropic',
      chat: async () => {
        calls++;
        if (calls < 3) throw new AdapterError('http', 'HTTP 529', 529);
        return { text: 'ok' } as never;
      },
    };
    await expect(chatWithRetry(flaky, req, async (ms) => void slept.push(ms), () => {})).resolves.toMatchObject({ text: 'ok' });
    expect(slept).toEqual([2000, 10000]);

    for (const e of [new AdapterError('timeout', 't'), new AdapterError('http', 'HTTP 400', 400)]) {
      let n = 0;
      const a: Adapter = { provider: 'openai', chat: async () => (n++, Promise.reject(e)) };
      await expect(chatWithRetry(a, req, async () => {}, () => {})).rejects.toBe(e);
      expect(n).toBe(1);
    }
  });
});

// Fake gates: pass once the working copy contains the marker file the script writes.
function fakeDeps(passWhen: (dir: string) => boolean): AttemptDeps & { gateRuns: number } {
  const deps = {
    gateRuns: 0,
    runGates: async (_t: Task, dir: string) => {
      deps.gateRuns++;
      const ok = passWhen(dir);
      return {
        cargo_check: { ok, ms: 5, exit_code: ok ? 0 : 101, output_tail: ok ? '' : 'error[E0425]: cannot find value `x`' },
        tsc: { ok: true, ms: 5, exit_code: 0, output_tail: '' },
      };
    },
    scoreHidden: async () => ({ passed: 3, total: 4, rust: { passed: 3, failed: 1, compiled: true }, vitest: { passed: 0, failed: 0, ran: false }, log_tail: '' }),
    sleep: async () => {},
  };
  return deps;
}

describe('attempt loop (fake model, fake gates)', () => {
  const loaded = loadMatrix(repoPath('matrix', 'matrix.yaml'));
  const pair = loaded.pairs.find((p) => p.model === 'claude-haiku-5-5' && p.effort === 'low')!;
  const t = findTask('A');
  const fix = '=== FILE: src/fixed.ts ===\nexport const fixed = true;\n=== END FILE ===';
  const base = (reply: () => string, extra: Partial<Parameters<typeof runAttempt>[0]> = {}) => ({
    runId: makeRunId(new Date('2026-10-21T10:00:00Z')),
    pair,
    task: t,
    rep: 0,
    adapter: createAdapter('anthropic', { dryRun: true, fake: { reply } }),
    price: priceFor(loaded.prices, pair.model),
    budget: new Budget(1),
    timeoutS: 600,
    maxRetries: 2,
    gateTimeoutMs: 1000,
    workRoot: mkdtempSync(join(tmpdir(), 'bench-work-')),
    keepWork: false,
    log: () => {},
    ...extra,
  });
  const passes = (dir: string) => existsSync(join(dir, 'src', 'fixed.ts'));
  const validRecord = (r: object) => {
    const v = validator('run');
    expect(v(r), JSON.stringify(v.errors)).toBe(true);
  };

  it('fails, gets feedback, fixes on retry, then scores hidden tests', async () => {
    const deps = fakeDeps(passes);
    const prompts: string[] = [];
    const replies = scriptedReply(['No changes needed.', fix]);
    const { record, abort } = await runAttempt(
      base((/* body */) => replies(), {
        deps,
        adapter: createAdapter('anthropic', {
          dryRun: true,
          fake: {
            reply: (body) => {
              prompts.push(JSON.stringify(body));
              return replies();
            },
          },
        }),
      }),
    );
    validRecord(record);
    expect(abort).toBeNull();
    expect(record.status).toBe('pass');
    expect(record.iterations).toHaveLength(2);
    expect(record.first_pass_compile).toBe(false);
    expect(record.iterations[0]!.error_classes).toEqual(['E0425']);
    expect(record.iterations[1]!.files_changed).toEqual(['src/fixed.ts']);
    expect(record.hidden).toEqual({ passed: 3, total: 4 });
    expect(record.hygiene?.hallucination_errors).toBe(1);
    expect(record.diff).toContain('+export const fixed = true;');
    expect(record.pair.effort_native).toEqual({ param: 'thinking.type+output_config.effort', value: 'adaptive/low' });
    expect(record.telemetry.cost_usd).toBeCloseTo(record.iterations[0]!.cost_usd + record.iterations[1]!.cost_usd, 8);
    // Second request carries the gate errors back.
    expect(prompts[1]).toContain('cargo_check failed');
    expect(prompts[1]).toContain('No file blocks were found');
  });

  it('records a failure after R retries and stops sending', async () => {
    const deps = fakeDeps(() => false);
    const { record } = await runAttempt(base(() => 'nothing', { deps }));
    validRecord(record);
    expect(record.status).toBe('fail');
    expect(record.iterations).toHaveLength(3);
    expect(deps.gateRuns).toBe(3);
  });

  it('a reply cut off at max tokens is a capped failure, not applied', async () => {
    const deps = fakeDeps(passes);
    const adapter: Adapter = {
      provider: 'anthropic',
      chat: async () => ({
        text: fix,
        stopReason: 'max_tokens',
        stopReasonNative: 'max_tokens',
        usage: { input: 10, cachedInput: 0, output: 16000, reasoning: null },
        latencyMs: 5,
        effortNative: { param: 'p', value: 'v' },
        temperatureSent: null,
        native: null,
      }),
    };
    const { record } = await runAttempt(base(() => '', { deps, adapter }));
    validRecord(record);
    expect(record.status).toBe('capped_tokens');
    expect(deps.gateRuns).toBe(0);
    expect(record.hidden).toBeNull();
    expect(record.first_pass_compile).toBeNull();
  });

  it('timeouts and API errors are recorded with their status', async () => {
    const mk = (e: Error): Adapter => ({ provider: 'anthropic', chat: async () => Promise.reject(e) });
    const t1 = await runAttempt(base(() => '', { deps: fakeDeps(passes), adapter: mk(new AdapterError('timeout', 'timed out')) }));
    expect(t1.record.status).toBe('capped_timeout');
    const t2 = await runAttempt(base(() => '', { deps: fakeDeps(passes), adapter: mk(new AdapterError('http', 'HTTP 400: bad', 400)) }));
    expect(t2.record.status).toBe('api_error');
    expect(t2.record.error).toContain('HTTP 400');
    validRecord(t1.record);
    validRecord(t2.record);
  });

  it('the dollar ceiling stops before a request that could cross it', async () => {
    const deps = fakeDeps(() => false);
    const { record, abort } = await runAttempt(base(() => 'nothing', { deps, budget: new Budget(0.0001) }));
    validRecord(record);
    expect(record.status).toBe('capped_usd');
    expect(record.iterations).toHaveLength(0);
    expect(abort).toMatch(/Dollar ceiling/);
  });

  it('unsupported effort sends nothing', async () => {
    const unsupported: Pair = { ...pair, provider: 'google', model: 'gemini-3.5-flash-lite', effort: 'none', supported: false };
    let called = false;
    const adapter: Adapter = { provider: 'google', chat: async () => ((called = true), Promise.reject(new Error('no'))) };
    const { record } = await runAttempt(base(() => '', { pair: unsupported, adapter, deps: fakeDeps(passes) }));
    validRecord(record);
    expect(record.status).toBe('unsupported');
    expect(record.pair.effort_native).toBeNull();
    expect(called).toBe(false);
  });
});

describe('run planning and storage', () => {
  const loaded = loadMatrix(repoPath('matrix', 'matrix.yaml'));

  it('run ids match the schema pattern', () => {
    expect(makeRunId(new Date('2026-10-21T10:00:00.123Z'))).toMatch(/^2026-10-21T10-00-00Z_[0-9a-f]{6}$/);
  });

  it('plans reps outermost', () => {
    const tasks = [findTask('A'), findTask('B')];
    const plan = buildPlan(loaded.pairs.slice(0, 2), tasks, 2);
    expect(plan).toHaveLength(8);
    expect(plan.slice(0, 4).every((i) => i.rep === 0)).toBe(true);
  });

  it('writer validates every line and refuses to reuse a file', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'bench-w-')), 'x.ndjson');
    const w = new RunWriter(f);
    expect(() => w.write({ record: 'summary', run_id: 'bad' })).toThrow(/fails run\.schema\.json/);
    expect(existsSync(f)).toBe(false);
    expect(() => new RunWriter(join(repoPath('package.json')))).toThrow(/already exists/);
  });

  it('end to end with fake gates; --only-new then skips what is recorded', async () => {
    const out = mkdtempSync(join(tmpdir(), 'bench-runs-'));
    const pairs = loaded.pairs.filter((p) => p.model === 'claude-haiku-5-5');
    const tasks = [findTask('A'), findTask('C')];
    const opts = {
      mode: 'matrix' as const,
      loaded,
      pairs,
      tasks,
      reps: 1,
      maxRetries: 2,
      timeoutS: 600,
      usdCeiling: 1,
      dryRun: true,
      dryScript: 'reference' as const,
      outDir: out,
      keepWork: false,
      log: () => {},
      deps: fakeDeps(() => true),
      gateTimeoutMs: 1000,
    };
    const r1 = await runBench(opts);
    expect(r1.attempts).toBe(4);
    expect(r1.statuses).toEqual({ pass: 4 });
    const lines = readFileSync(r1.file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { record: string });
    expect(lines.map((l) => l.record)).toEqual(['run', 'attempt', 'attempt', 'attempt', 'attempt', 'summary']);
    const v = validator('run');
    for (const l of lines) expect(v(l), JSON.stringify(v.errors)).toBe(true);

    const done = recordedKeys(out, loaded.matrix.suite_version, true);
    expect(done.has(pairKey(pairs[0]!, 'A', 0))).toBe(true);
    // A different output cap is a different configuration: not done yet.
    expect(done.has(pairKey({ ...pairs[0]!, maxOutputTokens: pairs[0]!.maxOutputTokens + 1 }, 'A', 0))).toBe(false);
    expect(recordedKeys(out, loaded.matrix.suite_version, false).size).toBe(0);

    const r2 = await runBench({ ...opts, mode: 'only_new', reps: 2 });
    expect(r2.attempts).toBe(4);
    const reps = readFileSync(r2.file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { task?: { rep_index: number } });
    expect(reps.filter((l) => l.task).every((l) => l.task!.rep_index === 1)).toBe(true);
  }, 60_000);

  it('a ceiling hit before an attempt starts writes no attempt and marks the run aborted', async () => {
    const out = mkdtempSync(join(tmpdir(), 'bench-runs-'));
    const r = await runBench({
      mode: 'single',
      loaded,
      pairs: loaded.pairs.slice(0, 1),
      tasks: [findTask('A')],
      reps: 1,
      maxRetries: 2,
      timeoutS: 600,
      usdCeiling: 0.00001,
      dryRun: true,
      dryScript: 'reference',
      outDir: out,
      keepWork: false,
      log: () => {},
      deps: fakeDeps(() => true),
    });
    expect(r.attempts).toBe(0);
    expect(r.aborted).toBe(true);
    const lines = readFileSync(r.file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { record: string; aborted?: boolean });
    expect(lines.map((l) => l.record)).toEqual(['run', 'summary']);
    expect(lines[1]!.aborted).toBe(true);
  });
});
