import type { ChatRequest, Transport } from '../adapters/types.ts';

export function req(over: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: 'claude-haiku-5-5',
    system: 'sys',
    messages: [{ role: 'user', content: 'hi' }],
    effort: 'low',
    maxOutputTokens: 1000,
    temperature: 'provider_default',
    timeoutMs: 5000,
    ...over,
  };
}

// Transport that records the request and replies with a fixed JSON body/status.
export function recorder(json: unknown, status = 200) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const transport: Transport = async (url, init) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(json), { status });
  };
  return { calls, transport };
}
