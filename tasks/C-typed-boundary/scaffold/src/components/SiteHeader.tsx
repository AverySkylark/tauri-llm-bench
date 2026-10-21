import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

export function SiteHeader({ siteId }: { siteId: number }) {
  const [site, setSite] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke('get_site', { site_id: siteId })
      .then((s: any) => setSite(s))
      .catch(() => setError('Could not load site'));
  }, [siteId]);

  if (error) return <p role="alert">{error}</p>;
  if (!site) return <p>Loading site…</p>;
  return (
    <header>
      <h2>{site.name}</h2>
      <p>
        {site.habitat} · {site.coordinates.lat.toFixed(3)}, {site.coordinates.lon.toFixed(3)}
        {site.active ? '' : ' · inactive'}
      </p>
    </header>
  );
}
