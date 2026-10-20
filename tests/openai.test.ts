import { describe, expect, it } from 'vitest';
import { buildOpenAIBody, openaiAdapter } from '../adapters/openai.ts';
import { recorder, req } from './helpers.ts';

const MODEL = 'gpt-5.4-mini-2026-03-17';
const ok = {
  status: 'completed',
  incomplete_details: null,
  output: [
    { type: 'reasoning', summary: [] },
    { type: 'message', content: [{ type: 'output_text', text: 'done' }] },
  ],
  usage: { input_tokens: 300, input_tokens_details: { cached_tokens: 100 }, output_tokens: 80, output_tokens_details: { reasoning_tokens: 60 } },
};

describe('openai adapter', () => {
  it('builds a stateless Responses API request', () => {
    expect(buildOpenAIBody(req({ model: MODEL, effort: 'high' }))).toEqual({
      model: MODEL,
      instructions: 'sys',
      input: [{ role: 'user', content: 'hi' }],
      max_output_tokens: 1000,
      store: false,
      reasoning: { effort: 'high' },
    });
  });

  it('splits cached input and reports reasoning tokens', async () => {
    const { calls, transport } = recorder(ok);
    const res = await openaiAdapter('k-oa', transport).chat(req({ model: MODEL }));
    expect(res.text).toBe('done');
    expect(res.usage).toEqual({ input: 200, cachedInput: 100, output: 80, reasoning: 60 });
    expect(res.stopReason).toBe('end');
    expect(calls[0]?.headers.authorization).toBe('Bearer k-oa');
  });

  it('detects truncation and refusal', async () => {
    const trunc = recorder({ ...ok, status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } });
    expect((await openaiAdapter('k', trunc.transport).chat(req({ model: MODEL }))).stopReason).toBe('max_tokens');
    const refusal = recorder({ ...ok, output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] });
    expect((await openaiAdapter('k', refusal.transport).chat(req({ model: MODEL }))).stopReason).toBe('refusal');
  });
});
