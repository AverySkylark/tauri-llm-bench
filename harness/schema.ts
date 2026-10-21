import { readFileSync } from 'node:fs';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { formatsPlugin } from './ajv-formats.ts';
import { repoPath } from './paths.ts';

const ajv = new Ajv2020({ allErrors: true, strict: true });
formatsPlugin(ajv);

const cache = new Map<string, ValidateFunction>();

export function validator(name: 'run' | 'matrix' | 'prices'): ValidateFunction {
  let v = cache.get(name);
  if (!v) {
    const schema = JSON.parse(readFileSync(repoPath('schema', `${name}.schema.json`), 'utf8'));
    v = ajv.compile(schema);
    cache.set(name, v);
  }
  return v;
}

export function assertValid(name: 'run' | 'matrix' | 'prices', data: unknown, label: string): void {
  const v = validator(name);
  if (!v(data)) {
    const errs = (v.errors ?? []).map((e) => `  ${e.instancePath || '/'} ${e.message}`).join('\n');
    throw new Error(`${label} fails ${name}.schema.json:\n${errs}`);
  }
}
