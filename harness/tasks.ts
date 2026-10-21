// Task definitions and working-copy materialisation.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { repoPath } from './paths.ts';

export type GateName = 'cargo_check' | 'cargo_test' | 'tsc' | 'eslint' | 'vitest';

export interface Task {
  id: string;
  dir: string;
  title: string;
  class: 'C1' | 'C2' | 'C3' | 'C4';
  kind: string;
  editable: string[];
  readonly: string[];
  gates: GateName[];
  hidden: { rust_tests: string[]; vitest_dir: string | null };
  prompt: string;
}

export const TASKS_DIR = repoPath('tasks');
export const SHARED_DIR = join(TASKS_DIR, '_shared');
export const SHARED_NODE_MODULES = join(SHARED_DIR, 'frontend', 'node_modules');
export const SHARED_CARGO_LOCK = join(SHARED_DIR, 'Cargo.lock');
export const WORK_DIR = repoPath('.bench-work');
export const CARGO_TARGET_DIR = join(WORK_DIR, 'target');
const DELETE_LIST = '__delete__.txt';

export function listTasks(): Task[] {
  return readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^[A-Z]-/.test(d.name))
    .map((d) => loadTask(d.name))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function loadTask(dirName: string): Task {
  const dir = join(TASKS_DIR, dirName);
  const raw = parse(readFileSync(join(dir, 'task.yaml'), 'utf8')) as Omit<Task, 'dir' | 'prompt' | 'readonly'> & {
    readonly?: string[];
    hidden: { rust_tests?: string[]; vitest_dir?: string };
  };
  if (!dirName.startsWith(`${raw.id}-`)) throw new Error(`tasks/${dirName}: id ${raw.id} doesn't match directory`);
  return {
    ...raw,
    dir,
    readonly: raw.readonly ?? [],
    hidden: { rust_tests: raw.hidden.rust_tests ?? [], vitest_dir: raw.hidden.vitest_dir ?? null },
    prompt: readFileSync(join(dir, 'prompt.md'), 'utf8'),
  };
}

export function findTask(id: string): Task {
  const t = listTasks().find((x) => x.id === id);
  if (!t) throw new Error(`Unknown task ${id}`);
  return t;
}

// Builds a working copy: shared template, then the task scaffold, then any overlays in order.
export function materialize(task: Task, dest: string, overlays: string[] = []): string {
  removeWorkingCopy(dest);
  mkdirSync(dest, { recursive: true });
  cpSync(join(SHARED_DIR, 'template'), dest, { recursive: true });
  cpSync(join(task.dir, 'scaffold'), dest, { recursive: true });
  for (const o of overlays) {
    cpSync(o, dest, { recursive: true });
    // An overlay can remove files by listing them in __delete__.txt (one relative path per line).
    const list = join(dest, DELETE_LIST);
    if (existsSync(list)) {
      for (const rel of readFileSync(list, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
        rmSync(join(dest, rel), { force: true, recursive: true });
      }
      rmSync(list);
    }
  }
  if (existsSync(SHARED_CARGO_LOCK)) cpSync(SHARED_CARGO_LOCK, join(dest, 'src-tauri', 'Cargo.lock'));
  // Copies keep the source mtime on Windows, which lets cargo reuse stale build output from an
  // earlier working copy at the same path. Stamp everything as new.
  touchTree(dest, new Date());
  // Junction works without admin rights on Windows; plain symlink elsewhere.
  symlinkSync(SHARED_NODE_MODULES, join(dest, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  return dest;
}

export function touchTree(dir: string, when: Date): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) touchTree(p, when);
    else if (e.isFile()) utimesSync(p, when, when);
  }
}

// Unlink node_modules first so a recursive delete can never follow the link into the shared install.
export function removeWorkingCopy(dest: string): void {
  if (!existsSync(dest)) return;
  const nm = join(dest, 'node_modules');
  try {
    unlinkSync(nm);
  } catch {
    // not present
  }
  rmSync(dest, { recursive: true, force: true });
}

// Minimal glob: `**` matches any depth, `*` matches within one segment.
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
    } else if (c === '*') re += '[^/]*';
    else re += /[.+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${re}$`);
}

export function isEditable(task: Task, relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/');
  if (p.split('/').some((seg) => seg === '..' || seg === '') || p.startsWith('/')) return false;
  if (task.readonly.some((g) => globToRegExp(g).test(p))) return false;
  return task.editable.some((g) => globToRegExp(g).test(p));
}
