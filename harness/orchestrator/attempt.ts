// One attempt = one (pair, task, rep): prompt, up to 1 + R model turns with gate feedback, then
// hidden tests on the final working copy. Every outcome, including caps and errors, yields a record.

import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { AdapterError, mapEffort, type Adapter, type ChatMessage, type ChatResponse, type ChatRequest, type NativeEffort } from '../../adapters/index.ts';
import { errorClasses, runGates as realRunGates, scoreHidden as realScoreHidden, type GateResult, type HiddenScore } from '../gates.ts';
import { hiddenDir } from '../hidden.ts';
import type { Pair } from '../matrix.ts';
import { costUsd, type ModelPrice } from '../prices.ts';
import { materialize, removeWorkingCopy, touchTree, type Task } from '../tasks.ts';
import { readManifest } from '../verify.ts';
import { Budget, promptChars, worstCaseUsd } from './budget.ts';
import { buildFeedback, buildTaskMessage, parseReply, SYSTEM_PROMPT } from './format.ts';
import { applyEdits, hygiene, projectFiles, snapshot, unifiedDiff } from './workspace.ts';

export type Status = 'pass' | 'fail' | 'capped_timeout' | 'capped_tokens' | 'capped_usd' | 'refusal' | 'api_error' | 'unsupported';

interface Tokens {
  input: number;
  cached_input: number;
  output: number;
  reasoning: number | null;
}

interface GateRecord {
  ok: boolean;
  ms: number;
  exit_code: number | null;
  output_tail: string;
}

export interface Iteration {
  n: number;
  tokens: Tokens;
  latency_ms: number;
  cost_usd: number;
  stop_reason: ChatResponse['stopReason'];
  stop_reason_native: string;
  files_changed: string[];
  rejected_paths: string[];
  gates: Record<string, GateRecord>;
  error_classes: string[];
}

export interface AttemptRecord {
  record: 'attempt';
  run_id: string;
  attempt_id: string;
  pair: {
    provider: Pair['provider'];
    model: string;
    effort_norm: Pair['effort'];
    effort_native: NativeEffort | null;
    temperature_sent: number | null;
    max_output_tokens: number;
  };
  task: { id: string; class: Task['class']; rep_index: number };
  status: Status;
  error: string | null;
  first_pass_compile: boolean | null;
  iterations: Iteration[];
  hidden: { passed: number; total: number } | null;
  hygiene?: { unsafe_added: number; unwraps_in_ipc: number; hallucination_errors: number };
  telemetry: { tokens: Tokens; model_latency_ms: number; wall_ms: number; cost_usd: number };
  diff?: string;
}

export interface AttemptDeps {
  runGates: (task: Task, cwd: string, timeoutMs: number) => Promise<Record<string, GateResult>>;
  scoreHidden: (task: Task, cwd: string, timeoutMs: number, expected?: { rust: number; vitest: number }) => Promise<HiddenScore>;
  sleep: (ms: number) => Promise<void>;
}

