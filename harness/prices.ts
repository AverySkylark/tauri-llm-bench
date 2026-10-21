import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { ProviderId, Usage } from '../adapters/types.ts';
import { repoPath } from './paths.ts';
import { assertValid } from './schema.ts';

interface Rates {
  input: number;
  cached_input: number;
  output: number;
}

export interface ModelPrice extends Rates {
  provider: ProviderId;
  pin: 'dated_snapshot' | 'fixed_id' | 'stable_code';
  long_context?: Rates & { threshold_tokens: number };
}

export interface PriceTable {
  version: string;
  retrieved: string;
  models: Record<string, ModelPrice>;
}

export function loadPrices(version: string): PriceTable {
  const raw = parse(readFileSync(repoPath('prices', `${version}.yaml`), 'utf8'), { schema: 'core' });
  // YAML parses the date as a string with the core schema; validate the plain object.
  assertValid('prices', raw, `prices/${version}.yaml`);
  const table = raw as PriceTable;
  if (table.version !== version) throw new Error(`prices/${version}.yaml declares version ${table.version}`);
  return table;
}

export function priceFor(table: PriceTable, model: string): ModelPrice {
  const p = table.models[model];
  if (!p) throw new Error(`Model ${model} is not in price table ${table.version}`);
  return p;
}

// USD for one request. The long-context card applies when the whole prompt exceeds its threshold.
export function costUsd(price: ModelPrice, usage: Usage): number {
  const prompt = usage.input + usage.cachedInput;
  const r: Rates = price.long_context && prompt > price.long_context.threshold_tokens ? price.long_context : price;
  const usd = (usage.input * r.input + usage.cachedInput * r.cached_input + usage.output * r.output) / 1_000_000;
  return Math.round(usd * 1e8) / 1e8;
}
