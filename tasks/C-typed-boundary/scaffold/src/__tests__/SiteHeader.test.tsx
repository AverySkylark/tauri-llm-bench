import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { SiteHeader } from '../components/SiteHeader';

afterEach(() => {
  cleanup();
  clearMocks();
});

test('loads the site with the argument names Tauri expects', async () => {
  const calls: unknown[] = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args });
    return { id: 7, name: 'North marsh', habitat: 'wetland', coordinates: { lat: 52.1, lon: 4.3 }, active: true };
  });
  render(<SiteHeader siteId={7} />);
  expect(await screen.findByText('North marsh')).toBeTruthy();
  expect(calls).toEqual([{ cmd: 'get_site', args: { siteId: 7 } }]);
});
