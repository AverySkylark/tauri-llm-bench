// Append-only NDJSON run file. Every line is validated against schema/run.schema.json before it
// is written, so a file on disk is always valid up to its last line.

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { assertValid } from '../schema.ts';

export class RunWriter {
  readonly file: string;

  constructor(file: string) {
    this.file = file;
    if (existsSync(file)) throw new Error(`${file} already exists; run files are never rewritten`);
    mkdirSync(dirname(file), { recursive: true });
  }

  write(record: object): void {
    assertValid('run', record, `${this.file} (${(record as { record?: string }).record ?? '?'} record)`);
    appendFileSync(this.file, `${JSON.stringify(record)}\n`);
  }
}
