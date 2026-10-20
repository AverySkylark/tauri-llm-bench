// Dry-run transport: returns provider-shaped canned JSON so the real parse path runs with no network.
// Token counts are derived deterministically from the request so cost maths can be exercised.

import type { ProviderId, Transport } from './types.ts';

export interface FakeOptions {
  // Assistant text to return; defaults to an empty-change answer in the harness's file-block format.
  reply?: string | ((body: Record<string, unknown>) => string);
  latencyMs?: number;
  status?: number;
}

const DEFAULT_REPLY = 'DRY RUN: no files changed.';

export function fakeTransport(provider: ProviderId, opts: FakeOptions = {}): Transport {
  return async (_url, init) => {
    if (opts.latencyMs) await sleep(opts.latencyMs, init.signal ?? undefined);
    if (opts.status && opts.status >= 400) {
      return new Response(JSON.stringify({ error: { message: 'fake error' } }), { status: opts.status });
    }
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const reply = typeof opts.reply === 'function' ? opts.reply(body) : (opts.reply ?? DEFAULT_REPLY);
    const inTok = Math.ceil(String(init.body).length / 4);
    const outTok = Math.ceil(reply.length / 4);
    const thinkTok = 32;
    return new Response(JSON.stringify(shape(provider, reply, inTok, outTok, thinkTok)), { status: 200 });
  };
}

function shape(provider: ProviderId, text: string, inTok: number, outTok: number, thinkTok: number): unknown {
  switch (provider) {
    case 'anthropic':
      return {
        type: 'message',
        content: [
          { type: 'thinking', thinking: '', signature: 'fake' },
          { type: 'text', text },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: inTok, output_tokens: outTok + thinkTok, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      };
    case 'openai':
      return {
        status: 'completed',
        incomplete_details: null,
        output: [
          { type: 'reasoning', summary: [] },
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
        ],
        usage: {
          input_tokens: inTok,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: outTok + thinkTok,
          output_tokens_details: { reasoning_tokens: thinkTok },
        },
      };
    case 'google':
      return {
        candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: inTok, candidatesTokenCount: outTok, thoughtsTokenCount: thinkTok, totalTokenCount: inTok + outTok + thinkTok },
      };
  }
}

// Honours the abort signal like real fetch, so timeouts behave the same in dry runs.
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });
}
