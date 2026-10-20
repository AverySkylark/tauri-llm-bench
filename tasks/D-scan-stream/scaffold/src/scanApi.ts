import { invoke } from '@tauri-apps/api/core';

/** Loads a whole scan through `read_scan` (a JSON array of numbers). */
export async function readScan(name: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>('read_scan', { name });
  return Uint8Array.from(bytes);
}
