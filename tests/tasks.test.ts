import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { errorClasses } from '../harness/gates.ts';
import { decrypt, encrypt } from '../harness/hidden.ts';
import { findTask, globToRegExp, isEditable, listTasks, materialize, removeWorkingCopy, SHARED_NODE_MODULES } from '../harness/tasks.ts';

describe('task definitions', () => {
  it('has tasks A-D with classes and prompts', () => {
    const tasks = listTasks();
    expect(tasks.map((t) => t.id)).toEqual(['A', 'B', 'C', 'D']);
    for (const t of tasks) {
      expect(t.class).toMatch(/^C[1-4]$/);
      expect(t.prompt.length).toBeGreaterThan(500);
      expect(t.gates).toEqual(['cargo_check', 'cargo_test', 'tsc', 'eslint', 'vitest']);
    }
  });

  it('prompts are plain Markdown without provider-specific markup', () => {
    for (const t of listTasks()) {
      expect(t.prompt, t.id).not.toMatch(/^\s*<\/?[a-z_]+>\s*$/im); // no XML-style section tags
      expect(t.prompt, t.id).not.toMatch(/\b(claude|anthropic|gpt|openai|gemini|google)\b/i);
    }
  });
});

describe('editable paths', () => {
  const a = findTask('A');
  const d = findTask('D');

  it('globs match by segment', () => {
    expect(globToRegExp('src/**').test('src/a/b.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false);
  });

  it('allows task paths and rejects everything else', () => {
    expect(isEditable(a, 'src-tauri/src/lib.rs')).toBe(true);
    expect(isEditable(a, 'src/api.ts')).toBe(true);
    expect(isEditable(a, 'src\\SeedVaultPanel.tsx')).toBe(true);
    for (const p of ['src/__tests__/x.test.tsx', 'src-tauri/Cargo.toml', 'src-tauri/tests/visible.rs', 'package.json', 'eslint.config.js', 'src-tauri/build.rs', '../outside.ts', 'src/../package.json', '/etc/passwd']) {
      expect(isEditable(a, p), p).toBe(false);
    }
    expect(isEditable(d, 'src-tauri/capabilities/archive.json')).toBe(true);
    expect(isEditable(d, 'src-tauri/capabilities/default.json')).toBe(false);
  });
});

describe('materialize', () => {
  it('layers template, scaffold and overlays, applies deletions and links node_modules', () => {
    const root = mkdtempSync(join(tmpdir(), 'bench-mat-'));
    const overlay = join(root, 'overlay');
    mkdirSync(join(overlay, 'src'), { recursive: true });
    writeFileSync(join(overlay, 'src', 'extra.ts'), 'export {};\n');
    writeFileSync(join(overlay, '__delete__.txt'), 'src/scanApi.ts\n');
    const dest = join(root, 'wc');
    materialize(findTask('D'), dest, [overlay]);
    expect(existsSync(join(dest, 'src-tauri', 'tests', 'common', 'mod.rs'))).toBe(true); // template
    expect(existsSync(join(dest, 'src-tauri', 'src', 'lib.rs'))).toBe(true); // scaffold
    expect(existsSync(join(dest, 'src', 'extra.ts'))).toBe(true); // overlay
    expect(existsSync(join(dest, 'src', 'scanApi.ts'))).toBe(false); // deleted
    expect(existsSync(join(dest, '__delete__.txt'))).toBe(false);
    expect(existsSync(join(dest, 'node_modules', 'react'))).toBe(true);
    removeWorkingCopy(dest);
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(join(SHARED_NODE_MODULES, 'react'))).toBe(true); // shared install untouched
  });
});

describe('hidden bundle', () => {
  it('round-trips files and rejects a wrong key', () => {
    const root = mkdtempSync(join(tmpdir(), 'bench-hidden-'));
    mkdirSync(join(root, 'plain', 'A', 'tests'), { recursive: true });
    writeFileSync(join(root, 'plain', 'A', 'tests', 'x.rs'), 'fn main() {}\n');
    const key = randomBytes(32);
    const bundle = join(root, 'b.enc');
    expect(encrypt(key, join(root, 'plain'), bundle).files).toBe(1);
    expect(readFileSync(bundle).includes(Buffer.from('fn main'))).toBe(false);
    expect(decrypt(join(root, 'out'), key, bundle)).toBe(1);
    expect(readFileSync(join(root, 'out', 'A', 'tests', 'x.rs'), 'utf8')).toBe('fn main() {}\n');
    expect(() => decrypt(join(root, 'out2'), randomBytes(32), bundle)).toThrow();
  });
});

describe('error classes', () => {
  it('extracts rustc and tsc codes', () => {
    const out = 'error[E0599]: no method\nerror[E0425]: x\nsrc/a.ts(1,2): error TS2339: Property\nerror[E0599]: again';
    expect(errorClasses(out)).toEqual(['E0425', 'E0599', 'TS2339']);
  });
});
