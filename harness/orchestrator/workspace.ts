// Reading a working copy for the prompt, applying the model's edits under the whitelist,
// and measuring what changed (diff, hygiene counts).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { isEditable, type Task } from '../tasks.ts';
import type { Edit, ProjectFile } from './format.ts';

// Generated or shared files the model never needs to see.
const SKIP_DIRS = new Set(['node_modules', 'target', '.git']);
const SKIP_FILES = new Set(['Cargo.lock', '.hidden-vitest.json']);
const MAX_FILE_BYTES = 256 * 1024;

export type Snapshot = Map<string, string>;

export function snapshot(dir: string): Snapshot {
  const out: Snapshot = new Map();
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p);
      } else if (e.isFile() && !SKIP_FILES.has(e.name) && statSync(p).size <= MAX_FILE_BYTES) {
        out.set(relative(dir, p).replace(/\\/g, '/'), readFileSync(p, 'utf8'));
      }
    }
  };
  walk(dir);
  return out;
}

export function projectFiles(task: Task, snap: Snapshot): ProjectFile[] {
  return [...snap].map(([path, content]) => ({ path, content, editable: isEditable(task, path) }));
}

export interface ApplyResult {
  changed: string[];
  rejected: string[];
  issues: string[];
}

export function applyEdits(task: Task, dir: string, edits: Edit[]): ApplyResult {
  const changed: string[] = [];
  const rejected: string[] = [];
  const issues: string[] = [];
  for (const e of edits) {
    if (!isEditable(task, e.path)) {
      rejected.push(e.path);
      continue;
    }
    const target = join(dir, e.path);
    if (e.kind === 'delete') {
      if (!existsSync(target)) {
        issues.push(`Cannot delete ${e.path}: it does not exist.`);
        continue;
      }
      rmSync(target, { recursive: true, force: true });
      changed.push(e.path);
    } else {
      mkdirSync(dirname(target), { recursive: true });
      const before = existsSync(target) ? readFileSync(target, 'utf8') : null;
      if (before === e.content) continue;
      writeFileSync(target, e.content);
      changed.push(e.path);
    }
  }
  return { changed, rejected, issues };
}

// Unified diff of every file that differs between two snapshots, via `git diff --no-index`.
export function unifiedDiff(base: Snapshot, final: Snapshot, maxChars = 200_000): string {
  const paths = [...new Set([...base.keys(), ...final.keys()])].filter((p) => base.get(p) !== final.get(p)).sort();
  if (paths.length === 0) return '';
  const tmp = mkdtempSync(join(tmpdir(), 'bench-diff-'));
  try {
    for (const [side, snap] of [['a', base], ['b', final]] as const) {
      mkdirSync(join(tmp, side));
      for (const p of paths) {
        const c = snap.get(p);
        if (c === undefined) continue;
        mkdirSync(dirname(join(tmp, side, p)), { recursive: true });
        writeFileSync(join(tmp, side, p), c);
      }
    }
    const r = spawnSync('git', ['diff', '--no-index', '--no-color', '--no-prefix', '--', 'a', 'b'], {
      cwd: tmp,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    // The side directories are named a and b, so with --no-prefix the headers read a/<path> b/<path>.
    const text = r.stdout ?? '';
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n… diff truncated at ${maxChars} characters\n` : text;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export interface Hygiene {
  unsafe_added: number;
  unwraps_in_ipc: number;
  hallucination_errors: number;
}

const count = (text: string, re: RegExp) => text.match(re)?.length ?? 0;

function sumOver(snap: Snapshot, prefix: string, re: RegExp): number {
  let n = 0;
  for (const [p, c] of snap) if (p.startsWith(prefix) && p.endsWith('.rs')) n += count(c, re);
  return n;
}

// Compiler errors that mean "this name/API does not exist": unresolved names and imports,
// missing methods/fields, missing modules or exports.
export const HALLUCINATION_CODES = new Set(['E0405', 'E0412', 'E0422', 'E0425', 'E0432', 'E0433', 'E0560', 'E0599', 'E0609', 'TS2305', 'TS2307', 'TS2339', 'TS2551', 'TS2724']);

export function hygiene(base: Snapshot, final: Snapshot, gateOutputs: string[]): Hygiene {
  const unsafeRe = /\bunsafe\b/g;
  const unwrapRe = /\.(unwrap|expect)\(/g;
  let hallucinations = 0;
  for (const out of gateOutputs) {
    for (const m of out.matchAll(/error\[(E\d{4})\]|error (TS\d{4,5})/g)) if (HALLUCINATION_CODES.has((m[1] ?? m[2])!)) hallucinations++;
  }
  // unwraps_in_ipc: new .unwrap()/.expect( in backend source, where the IPC commands live.
  return {
    unsafe_added: Math.max(0, sumOver(final, 'src-tauri/src/', unsafeRe) - sumOver(base, 'src-tauri/src/', unsafeRe)),
    unwraps_in_ipc: Math.max(0, sumOver(final, 'src-tauri/src/', unwrapRe) - sumOver(base, 'src-tauri/src/', unwrapRe)),
    hallucination_errors: hallucinations,
  };
}