export const realDeps: AttemptDeps = {
  runGates: realRunGates,
  scoreHidden: realScoreHidden,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export interface AttemptInput {
  runId: string;
  pair: Pair;
  task: Task;
  rep: number;
  adapter: Adapter;
  price: ModelPrice;
  budget: Budget;
  timeoutS: number;
  maxRetries: number;
  gateTimeoutMs: number;
  workRoot: string;
  keepWork: boolean;
  log: (s: string) => void;
  deps?: AttemptDeps;
}

export interface AttemptOutcome {
  record: AttemptRecord;
  // Set when the run must stop after this attempt (dollar ceiling reached).
  abort: string | null;
}

export function attemptId(runId: string, pair: Pair, taskId: string, rep: number): string {
  return createHash('sha256').update(`${runId}|${pair.provider}|${pair.model}|${pair.effort}|${taskId}|${rep}`).digest('hex').slice(0, 16);
}

const zeroTokens = (): Tokens => ({ input: 0, cached_input: 0, output: 0, reasoning: null });

export async function runAttempt(a: AttemptInput): Promise<AttemptOutcome> {
  const deps = a.deps ?? realDeps;
  const started = performance.now();
  const id = attemptId(a.runId, a.pair, a.task.id, a.rep);
  const record: AttemptRecord = {
    record: 'attempt',
    run_id: a.runId,
    attempt_id: id,
    pair: {
      provider: a.pair.provider,
      model: a.pair.model,
      effort_norm: a.pair.effort,
      effort_native: a.pair.supported ? nativeOf(mapEffort(a.pair.provider, a.pair.model, a.pair.effort)) : null,
      temperature_sent: a.pair.temperature === 'provider_default' ? null : a.pair.temperature,
      max_output_tokens: a.pair.maxOutputTokens,
    },
    task: { id: a.task.id, class: a.task.class, rep_index: a.rep },
    status: 'fail',
    error: null,
    first_pass_compile: null,
    iterations: [],
    hidden: null,
    telemetry: { tokens: zeroTokens(), model_latency_ms: 0, wall_ms: 0, cost_usd: 0 },
  };

  if (!a.pair.supported) {
    record.status = 'unsupported';
    record.error = `${a.pair.provider}/${a.pair.model} cannot express effort '${a.pair.effort}'; nothing was sent`;
    record.telemetry.wall_ms = Math.round(performance.now() - started);
    return { record, abort: null };
  }

  const dir = join(a.workRoot, `attempt-${id}`);
  materialize(a.task, dir);
  let abort: string | null = null;
  try {
    const base = snapshot(dir);
    const messages: ChatMessage[] = [{ role: 'user', content: buildTaskMessage(a.task, projectFiles(a.task, base)) }];
    const gateOutputs: string[] = [];
    let modelMs = 0;
    let status: Status | null = null;

    for (let n = 0; n <= a.maxRetries && status === null; n++) {
      const remainingMs = a.timeoutS * 1000 - modelMs;
      if (remainingMs <= 0) {
        status = 'capped_timeout';
        record.error = `Model time reached the ${a.timeoutS} s cap`;
        break;
      }
      const worst = worstCaseUsd(a.price, promptChars(SYSTEM_PROMPT, messages), a.pair.maxOutputTokens);
      if (!a.budget.allows(worst)) {
        status = 'capped_usd';
        abort = `Dollar ceiling $${a.budget.ceiling.toFixed(2)}: spent $${a.budget.spent.toFixed(4)}, next request could cost up to $${worst.toFixed(4)}`;
        record.error = abort;
        break;
      }

      const req: ChatRequest = {
        model: a.pair.model,
        system: SYSTEM_PROMPT,
        messages,
        effort: a.pair.effort,
        maxOutputTokens: a.pair.maxOutputTokens,
        temperature: a.pair.temperature,
        timeoutMs: remainingMs,
      };
      let res: ChatResponse;
      try {
        res = await chatWithRetry(a.adapter, req, deps.sleep, a.log);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        status = err instanceof AdapterError && err.kind === 'timeout' ? 'capped_timeout' : 'api_error';
        record.error = e.message;
        break;
      }

      modelMs += res.latencyMs;
      const cost = costUsd(a.price, res.usage);
      a.budget.add(cost);
      record.pair.effort_native = res.effortNative;
      record.pair.temperature_sent = res.temperatureSent;
      messages.push({ role: 'assistant', content: res.text, native: res.native });
      const it: Iteration = {
        n,
        tokens: { input: res.usage.input, cached_input: res.usage.cachedInput, output: res.usage.output, reasoning: res.usage.reasoning },
        latency_ms: res.latencyMs,
        cost_usd: cost,
        stop_reason: res.stopReason,
        stop_reason_native: res.stopReasonNative,
        files_changed: [],
        rejected_paths: [],
        gates: {},
        error_classes: [],
      };
      record.iterations.push(it);
      a.log(`    turn ${n}: ${res.usage.output} out tok, ${(res.latencyMs / 1000).toFixed(1)} s, $${cost.toFixed(4)}, stop=${res.stopReason}`);

      if (res.stopReason === 'refusal') {
        status = 'refusal';
        break;
      }
      if (res.stopReason === 'max_tokens') {
        // A cut-off reply is not applied: half a file is worse than none.
        status = 'capped_tokens';
        record.error = `Reply hit the ${a.pair.maxOutputTokens}-token output cap`;
        break;
      }

      const parsed = parseReply(res.text);
      const applied = applyEdits(a.task, dir, parsed.edits);
      it.files_changed = applied.changed;
      it.rejected_paths = applied.rejected;
      const gates = await deps.runGates(a.task, dir, a.gateTimeoutMs);
      it.gates = Object.fromEntries(
        Object.entries(gates).map(([k, g]) => [k, { ok: g.ok, ms: g.ms, exit_code: g.exit_code, output_tail: g.output_tail }]),
      );
      const joined = Object.values(gates).map((g) => g.output_tail);
      gateOutputs.push(...joined);
      it.error_classes = errorClasses(joined.join('\n'));
      const failed = Object.entries(gates).filter(([, g]) => !g.ok).map(([k]) => k);
      a.log(`    gates: ${failed.length ? `failed ${failed.join(', ')}` : 'all pass'}${applied.rejected.length ? `; rejected ${applied.rejected.join(', ')}` : ''}`);

      if (failed.length === 0) status = 'pass';
      else if (n === a.maxRetries) status = 'fail';
      else {
        messages.push({
          role: 'user',
          content: buildFeedback({
            gates,
            parseIssues: [...parsed.issues, ...applied.issues],
            rejectedPaths: applied.rejected,
            workDir: dir,
            retriesLeft: a.maxRetries - n,
          }),
        });
      }
    }
    record.status = status ?? 'fail';

    const first = record.iterations[0];
    if (first && Object.keys(first.gates).length > 0) {
      const compiles = ['cargo_check', 'tsc'].filter((g) => g in first.gates).every((g) => first.gates[g]!.ok);
      record.first_pass_compile = compiles;
    }

    const final = snapshot(dir);
    const changedAnything = record.iterations.some((it) => Object.keys(it.gates).length > 0);
    if (changedAnything) {
      record.hidden = await scoreHiddenTests(a, dir, deps);
      a.log(`    hidden: ${record.hidden.passed}/${record.hidden.total}`);
    }
    record.diff = unifiedDiff(base, final);
    record.hygiene = hygiene(base, final, gateOutputs);
    record.telemetry.model_latency_ms = modelMs;
  } finally {
    if (!a.keepWork) removeWorkingCopy(dir);
  }

  record.telemetry.tokens = sumTokens(record.iterations);
  record.telemetry.cost_usd = Math.round(record.iterations.reduce((s, it) => s + it.cost_usd, 0) * 1e8) / 1e8;
  record.telemetry.wall_ms = Math.round(performance.now() - started);
  return { record, abort };
}

async function scoreHiddenTests(a: AttemptInput, dir: string, deps: AttemptDeps): Promise<{ passed: number; total: number }> {
  const tests = join(hiddenDir(), a.task.id, 'tests');
  const manifest = readManifest(a.task.id);
  if (!existsSync(tests) || !manifest) throw new Error(`Hidden tests for ${a.task.id} are missing; run: bench hidden decrypt`);
  // Only now, after the model's last turn, do the hidden tests enter the working copy.
  cpSync(tests, dir, { recursive: true });
  touchTree(dir, new Date());
  const s = await deps.scoreHidden(a.task, dir, a.gateTimeoutMs, manifest);
  return { passed: s.passed, total: s.total };
}

const RETRY_DELAYS_MS = [2000, 10000, 30000];

// Transient provider failures (429, 5xx, dropped connections) are retried here and are not
// counted against R, which is reserved for the model fixing its own errors.
export async function chatWithRetry(
  adapter: Adapter,
  req: ChatRequest,
  sleep: (ms: number) => Promise<void>,
  log: (s: string) => void,
): Promise<ChatResponse> {
  for (let i = 0; ; i++) {
    try {
      return await adapter.chat(req);
    } catch (err) {
      const transient = err instanceof AdapterError && err.kind !== 'timeout' && (err.retryable || (err.kind === 'http' && err.status === null));
      const delay = RETRY_DELAYS_MS[i];
      if (!transient || delay === undefined) throw err;
      log(`    transient error (${(err as Error).message.slice(0, 120)}); retrying in ${delay / 1000} s`);
      await sleep(delay);
    }
  }
}

function nativeOf(m: NativeEffort): NativeEffort {
  return { param: m.param, value: m.value };
}

export function sumTokens(its: Iteration[]): Tokens {
  const t = zeroTokens();
  for (const it of its) {
    t.input += it.tokens.input;
    t.cached_input += it.tokens.cached_input;
    t.output += it.tokens.output;
    if (it.tokens.reasoning !== null) t.reasoning = (t.reasoning ?? 0) + it.tokens.reasoning;
  }
  return t;
}
