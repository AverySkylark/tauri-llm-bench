// OpenAI Responses API (POST /v1/responses), raw HTTP. store:false so no server-side state.

import { mapEffort, mergeBody } from './effort.ts';
import { num, postJson } from './http.ts';
import { AdapterError, type Adapter, type ChatRequest, type ChatResponse, type StopReason, type Transport } from './types.ts';

const URL = 'https://api.openai.com/v1/responses';

interface OutputItem {
  type: string;
  content?: { type: string; text?: string; refusal?: string }[];
}

export function buildOpenAIBody(req: ChatRequest): Record<string, unknown> {
  const effort = mapEffort('openai', req.model, req.effort);
  const base: Record<string, unknown> = {
    model: req.model,
    instructions: req.system,
    input: req.messages.map((m) => ({ role: m.role, content: m.content })),
    max_output_tokens: req.maxOutputTokens,
    store: false,
  };
  if (typeof req.temperature === 'number') base.temperature = req.temperature;
  return mergeBody(base, effort.body);
}

export function parseOpenAI(json: unknown): Omit<ChatResponse, 'latencyMs' | 'effortNative' | 'temperatureSent'> {
  const r = json as {
    status?: string;
    incomplete_details?: { reason?: string } | null;
    output?: OutputItem[];
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
      output_tokens_details?: { reasoning_tokens?: number };
    };
  };
  if (!Array.isArray(r.output) || !r.usage) throw new AdapterError('parse', 'OpenAI response missing output/usage');
  const parts = r.output.filter((o) => o.type === 'message').flatMap((o) => o.content ?? []);
  const text = parts.filter((c) => c.type === 'output_text').map((c) => c.text ?? '').join('');
  const refused = parts.some((c) => c.type === 'refusal');
  const incomplete = r.incomplete_details?.reason;
  const stopNative = incomplete ? `incomplete:${incomplete}` : refused ? 'refusal' : (r.status ?? 'unknown');
  const stopReason: StopReason = refused
    ? 'refusal'
    : incomplete === 'max_output_tokens'
      ? 'max_tokens'
      : r.status === 'completed'
        ? 'end'
        : 'other';
  const cached = num(r.usage.input_tokens_details?.cached_tokens);
  return {
    text,
    stopReason,
    stopReasonNative: stopNative,
    usage: {
      input: num(r.usage.input_tokens) - cached,
      cachedInput: cached,
      output: num(r.usage.output_tokens),
      reasoning: num(r.usage.output_tokens_details?.reasoning_tokens),
    },
    native: null,
  };
}

export function openaiAdapter(apiKey: string, transport: Transport = fetch): Adapter {
  return {
    provider: 'openai',
    async chat(req) {
      const { json, latencyMs } = await postJson(
        transport,
        URL,
        { authorization: `Bearer ${apiKey}` },
        buildOpenAIBody(req),
        req.timeoutMs,
      );
      const { param, value } = mapEffort('openai', req.model, req.effort);
      return {
        ...parseOpenAI(json),
        latencyMs,
        effortNative: { param, value },
        temperatureSent: typeof req.temperature === 'number' ? req.temperature : null,
      };
    },
  };
}
