// Scripted model replies for dry runs, so the whole loop (parse, apply, gates, retry, hidden
// scoring) runs for real without any API call.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { hiddenDir } from '../hidden.ts';
import type { Task } from '../tasks.ts';
import { renderFileBlock } from './format.ts';

export const DRY_SCRIPTS = ['reference', 'empty', 'fix-on-retry'] as const;
export type DryScript = (typeof DRY_SCRIPTS)[number];

const EMPTY = 'I have reviewed the project and need no changes.';

// reference: replay the reference solution (should pass first time).
// empty: reply with no file blocks every time (fails after R retries).
// fix-on-retry: no changes first, then the reference (exercises error feedback).
export function dryReplies(task: Task, script: DryScript): string[] {
  if (script === 'empty') return [EMPTY];
  const ref = referenceReply(task);
  return script === 'reference' ? [ref] : [EMPTY, ref];
}

export function referenceReply(task: Task): string {
  const root = join(hiddenDir(), task.id, 'reference');
  if (!existsSync(root)) throw new Error(`No reference solution for ${task.id}; run: bench hidden decrypt`);
  const blocks: string[] = ['Here is the solution.'];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name !== '__delete__.txt') blocks.push(renderFileBlock(relative(root, p).replace(/\\/g, '/'), readFileSync(p, 'utf8')));
    }
  };
  walk(root);
  const del = join(root, '__delete__.txt');
  if (existsSync(del)) {
    for (const rel of readFileSync(del, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) blocks.push(`=== DELETE: ${rel} ===`);
  }
  return blocks.join('\n\n');
}

export function scriptedReply(replies: string[]): () => string {
  let i = 0;
  return () => replies[Math.min(i++, replies.length - 1)]!;
}
