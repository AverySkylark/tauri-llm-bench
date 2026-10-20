import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

export function ObservationList({ siteId, since }: { siteId: number; since?: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke('list_observations', { site_id: siteId, since: since ?? null })
      .then((r: any) => setRows(r))
      .catch(() => setError('Could not load observations'));
  }, [siteId, since]);

  if (error) return <p role="alert">{error}</p>;
  return (
    <ul aria-label="Observations">
      {rows.map((o: any) => (
        <li key={o.id}>
          {o.species} × {o.count} ({o.observedAt}){o.notes ? ` — ${o.notes}` : ''}
        </li>
      ))}
    </ul>
  );
}
