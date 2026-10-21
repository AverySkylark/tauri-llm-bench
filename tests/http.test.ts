import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nodeTransport, postJson } from '../adapters/http.ts';

// The server holds the response headers back, like a non-streaming model reply does.
let server: Server;
let base = '';
beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const delay = Number(new URL(req.url!, 'http://x').searchParams.get('delay') ?? 0);
      setTimeout(() => {
        res.writeHead(req.url!.startsWith('/fail') ? 529 : 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ echo: JSON.parse(body), auth: req.headers['x-api-key'] ?? null }));
      }, delay);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('nodeTransport', () => {
  it('posts JSON with headers and waits for late response headers', async () => {
    const { json } = await postJson(nodeTransport, `${base}/ok?delay=300`, { 'x-api-key': 'k' }, { a: 1 }, 5000);
    expect(json).toEqual({ echo: { a: 1 }, auth: 'k' });
  });

  it('the caller timeout still applies and is reported as a timeout, not a network error', async () => {
    await expect(postJson(nodeTransport, `${base}/ok?delay=2000`, {}, {}, 200)).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('passes HTTP errors through with their status', async () => {
    await expect(postJson(nodeTransport, `${base}/fail`, {}, {}, 5000)).rejects.toMatchObject({ kind: 'http', status: 529, retryable: true });
  });
});
