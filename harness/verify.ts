// `bench tasks prepare|verify`: build the shared caches, then prove every task is well-formed:
// the scaffold fails the visible gates, the reference passes them, and the reference passes
// every hidden test while the scaffold does not.

import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { run, runGates, scoreHidden, type GateResult } from './gates.ts';
import { hiddenDir } from './hidden.ts';
import { CARGO_TARGET_DIR, SHARED_CARGO_LOCK, WORK_DIR, listTasks, materialize, removeWorkingCopy, type Task } from './tasks.ts';

const TIMEOUT = 15 * 60 * 1000;

export interface HiddenManifest {
  rust: number;
  vitest: number;
}

export function readManifest(taskId: string): HiddenManifest | undefined {
  const f = join(hiddenDir(), taskId, 'manifest.json');
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as HiddenManifest) : undefined;
}

// Generates the shared Cargo.lock (network) and fills the cargo cache so gates can run offline.
export async function prepare(log: (s: string) => void): Promise<void> {
  const tasks = listTasks();
  const first = tasks[0];
  if (!first) throw new Error('No tasks found');
  const dir = join(WORK_DIR, 'prepare');
  materialize(first, dir);
  if (!existsSync(SHARED_CARGO_LOCK)) {
    log('Generating shared Cargo.lock …');
    const r = await run(['cargo', 'generate-lockfile', '--manifest-path', join('src-tauri', 'Cargo.toml')], dir, TIMEOUT);
    if (!r.ok) throw new Error(`cargo generate-lockfile failed:\n${r.output_tail}`);
    copyFileSync(join(dir, 'src-tauri', 'Cargo.lock'), SHARED_CARGO_LOCK);
  }
  log('Fetching crates …');
  const f = await run(['cargo', 'fetch', '--locked', '--manifest-path', join('src-tauri', 'Cargo.toml')], dir, TIMEOUT);
  if (!f.ok) throw new Error(`cargo fetch failed:\n${f.output_tail}`);
  log(`Warming ${CARGO_TARGET_DIR} …`);
  const reference = join(hiddenDir(), first.id, 'reference');
  materialize(first, dir, existsSync(reference) ? [reference] : []);
  const b = await run(['cargo', 'test', '--no-run', '--offline', '--locked', '--manifest-path', join('src-tauri', 'Cargo.toml')], dir, TIMEOUT);
  if (!b.ok) log(`warning: warm build failed (fine if the scaffold doesn't compile):\n${b.output_tail.slice(-1500)}`);
  removeWorkingCopy(dir);
}

export interface TaskVerification {
  task: string;
  scaffoldGates: Record<string, GateResult>;
  scaffoldHidden: { passed: number; total: number };
  referenceGates: Record<string, GateResult>;
  referenceHidden: { passed: number; total: number; rust: number; vitest: number };
  ok: boolean;
  problems: string[];
}

export async function verifyTask(task: Task, log: (s: string) => void): Promise<TaskVerification> {
  const hidden = join(hiddenDir(), task.id);
  const tests = join(hidden, 'tests');
  const reference = join(hidden, 'reference');
  if (!existsSync(tests) || !existsSync(reference)) throw new Error(`Missing hidden tests or reference for ${task.id} in ${hidden}`);
  const dir = join(WORK_DIR, `verify-${task.id}`);
  const problems: string[] = [];

  log(`[${task.id}] scaffold: visible gates`);
  materialize(task, dir);
  const scaffoldGates = await runGates(task, dir, TIMEOUT);
  if (Object.values(scaffoldGates).every((g) => g.ok)) problems.push('scaffold passes every visible gate');

  log(`[${task.id}] reference: visible gates`);
  materialize(task, dir, [reference]);
  const referenceGates = await runGates(task, dir, TIMEOUT);
  for (const [name, g] of Object.entries(referenceGates)) {
    if (!g.ok) problems.push(`reference fails ${name}:\n${g.output_tail.slice(-3000)}`);
  }

  log(`[${task.id}] reference: hidden tests`);
  materialize(task, dir, [reference, tests]);
  const ref = await scoreHidden(task, dir, TIMEOUT);
  if (ref.passed !== ref.total || ref.total === 0) problems.push(`reference passes ${ref.passed}/${ref.total} hidden tests:\n${ref.log_tail.slice(-3000)}`);
  const manifest: HiddenManifest = { rust: ref.rust.passed + ref.rust.failed, vitest: ref.vitest.passed + ref.vitest.failed };
  writeFileSync(join(hidden, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  log(`[${task.id}] scaffold: hidden tests`);
  materialize(task, dir, [tests]);
  const sc = await scoreHidden(task, dir, TIMEOUT, manifest);
  if (sc.passed >= sc.total) problems.push('scaffold passes every hidden test');

  removeWorkingCopy(dir);
  return {
    task: task.id,
    scaffoldGates,
    scaffoldHidden: { passed: sc.passed, total: sc.total },
    referenceGates,
    referenceHidden: { passed: ref.passed, total: ref.total, ...manifest },
    ok: problems.length === 0,
    problems,
  };
}
