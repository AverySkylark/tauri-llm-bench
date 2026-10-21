import { emit } from '@tauri-apps/api/event';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { SensorDashboard } from '../SensorDashboard';
import { READING_EVENT } from '../types';

afterEach(() => {
  cleanup();
  clearMocks();
});

test('shows a reading', async () => {
  mockIPC(() => undefined, { shouldMockEvents: true });
  render(<SensorDashboard />);
  // Let the listeners register before emitting.
  await act(async () => {
    await new Promise<void>((r) => {
      setTimeout(r, 0);
    });
  });
  await act(async () => {
    await emit(READING_EVENT, { sensor: 'bench-a', celsius: 21.5 });
  });
  await waitFor(() => {
    expect(screen.getByTestId('reading-count').textContent).toBe('1 readings');
  });
  expect(screen.getByText('bench-a: 21.5 °C')).toBeTruthy();
});
