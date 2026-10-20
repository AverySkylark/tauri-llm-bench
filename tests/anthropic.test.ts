import { describe, expect, it } from 'vitest';
import { anthropicAdapter, buildAnthropicBody } from '../adapters/anthropic.ts';
import { fakeTransport } from '../adapters/fake.ts';
import { AdapterError } from '../adapters/types.ts';
import { recorder, req } from './helpers.ts';

const ok = {
  content: [
    { type: 'thinking', thinking: '', signature: 's' },
    { type: 'text', text: 'Hello ' },
    { type: 'text', text: 'world' },
  ],
  stop_reason: 'end_turn',
  usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20, cache_creation_input_tokens: 0 },
};

describe('anthropic adapter', () => {
  it('builds the request with effort fields and no temperature by default', () => {
    expect(buildAnthropicBody(req({ effort: 'medium' }))).toEqual({
      model: 'claude-haiku-5-5',
      max_tokens: 1000,
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
    });
  });

  it('sends temperature only when the matrix sets a number', () => {
    expect(buildAnthropicBody(req({ temperature: 0.2 })).temperature).toBe(0.2);
  });

  it('replays assistant native content blocks unchanged', () => {
    const native = [{ type: 'thinking', thinking: '', signature: 'abc' }, { type: 'text', text: 'prev' }];
    const body = buildAnthropicBody(
      req({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'prev', native }, { role: 'user', content: 'b' }] }),
    );
    expect((body.messages as unknown[])[1]).toEqual({ role: 'assistant', content: native });
  });

  it('parses text, usage and stop reason; sends benchmark key headers', async () => {
    const { calls, transport } = recorder(ok);
    const res = await anthropicAdapter('k-test', transport).chat(req());
    expect(res.text).toBe('Hello world');
    expect(res.stopReason).toBe('end');
    expect(res.usage).toEqual({ input: 100, cachedInput: 20, output: 50, reasoning: null });
    expect(res.effortNative).toEqual({ param: 'thinking.type+output_config.effort', value: 'adaptive/low' });
    expect(res.temperatureSent).toBeNull();
    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0]?.headers['x-api-key']).toBe('k-test');
    expect(calls[0]?.headers['anthropic-version']).toBe('2023-06-01');
  });

  it.each([
    ['max_tokens', 'max_tokens'],
    ['refusal', 'refusal'],
    ['pause_turn', 'other'],
  ])('maps stop_reason %s -> %s', async (native, expected) => {
    const { transport } = recorder({ ...ok, stop_reason: native });
    expect((await anthropicAdapter('k', transport).chat(req())).stopReason).toBe(expected);
  });

  it('raises retryable errors for 429/5xx and non-retryable for 400', async () => {
    for (const [status, retryable] of [[429, true], [529, true], [400, false]] as const) {
      const { transport } = recorder({ error: {} }, status);
      const err = await anthropicAdapter('k', transport).chat(req()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AdapterError);
      expect((err as AdapterError).retryable).toBe(retryable);
      expect((err as AdapterError).status).toBe(status);
    }
  });

  it('times out as a retryable timeout error', async () => {
    const err = await anthropicAdapter('k', fakeTransport('anthropic', { latencyMs: 200 }))
      .chat(req({ timeoutMs: 20 }))
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'timeout', retryable: true });
  });

  it('rejects unsupported efforts before any network call', async () => {
    const { calls, transport } = recorder(ok);
    await expect(anthropicAdapter('k', transport).chat(req({ model: 'claude-opus-5-5', effort: 'none' }))).rejects.toMatchObject({
      kind: 'unsupported',
    });
    expect(calls).toHaveLength(0);
  });
});
