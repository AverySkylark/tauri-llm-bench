// Points every test at a fake hidden-test dir, so unit tests run without the real hidden tests or
// their key (CI, fork PRs). Gates and hidden scoring are faked in the tests that reach this far.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listTasks } from '../harness/tasks.ts';

const root = mkdtempSync(join(tmpdir(), 'bench-hidden-fixture-'));
for (const t of listTasks()) {
  mkdirSync(join(root, t.id, 'tests', 'src-tauri', 'tests'), { recursive: true });
  writeFileSync(join(root, t.id, 'tests', 'src-tauri', 'tests', 'hidden.rs'), '#[test]\nfn fixture() {}\n');
  mkdirSync(join(root, t.id, 'reference'), { recursive: true });
  writeFileSync(join(root, t.id, 'manifest.json'), JSON.stringify({ rust: 1, vitest: 0 }));
}
process.env.BENCH_HIDDEN_DIR = root;
