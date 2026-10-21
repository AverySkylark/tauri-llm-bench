// The one text protocol every provider gets: prompt, project files inline, whole-file replies.
// Plain Markdown and line markers only, no provider-specific tags (see PLAN §2.9).

import type { GateResult } from '../gates.ts';
import type { Task } from '../tasks.ts';

export const FORMAT_VERSION = 1;

export const SYSTEM_PROMPT = `You are an expert software engineer working on a Tauri 2 desktop app (Rust backend, React + TypeScript frontend).

You cannot run commands or read files yourself. You are given the task and every file in the project. Reply with the complete new contents of each file you create or change, in exactly this format:

=== FILE: relative/path/to/file ===
<the entire file, from first line to last>
=== END FILE ===

To delete a file, write this line on its own:

=== DELETE: relative/path/to/file ===

Rules:
- Always give whole files, never diffs, excerpts or placeholders such as "rest unchanged".
- Do not put Markdown code fences inside a file block.
- Only create, change or delete files that match the editable paths listed with the task. Other edits are rejected.
- Files you do not mention stay as they are.
- Text outside the blocks is ignored, so keep any explanation short.

After your reply the harness applies your files and runs these checks: cargo check, cargo test, tsc --noEmit, eslint (zero warnings) and vitest. If a check fails you may get the errors back and a chance to fix them.`;

export interface ProjectFile {
  path: string;
  content: string;
  editable: boolean;
}

export function renderFileBlock(path: string, content: string): string {
  return `=== FILE: ${path} ===\n${content.endsWith('\n') ? content : `${content}\n`}=== END FILE ===`;
}

export function buildTaskMessage(task: Task, files: ProjectFile[]): string {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const list = sorted.map((f) => `- ${f.path}${f.editable ? '' : ' (read-only)'}`).join('\n');
  const blocks = sorted.map((f) => renderFileBlock(f.path, f.content)).join('\n\n');
  const readonly = task.readonly.length ? `\nRead-only even inside those paths: ${task.readonly.map((g) => `\`${g}\``).join(', ')}` : '';
  return `# Task

${task.prompt.trim()}

# Editable paths

${task.editable.map((g) => `- \`${g}\``).join('\n')}${readonly}

# Project files

${list}

${blocks}
`;
}

const PER_GATE_CHARS = 6000;
const TOTAL_CHARS = 24000;

export interface FeedbackInput {
  gates: Record<string, GateResult>;
  parseIssues: string[];
  rejectedPaths: string[];
  workDir: string;
  retriesLeft: number;
}

export function buildFeedback(f: FeedbackInput): string {
  const parts: string[] = ['Your changes were applied. Some checks failed.'];
  if (f.parseIssues.length) parts.push(`## Problems reading your reply\n\n${f.parseIssues.map((i) => `- ${i}`).join('\n')}`);
  if (f.rejectedPaths.length) {
    parts.push(`## Rejected edits (not editable, not applied)\n\n${f.rejectedPaths.map((p) => `- ${p}`).join('\n')}`);
  }
  let budget = TOTAL_CHARS;
  for (const [name, g] of Object.entries(f.gates)) {
    if (g.ok) continue;
    const text = scrubPaths(g.output_tail, f.workDir).slice(-Math.min(PER_GATE_CHARS, Math.max(budget, 500)));
    budget -= text.length;
    const why = g.timed_out ? 'timed out' : `exit code ${g.exit_code ?? 'none'}`;
    parts.push(`## ${name} failed (${why})\n\n\`\`\`text\n${text.trimEnd()}\n\`\`\``);
  }
  const passed = Object.entries(f.gates).filter(([, g]) => g.ok).map(([n]) => n);
  if (passed.length) parts.push(`Passed: ${passed.join(', ')}.`);
  parts.push(
    `Fix the problems. Reply in the same format with the complete contents of every file you change. ` +
      `Your earlier changes are already applied. Attempts left after this one: ${f.retriesLeft - 1}.`,
  );
  return parts.join('\n\n');
}

// Absolute working-copy paths say nothing useful to the model and differ per machine.
export function scrubPaths(text: string, workDir: string): string {
  const variants = new Set([workDir, workDir.replace(/\\/g, '/'), workDir.replace(/\//g, '\\')]);
  let out = text;
  for (const v of variants) out = out.split(v).join('.');
  return out;
}

export type Edit = { kind: 'write'; path: string; content: string } | { kind: 'delete'; path: string };

export interface ParsedReply {
  edits: Edit[];
  issues: string[];
}

const FILE_RE = /^\s*=== FILE: (.+?) ===\s*$/;
const END_RE = /^\s*=== END FILE ===\s*$/;
const DELETE_RE = /^\s*=== DELETE: (.+?) ===\s*$/;

export function parseReply(text: string): ParsedReply {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const byPath = new Map<string, Edit>();
  const issues: string[] = [];
  const add = (e: Edit) => {
    if (byPath.has(e.path)) issues.push(`${e.path} appears more than once; the last block was used.`);
    byPath.delete(e.path);
    byPath.set(e.path, e);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const del = DELETE_RE.exec(line);
    if (del) {
      add({ kind: 'delete', path: normalisePath(del[1]!) });
      continue;
    }
    const file = FILE_RE.exec(line);
    if (!file) continue;
    const path = normalisePath(file[1]!);
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !END_RE.test(lines[j]!) && !FILE_RE.test(lines[j]!)) body.push(lines[j++]!);
    if (j >= lines.length || !END_RE.test(lines[j]!)) {
      // A truncated file would compile into nonsense; drop it and say so.
      issues.push(`The block for ${path} has no "=== END FILE ===" line; it was not applied.`);
      i = j - 1;
      continue;
    }
    add({ kind: 'write', path, content: stripFence(body).join('\n') + '\n' });
    i = j;
  }

  if (byPath.size === 0 && issues.length === 0) issues.push('No file blocks were found in your reply.');
  return { edits: [...byPath.values()], issues };
}

function normalisePath(raw: string): string {
  return raw
    .trim()
    .replace(/^`+|`+$/g, '')
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '');
}

// Tolerate a Markdown fence wrapped around the whole file body, a common habit across all providers.
function stripFence(body: string[]): string[] {
  let start = 0;
  let end = body.length;
  while (start < end && body[start]!.trim() === '') start++;
  while (end > start && body[end - 1]!.trim() === '') end--;
  if (end - start >= 2 && /^\s*(```|~~~)[\w+-]*\s*$/.test(body[start]!) && /^\s*(```|~~~)\s*$/.test(body[end - 1]!)) {
    return body.slice(start + 1, end - 1);
  }
  return body;
}
