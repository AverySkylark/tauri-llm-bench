// Anthropic Messages API (POST /v1/messages), raw HTTP so the exact request is recorded.

import { mapEffort, mergeBody } from './effort.ts';
import { num, postJson, nodeTransport } from './http.ts';
import { AdapterError, type Adapter, type ChatRequest, type ChatResponse, type StopReason, type Transport } from './types.ts';

const URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

interface ContentBlock {
  type: string;
  text?: string;
}

export function buildAnthropicBody(req: ChatRequest): Record<string, unknown> {
  const effort = mapEffort('anthropic', req.model, req.effort);
  const base: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxOutputTokens,
    system: req.system,
    messages: req.messages.map((m) =>
      m.role === 'assistant' && Array.isArray(m.native)
        ? { role: 'assistant', content: m.native } // replay thinking blocks unchanged
        : { role: m.role, content: m.content },
    ),
  };
  if (typeof req.temperature === 'number') base.temperature = req.temperature;
  return mergeBody(base, effort.body);
}

export function parseAnthropic(json: unknown): Omit<ChatResponse, 'latencyMs' | 'effortNative' | 'temperatureSent'> {
  const r = json as { content?: ContentBlock[]; stop_reason?: string; usage?: Record<string, unknown> };
  if (!Array.isArray(r.content) || !r.usage) throw new AdapterError('parse', 'Anthropic response missing content/usage');
  const text = r.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  const stop = r.stop_reason ?? 'unknown';
  const stopReason: StopReason =
    stop === 'end_turn' || stop === 'stop_sequence' ? 'end' : stop === 'max_tokens' ? 'max_tokens' : stop === 'refusal' ? 'refusal' : 'other';
  return {
    text,
    stopReason,
    stopReasonNative: stop,
    usage: {
      // Cache writes are billed above the input rate; the harness doesn't set cache_control,
      // so they should be 0. Counted as input if they ever appear.
      input: num(r.usage.input_tokens) + num(r.usage.cache_creation_input_tokens),
      cachedInput: num(r.usage.cache_read_input_tokens),
      output: num(r.usage.output_tokens), // includes thinking; not broken out by the API
      reasoning: null,
    },
    native: r.content,
  };
}

export function anthropicAdapter(apiKey: string, transport: Transport = nodeTransport): Adapter {
  return {
    provider: 'anthropic',
    async chat(req) {
      const body = buildAnthropicBody(req);
      const { json, latencyMs } = await postJson(
        transport,
        URL,
        { 'x-api-key': apiKey, 'anthropic-version': API_VERSION },
        body,
        req.timeoutMs,
      );
      const { param, value } = mapEffort('anthropic', req.model, req.effort);
      return {
        ...parseAnthropic(json),
        latencyMs,
        effortNative: { param, value },
        temperatureSent: typeof req.temperature === 'number' ? req.temperature : null,
      };
    },
  };
}
