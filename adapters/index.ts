import { anthropicAdapter } from './anthropic.ts';
import { fakeTransport, type FakeOptions } from './fake.ts';
import { googleAdapter } from './google.ts';
import { openaiAdapter } from './openai.ts';
import { AdapterError, type Adapter, type ProviderId } from './types.ts';

// Benchmark keys only. Plain ANTHROPIC_API_KEY belongs to Claude Code and is never read.
export const KEY_ENV: Record<ProviderId, string> = {
  anthropic: 'BENCH_ANTHROPIC_API_KEY',
  openai: 'BENCH_OPENAI_API_KEY',
  google: 'BENCH_GOOGLE_API_KEY',
};

export function apiKey(provider: ProviderId, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const v = env[KEY_ENV[provider]];
  return v && v.trim() ? v.trim() : undefined;
}

export function availableProviders(env: NodeJS.ProcessEnv = process.env): ProviderId[] {
  return (Object.keys(KEY_ENV) as ProviderId[]).filter((p) => apiKey(p, env));
}

export interface AdapterOptions {
  dryRun: boolean;
  fake?: FakeOptions;
  env?: NodeJS.ProcessEnv;
}

export function createAdapter(provider: ProviderId, opts: AdapterOptions): Adapter {
  if (opts.dryRun) {
    const t = fakeTransport(provider, opts.fake);
    return factories[provider]('dry-run', t);
  }
  const key = apiKey(provider, opts.env);
  if (!key) throw new AdapterError('config', `${KEY_ENV[provider]} is not set; skipping ${provider}`);
  return factories[provider](key);
}

const factories = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  google: googleAdapter,
} satisfies Record<ProviderId, (key: string, t?: Parameters<typeof anthropicAdapter>[1]) => Adapter>;

export * from './types.ts';
export { isSupported, mapEffort } from './effort.ts';
