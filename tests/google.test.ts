import { describe, expect, it } from 'vitest';
import { buildGoogleBody, googleAdapter } from '../adapters/google.ts';
import { recorder, req } from './helpers.ts';

const MODEL = 'gemini-3.5-flash-lite';
const ok = {
  candidates: [
    {
      content: { role: 'model', parts: [{ text: 'thinking...', thought: true }, { text: 'answer', thoughtSignature: 'sig' }] },
      finishReason: 'STOP',
    },
  ],
  usageMetadata: { promptTokenCount: 500, cachedContentTokenCount: 50, candidatesTokenCount: 40, thoughtsTokenCount: 200 },
};

describe('google adapter', () => {
  it('builds generateContent with thinkingLevel and maxOutputTokens', () => {
    expect(buildGoogleBody(req({ model: MODEL, effort: 'high', temperature: 0 }))).toEqual({
      systemInstruction: { parts: [{ text: 'sys' }] },
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      generationConfig: { maxOutputTokens: 1000, temperature: 0, thinkingConfig: { thinkingLevel: 'high' } },
    });
  });

  it('excludes thought parts from text and bills thoughts as output', async () => {
    const { calls, transport } = recorder(ok);
    const res = await googleAdapter('k-g', transport).chat(req({ model: MODEL }));
    expect(res.text).toBe('answer');
    expect(res.usage).toEqual({ input: 450, cachedInput: 50, output: 240, reasoning: 200 });
    expect(calls[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(calls[0]?.headers['x-goog-api-key']).toBe('k-g');
  });

  it('replays model parts with thought signatures', () => {
    const native = [{ text: 'answer', thoughtSignature: 'sig' }];
    const body = buildGoogleBody(
      req({ model: MODEL, messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'answer', native }, { role: 'user', content: 'b' }] }),
    );
    expect((body.contents as unknown[])[1]).toEqual({ role: 'model', parts: native });
  });

  it('maps safety blocks to refusal', async () => {
    const { transport } = recorder({ promptFeedback: { blockReason: 'SAFETY' }, usageMetadata: { promptTokenCount: 10 } });
    const res = await googleAdapter('k', transport).chat(req({ model: MODEL }));
    expect(res.stopReason).toBe('refusal');
    expect(res.text).toBe('');
  });
});
