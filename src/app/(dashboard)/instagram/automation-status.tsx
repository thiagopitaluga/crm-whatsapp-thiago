'use client';
import { useEffect, useState } from 'react';
type Channel = { id: string; username: string };
export function AutomationStatus({
  id,
  active,
  channelId,
  locked,
  onUpdate,
}: {
  id: string;
  active: boolean;
  channelId: string | null;
  locked: boolean;
  onUpdate: (active: boolean, channelId: string | null) => void;
}) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState(channelId || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    fetch('/api/instagram/channels', { signal: c.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setChannels(d.channels))
      .catch(() => {
        if (!c.signal.aborted) setError('Não foi possível carregar os perfis.');
      });
    return () => c.abort();
  }, []);
  async function update() {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/instagram/automations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, active: !active, channelId: selected }),
      });
      const data = await r.json();
      if (!r.ok)
        throw new Error(data.error || 'Não foi possível alterar a automação.');
      onUpdate(data.automation.is_active, data.automation.channel_id);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Não foi possível alterar a automação.'
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <select
        aria-label="Perfil para automação"
        disabled={active || busy || locked}
        className="border-border bg-background rounded border p-2 text-sm"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        <option value="">Selecione um perfil</option>
        {channels.map((c) => (
          <option key={c.id} value={c.id}>
            @{c.username}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy || (!active && !selected)}
        onClick={() => void update()}
        className="border-border rounded border px-3 py-2 text-sm disabled:opacity-50"
      >
        {active ? 'Pausar' : 'Ativar'}
      </button>
      {error && (
        <span role="alert" className="text-destructive text-sm">
          {error}
        </span>
      )}
    </div>
  );
}
