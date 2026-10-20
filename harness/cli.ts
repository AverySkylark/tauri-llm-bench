#!/usr/bin/env node
// bench CLI. Phase 1 commands only: matrix validation and an adapter dry-run.
// `bench run` arrives in Phase 3.

import { parseArgs } from 'node:util';
import { availableProviders, createAdapter, KEY_ENV } from '../adapters/index.ts';
import { loadMatrix } from './matrix.ts';
import { repoPath } from './paths.ts';
import { costUsd, priceFor } from './prices.ts';

const USAGE = `Usage:
  bench matrix [--matrix matrix/matrix.yaml]     Validate the matrix and list expanded pairs
  bench adapters --dry-run [--matrix ...]        Send one fake request per pair through each adapter (no network)`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: { matrix: { type: 'string', default: repoPath('matrix', 'matrix.yaml') }, 'dry-run': { type: 'boolean', default: false } },
  });
  const loaded = loadMatrix(values.matrix);

  if (cmd === 'matrix') {
    const keys = availableProviders();
    console.log(`matrix v${loaded.matrix.version}  hash ${loaded.hash.slice(0, 12)}  prices ${loaded.prices.version}  suite ${loaded.matrix.suite_version}`);
    for (const p of loaded.pairs) {
      const note = !p.supported ? 'UNSUPPORTED effort' : keys.includes(p.provider) ? 'key ok' : `no key (${KEY_ENV[p.provider]}) -> skipped`;
      console.log(`  ${p.provider.padEnd(9)} ${p.model.padEnd(26)} ${p.effort.padEnd(6)} ${note}`);
    }
    return 0;
  }

  if (cmd === 'adapters') {
    if (!values['dry-run']) {
      console.error('Live adapter calls are not available yet. Use --dry-run.');
      return 2;
    }
    for (const p of loaded.pairs.filter((x) => x.supported)) {
      const adapter = createAdapter(p.provider, { dryRun: true });
      const res = await adapter.chat({
        model: p.model,
        system: 'You are a careful engineer.',
        messages: [{ role: 'user', content: 'Say hello.' }],
        effort: p.effort,
        maxOutputTokens: p.maxOutputTokens,
        temperature: p.temperature,
        timeoutMs: loaded.matrix.defaults.timeout_s * 1000,
      });
      const usd = costUsd(priceFor(loaded.prices, p.model), res.usage);
      console.log(
        `  ${p.provider.padEnd(9)} ${p.model.padEnd(26)} ${p.effort.padEnd(6)} ${res.effortNative.param}=${res.effortNative.value}  ` +
          `in=${res.usage.input} out=${res.usage.output} reasoning=${res.usage.reasoning ?? 'n/a'}  $${usd.toFixed(6)}  stop=${res.stopReason}`,
      );
    }
    return 0;
  }

  console.log(USAGE);
  return cmd ? 2 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
