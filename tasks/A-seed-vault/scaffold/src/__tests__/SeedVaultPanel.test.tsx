import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { SeedVaultPanel } from '../SeedVaultPanel';

afterEach(() => {
  cleanup();
  clearMocks();
});

test('loads and shows lots', async () => {
  mockIPC((cmd) => {
    if (cmd === 'list_lots') return [{ code: 'TOM-0042', grams: 120 }];
    throw new Error(`unexpected command ${cmd}`);
  });
  render(<SeedVaultPanel />);
  expect(screen.getByText('Loading lots…')).toBeTruthy();
  expect(await screen.findByText('TOM-0042')).toBeTruthy();
  expect(screen.getByText('120 g')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Withdraw 10 g from TOM-0042' })).toBeTruthy();
});
