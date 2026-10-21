// Hidden tests and reference solutions live in hidden/plain/ (gitignored). Only the encrypted
// bundle hidden/tasks.enc is committed, so a public repo never exposes them to crawlers.
// Key: BENCH_HIDDEN_KEY (base64, 32 bytes) or a file named by BENCH_HIDDEN_KEY_FILE,
// defaulting to ~/.tauri-llm-bench/hidden.key. The key never lives in the repo.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { repoPath } from './paths.ts';

const MAGIC = Buffer.from('TLBH1');
export const BUNDLE = repoPath('hidden', 'tasks.enc');
export const PLAIN = repoPath('hidden', 'plain');

export function hiddenDir(): string {
  return PLAIN;
}

export function defaultKeyFile(): string {
  return process.env.BENCH_HIDDEN_KEY_FILE ?? join(homedir(), '.tauri-llm-bench', 'hidden.key');
}

export function loadKey(): Buffer {
  const inline = process.env.BENCH_HIDDEN_KEY?.trim();
  const b64 = inline || (existsSync(defaultKeyFile()) ? readFileSync(defaultKeyFile(), 'utf8').trim() : '');
  if (!b64) throw new Error(`No hidden-test key: set BENCH_HIDDEN_KEY or create ${defaultKeyFile()} (bench hidden keygen)`);
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('Hidden-test key must be 32 bytes, base64-encoded');
  return key;
}

export function keygen(): string {
  const file = defaultKeyFile();
  if (existsSync(file)) throw new Error(`${file} already exists; refusing to overwrite`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${randomBytes(32).toString('base64')}\n`, { mode: 0o600 });
  return file;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function encrypt(key = loadKey(), src = PLAIN, out = BUNDLE): { files: number; bytes: number } {
  const files: Record<string, string> = {};
  for (const f of walk(src).sort()) files[relative(src, f).replace(/\\/g, '/')] = readFileSync(f).toString('base64');
  const plain = gzipSync(Buffer.from(JSON.stringify(files)));
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const bundle = Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
  writeFileSync(out, bundle);
  return { files: Object.keys(files).length, bytes: bundle.length };
}

export function decrypt(dest = PLAIN, key = loadKey(), bundle = BUNDLE): number {
  const buf = readFileSync(bundle);
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('hidden/tasks.enc: bad header');
  const iv = buf.subarray(5, 17);
  const tag = buf.subarray(17, 33);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = gunzipSync(Buffer.concat([decipher.update(buf.subarray(33)), decipher.final()]));
  const files = JSON.parse(plain.toString('utf8')) as Record<string, string>;
  for (const [rel, b64] of Object.entries(files)) {
    if (rel.split('/').includes('..')) throw new Error(`Refusing path ${rel}`);
    const target = join(dest, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(b64, 'base64'));
  }
  return Object.keys(files).length;
}
