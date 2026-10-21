import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { isSupported } from '../adapters/effort.ts';
import type { Effort, ProviderId } from '../adapters/types.ts';
import { loadPrices, priceFor, type PriceTable } from './prices.ts';
import { assertValid } from './schema.ts';

export interface MatrixDefaults {
  reps: number;
  max_retries: number;
  max_output_tokens: number;
  temperature: number | 'provider_default';
  timeout_s: number;
  usd_ceiling_per_run: number;
  value_index: { latency_usd_per_hour: number; min_quality: number; min_pass_wilson_lower: number };
}

export interface Matrix {
  version: number;
  suite_version: string;
  price_table: string;
  defaults: MatrixDefaults;
  pairs: {
    provider: ProviderId;
    model: string;
    efforts: Effort[];
    max_output_tokens?: number;
    temperature?: number | 'provider_default';
  }[];
}

export interface Pair {
  provider: ProviderId;
  model: string;
  effort: Effort;
  maxOutputTokens: number;
  temperature: number | 'provider_default';
  supported: boolean;
}

export interface LoadedMatrix {
  matrix: Matrix;
  hash: string;
  prices: PriceTable;
  pairs: Pair[];
}

export function loadMatrix(path: string): LoadedMatrix {
  const raw = parse(readFileSync(path, 'utf8'));
  assertValid('matrix', raw, path);
  const matrix = raw as Matrix;
  const prices = loadPrices(matrix.price_table);

  for (const p of matrix.pairs) {
    const price = priceFor(prices, p.model);
    if (price.provider !== p.provider) {
      throw new Error(`${p.model}: matrix says provider ${p.provider}, price table says ${price.provider}`);
    }
  }

  const pairs = matrix.pairs.flatMap((p) =>
    p.efforts.map((effort) => ({
      provider: p.provider,
      model: p.model,
      effort,
      maxOutputTokens: p.max_output_tokens ?? matrix.defaults.max_output_tokens,
      temperature: p.temperature ?? matrix.defaults.temperature,
      supported: isSupported(p.provider, p.model, effort),
    })),
  );

  return { matrix, hash: hashMatrix(matrix), prices, pairs };
}

// Hash of the parsed content with sorted keys, so comments and formatting don't change it.
export function hashMatrix(matrix: Matrix): string {
  return createHash('sha256').update(canonicalJson(matrix)).digest('hex');
}

export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${canonicalJson(val)}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
