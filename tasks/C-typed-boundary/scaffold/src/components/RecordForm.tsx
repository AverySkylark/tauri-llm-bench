import { invoke } from '@tauri-apps/api/core';
import { useState } from 'react';

export function RecordForm({ siteId, now }: { siteId: number; now: () => string }) {
  const [species, setSpecies] = useState('');
  const [count, setCount] = useState('1');
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: any) {
    e.preventDefault();
    try {
      const saved: any = await invoke('record_observation', {
        input: { site_id: siteId, species, count, observed_at: now(), notes: notes || null },
      });
      setMessage(`Saved observation #${saved.id}`);
    } catch (err: any) {
      setMessage(`Could not save: ${err}`);
    }
  }

  return (
    <form onSubmit={submit}>
      <label>
        Species <input value={species} onChange={(e) => setSpecies(e.target.value)} />
      </label>
      <label>
        Count <input type="number" value={count} onChange={(e) => setCount(e.target.value)} />
      </label>
      <label>
        Notes <input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <button type="submit">Save</button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
