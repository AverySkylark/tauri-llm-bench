// Gemini API generateContent (REST), raw HTTP.

import { mapEffort, mergeBody } from './effort.ts';
import { num, postJson, nodeTransport } from './http.ts';
import { AdapterError, type Adapter, type ChatRequest, type ChatResponse, type StopReason, type Transport } from './types.ts';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface Part {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
}

export function googleUrl(model: string): string {
  return `${BASE}/${encodeURIComponent(model)}:generateContent`;
}

export function buildGoogleBody(req: ChatRequest): Record<string, unknown> {
  const effort = mapEffort('google', req.model, req.effort);
  const generationConfig: Record<string, unknown> = { maxOutputTokens: req.maxOutputTokens };
  if (typeof req.temperature === 'number') generationConfig.temperature = req.temperature;
  const base: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: req.messages.map((m) =>
      m.role === 'assistant'
        ? { role: 'model', parts: Array.isArray(m.native) ? m.native : [{ text: m.content }] } // keep thought signatures
        : { role: 'user', parts: [{ text: m.content }] },
    ),
    generationConfig,
  };
  return mergeBody(base, effort.body);
}

export function parseGoogle(json: unknown): Omit<ChatResponse, 'latencyMs' | 'effortNative' | 'temperatureSent'> {
  const r = json as {
    candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
    usageMetadata?: Record<string, unknown>;
  };
  if (!r.usageMetadata) throw new AdapterError('parse', 'Gemini response missing usageMetadata');
  const cand = r.candidates?.[0];
  const parts = cand?.content?.parts ?? [];
  const text = parts.filter((p) => !p.thought).map((p) => p.text ?? '').join('');
  const finish = cand?.finishReason ?? (r.promptFeedback?.blockReason ? `BLOCKED:${r.promptFeedback.blockReason}` : 'unknown');
  const stopReason: StopReason =
    finish === 'STOP'
      ? 'end'
      : finish === 'MAX_TOKENS'
        ? 'max_tokens'
        : /SAFETY|BLOCKED|PROHIBITED|RECITATION/.test(finish)
          ? 'refusal'
          : 'other';
  const u = r.usageMetadata;
  const cached = num(u.cachedContentTokenCount);
  const thoughts = num(u.thoughtsTokenCount);
  return {
    text,
    stopReason,
    stopReasonNative: finish,
    usage: {
      input: num(u.promptTokenCount) - cached,
      cachedInput: cached,
      // candidatesTokenCount excludes thinking; thinking is billed at the output rate.
      output: num(u.candidatesTokenCount) + thoughts,
      reasoning: thoughts,
    },
    native: parts,
  };
}

export function googleAdapter(apiKey: string, transport: Transport = nodeTransport): Adapter {
  return {
    provider: 'google',
    async chat(req) {
      const { json, latencyMs } = await postJson(
        transport,
        googleUrl(req.model),
        { 'x-goog-api-key': apiKey },
        buildGoogleBody(req),
        req.timeoutMs,
      );
      const { param, value } = mapEffort('google', req.model, req.effort);
      return {
        ...parseGoogle(json),
        latencyMs,
        effortNative: { param, value },
        temperatureSent: typeof req.temperature === 'number' ? req.temperature : null,
      };
    },
  };
}
