import type { Channel } from '@tauri-apps/api/core';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, expect, test } from 'vitest';
import { fetchScan } from '../scanStream';

afterEach(() => {
  clearMocks();
});

// Delivers a channel message the way the Tauri runtime does: { index, message }.
function deliver(channel: Channel<ArrayBuffer>, index: number, bytes: number[]) {
  const internals = (window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void } })
    .__TAURI_INTERNALS__;
  internals.runCallback(channel.id, { index, message: new Uint8Array(bytes).buffer });
}

test('assembles streamed chunks in order', async () => {
  mockIPC((cmd, args) => {
    if (cmd !== 'stream_scan') throw new Error(`unexpected ${cmd}`);
    const { onChunk } = args as { onChunk: Channel<ArrayBuffer> };
    deliver(onChunk, 0, [1, 2, 3]);
    deliver(onChunk, 1, [4, 5]);
    return { bytes: 5, chunks: 2 };
  });
  const data = await fetchScan('core-7.scan', 1024);
  expect([...data]).toEqual([1, 2, 3, 4, 5]);
});
