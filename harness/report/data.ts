// Loads NDJSON run files for reporting. Reports group by suite version and refuse to mix
// suites (or dry and live data) unless asked.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AttemptRecord } from '../orchestrator/attempt.ts';
import { validator } from '../schema.ts';

export interface RunMeta {
  run_id: string;
  started_at: string;
  suite_version: string;
  price_table_version: string;
  harness_commit: string;
  harness_dirty?: boolean;
  dry_run: boolean;
  mode: string;
}

export interface Dataset {
  runs: RunMeta[];
  attempts: (AttemptRecord & { suite: string })[];
  suites: string[];
  dry: boolean;
  crossSuite: boolean;
  finishedAt: string | null;
  totalCostUsd: number;
}

export interface LoadOptions {
  dir: string;
  suite: string;
  crossSuite: boolean;
  dry: boolean;
}

export function loadDataset(o: LoadOptions): Dataset {
  const runs: RunMeta[] = [];
  const attempts: Dataset['attempts'] = [];
  const suites = new Set<string>();
  let finishedAt: string | null = null;
  let totalCostUsd = 0;
  const v = validator('run');
  if (!existsSync(o.dir)) return { runs, attempts, suites: [], dry: o.dry, crossSuite: o.crossSuite, finishedAt, totalCostUsd };

  for (const suiteDir of readdirSync(o.dir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    if (!o.crossSuite && suiteDir.name !== o.suite) continue;
    for (const f of readdirSync(join(o.dir, suiteDir.name)).filter((n) => n.endsWith('.ndjson')).sort()) {
      const path = join(o.dir, suiteDir.name, f);
      let run: RunMeta | null = null;
      for (const [i, line] of readFileSync(path, 'utf8').split('\n').entries()) {
        if (!line.trim()) continue;
        const rec = JSON.parse(line) as { record: string };
        if (!v(rec)) throw new Error(`${path}:${i + 1} fails run.schema.json`);
        if (rec.record === 'run') {
          run = rec as unknown as RunMeta;
          if (run.dry_run !== o.dry) {
            run = null;
            break;
          }
          runs.push(run);
          suites.add(run.suite_version);
        } else if (rec.record === 'attempt' && run) {
          attempts.push({ ...(rec as unknown as AttemptRecord), suite: run.suite_version });
        } else if (rec.record === 'summary' && run) {
          const s = rec as unknown as { finished_at: string; cost_usd: number };
          totalCostUsd += s.cost_usd;
          if (!finishedAt || s.finished_at > finishedAt) finishedAt = s.finished_at;
        }
      }
    }
  }
  return { runs, attempts, suites: [...suites].sort(), dry: o.dry, crossSuite: o.crossSuite, finishedAt, totalCostUsd: Math.round(totalCostUsd * 1e6) / 1e6 };
}
