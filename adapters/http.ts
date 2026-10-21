import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { AdapterError, type Transport } from './types.ts';

// Real transport for live calls. Not global fetch: its HTTP client gives up waiting for response
// headers after 300 s, and a non-streaming reply sends no headers until the whole answer is
// generated. That surfaces as a network error, which would be retried and billed again.
// node:http has no such limit; the only deadline is the caller's AbortSignal.
export const nodeTransport: Transport = (url, init) =>
  new Promise((resolve, reject) => {
    const u = new URL(url);
    const send = u.protocol === 'http:' ? httpRequest : httpsRequest;
    const req = send(
      u,
      { method: init.method ?? 'GET', headers: init.headers as Record<string, string>, signal: init.signal ?? undefined },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 0 })));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(typeof init.body === 'string' ? init.body : undefined);
  });

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
