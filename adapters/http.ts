import { AdapterError, type Transport } from './types.ts';

export async function postJson(
  transport: Transport,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<{ json: unknown; latencyMs: number }> {
  const started = performance.now();
  let res: Response;
  try {
    res = await transport(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new AdapterError('timeout', `Request timed out after ${timeoutMs} ms`);
    }
    throw new AdapterError('http', `Network error: ${(err as Error).message}`);
  }
  const text = await res.text();
  const latencyMs = Math.round(performance.now() - started);
  if (!res.ok) {
    throw new AdapterError('http', `HTTP ${res.status}: ${text.slice(0, 500)}`, res.status);
  }
  try {
    return { json: JSON.parse(text), latencyMs };
  } catch {
    throw new AdapterError('parse', `Invalid JSON response: ${text.slice(0, 200)}`);
  }
}

export function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
