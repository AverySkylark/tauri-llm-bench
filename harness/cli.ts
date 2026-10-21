#!/usr/bin/env node
// bench CLI.

import { parseArgs } from 'node:util';
import { availableProviders, createAdapter, KEY_ENV } from '../adapters/index.ts';
import { loadMatrix } from './matrix.ts';
import { repoPath } from './paths.ts';
import { costUsd, priceFor } from './prices.ts';
import { decrypt, encrypt, keygen } from './hidden.ts';
import { listTasks } from './tasks.ts';
import { prepare, verifyTask } from './verify.ts';
import { runCommand } from './orchestrator/cli-run.ts';

const USAGE = `Usage:
  bench run --matrix matrix/matrix.yaml (--dry-run | --live --usd-ceiling <USD>) [options]
  bench run --model <id> --effort <level> [--task A] (--dry-run | --live --usd-ceiling <USD>)
  bench run --only-new (--dry-run | --live --usd-ceiling <USD>)
      options: --task A,B  --reps N  --max-retries R  --keep-work  --out <dir>
               --dry-reply reference|empty|fix-on-retry   (dry run only; default fix-on-retry)
  bench matrix [--matrix matrix/matrix.yaml]     Validate the matrix and list expanded pairs
  bench adapters --dry-run [--matrix ...]        Send one fake request per pair through each adapter (no network)
  bench tasks list                               List tasks
  bench tasks prepare                            Generate Cargo.lock, fetch crates, warm the shared target dir
  bench tasks verify [--task A]                  Scaffold must fail gates; reference must pass gates and hidden tests
  bench hidden keygen|encrypt|decrypt            Manage the encrypted hidden-test bundle`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === 'run') return runCommand(rest);
  const { values } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      matrix: { type: 'string', default: repoPath('matrix', 'matrix.yaml') },
      'dry-run': { type: 'boolean', default: false },
      task: { type: 'string' },
    },
  });
  const sub = rest.find((a) => !a.startsWith('-'));

  if (cmd === 'tasks') return tasksCommand(sub, values.task);
  if (cmd === 'hidden') return hiddenCommand(sub);

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

async function tasksCommand(sub: string | undefined, only: string | undefined): Promise<number> {
  const log = (m: string) => console.log(m);
  if (sub === 'list') {
    for (const t of listTasks()) console.log(`  ${t.id}  ${t.class}  ${t.kind.padEnd(11)} ${t.title}`);
    return 0;
  }
  if (sub === 'prepare') {
    await prepare(log);
    return 0;
  }
  if (sub === 'verify') {
    const tasks = listTasks().filter((t) => !only || t.id === only);
    let failed = 0;
    for (const t of tasks) {
      const v = await verifyTask(t, log);
      const gates = (r: Record<string, { ok: boolean; ms: number }>) =>
        Object.entries(r).map(([n, g]) => `${n}:${g.ok ? 'pass' : 'FAIL'}(${(g.ms / 1000).toFixed(1)}s)`).join(' ');
      console.log(`
${t.id} ${v.ok ? 'OK' : 'PROBLEMS'}`);
      console.log(`  scaffold  gates  ${gates(v.scaffoldGates)}`);
      console.log(`  scaffold  hidden ${v.scaffoldHidden.passed}/${v.scaffoldHidden.total}`);
      console.log(`  reference gates  ${gates(v.referenceGates)}`);
      console.log(`  reference hidden ${v.referenceHidden.passed}/${v.referenceHidden.total} (rust ${v.referenceHidden.rust}, vitest ${v.referenceHidden.vitest})`);
      for (const p of v.problems) console.log(`  ! ${p}`);
      if (!v.ok) failed++;
    }
    return failed ? 1 : 0;
  }
  console.log(USAGE);
  return 2;
}

function hiddenCommand(sub: string | undefined): number {
  if (sub === 'keygen') console.log(`Key written to ${keygen()}. Back it up and add it as the BENCH_HIDDEN_KEY secret in CI.`);
  else if (sub === 'encrypt') {
    const r = encrypt();
    console.log(`hidden/tasks.enc: ${r.files} files, ${r.bytes} bytes`);
  } else if (sub === 'decrypt') console.log(`Decrypted ${decrypt()} files into hidden/plain/`);
  else {
    console.log(USAGE);
    return 2;
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
