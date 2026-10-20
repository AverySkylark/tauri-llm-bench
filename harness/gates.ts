// Runs the automated gates in a working copy and scores hidden tests.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CARGO_TARGET_DIR, SHARED_NODE_MODULES, type GateName, type Task } from './tasks.ts';

export interface GateResult {
  ok: boolean;
  ms: number;
  exit_code: number | null;
  output_tail: string;
  timed_out?: boolean;
}

const TAIL = 8000;
const MANIFEST = ['--manifest-path', join('src-tauri', 'Cargo.toml')];
const CARGO_FLAGS = ['--offline', '--locked'];

function nodeBin(rel: string): string[] {
  return [process.execPath, join(SHARED_NODE_MODULES, rel)];
}

export const GATE_COMMANDS: Record<GateName, string[]> = {
  cargo_check: ['cargo', 'check', ...MANIFEST, '--all-targets', ...CARGO_FLAGS],
  cargo_test: ['cargo', 'test', ...MANIFEST, ...CARGO_FLAGS],
  tsc: [...nodeBin('typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.json'],
  eslint: [...nodeBin('eslint/bin/eslint.js'), '.', '--max-warnings', '0'],
  vitest: [...nodeBin('vitest/vitest.mjs'), 'run'],
};

export function gateEnv(): NodeJS.ProcessEnv {
  return { ...process.env, CARGO_TARGET_DIR, CARGO_TERM_COLOR: 'never', NO_COLOR: '1', FORCE_COLOR: '0', RUST_BACKTRACE: '0' };
}

export function run(cmd: string[], cwd: string, timeoutMs: number): Promise<GateResult & { output: string }> {
  const started = performance.now();
  return new Promise((resolve) => {
    const [bin, ...args] = cmd as [string, ...string[]];
    const child = spawn(bin, args, { cwd, env: gateEnv(), windowsHide: true });
    let output = '';
    const collect = (b: Buffer) => {
      output += b.toString('utf8');
      if (output.length > 4 * 1024 * 1024) output = output.slice(-2 * 1024 * 1024);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);
    const finish = (code: number | null) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        ms: Math.round(performance.now() - started),
        exit_code: code,
        output_tail: output.slice(-TAIL),
        output,
        ...(timedOut ? { timed_out: true } : {}),
      });
    };
    child.on('error', (e) => {
      output += `\nspawn failed: ${e.message}`;
      finish(null);
    });
    child.on('close', finish);
  });
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
  else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

export async function runGates(task: Task, cwd: string, timeoutMs: number): Promise<Record<string, GateResult>> {
  const out: Record<string, GateResult> = {};
  for (const g of task.gates) {
    const { output: _full, ...r } = await run(GATE_COMMANDS[g], cwd, timeoutMs);
    out[g] = r;
  }
  return out;
}

// Compiler error codes, used for first-pass compile and hallucination metrics.
export function errorClasses(text: string): string[] {
  const codes = new Set<string>();
  for (const m of text.matchAll(/error\[(E\d{4})\]/g)) codes.add(m[1]!);
  for (const m of text.matchAll(/error (TS\d{4,5})/g)) codes.add(m[1]!);
  return [...codes].sort();
}

export interface HiddenScore {
  passed: number;
  total: number;
  rust: { passed: number; failed: number; compiled: boolean };
  vitest: { passed: number; failed: number; ran: boolean };
  log_tail: string;
}

// Runs hidden tests (already overlaid into cwd). Totals come from the task manifest so that a
// compile failure scores 0 of N instead of 0 of 0.
export async function scoreHidden(
  task: Task,
  cwd: string,
  timeoutMs: number,
  expected?: { rust: number; vitest: number },
): Promise<HiddenScore> {
  let log = '';
  const rust = { passed: 0, failed: 0, compiled: true };
  for (const name of task.hidden.rust_tests) {
    const r = await run(['cargo', 'test', ...MANIFEST, ...CARGO_FLAGS, '--test', name, '--', '--test-threads=4'], cwd, timeoutMs);
    log += r.output_tail;
    const results = [...r.output.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed/g)];
    if (results.length === 0) rust.compiled = false;
    for (const m of results) {
      rust.passed += Number(m[1]);
      rust.failed += Number(m[2]);
    }
    if (r.timed_out) rust.compiled = rust.compiled && results.length > 0;
  }

  const vitest = { passed: 0, failed: 0, ran: false };
  if (task.hidden.vitest_dir) {
    const report = join(cwd, '.hidden-vitest.json');
    rmSync(report, { force: true });
    const r = await run([...GATE_COMMANDS.vitest, task.hidden.vitest_dir, '--reporter=json', `--outputFile=${report}`], cwd, timeoutMs);
    log += r.output_tail;
    if (existsSync(report)) {
      const j = JSON.parse(readFileSync(report, 'utf8')) as { numPassedTests: number; numFailedTests: number; numTotalTests: number };
      vitest.ran = true;
      vitest.passed = j.numPassedTests;
      vitest.failed = j.numTotalTests - j.numPassedTests;
    }
  }

  const total = expected ? expected.rust + expected.vitest : rust.passed + rust.failed + vitest.passed + vitest.failed;
  return { passed: Math.min(rust.passed + vitest.passed, total), total, rust, vitest, log_tail: log.slice(-TAIL) };
}
