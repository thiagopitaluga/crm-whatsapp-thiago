'use client';
import { useEffect, useState } from 'react';
type Channel = { id: string; username: string };
type Media = { id: string; caption: string; type: string };
export function InstagramMediaPicker({
  channel,
  media,
  onChannel,
  onMedia,
}: {
  channel: string;
  media: string;
  onChannel: (value: string) => void;
  onMedia: (value: string) => void;
}) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [posts, setPosts] = useState<Media[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    fetch('/api/instagram/channels', { signal: c.signal })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((d) => setChannels(d.channels))
      .catch(() => {
        if (!c.signal.aborted) setError('Não foi possível carregar os perfis.');
      });
    return () => c.abort();
  }, []);
  useEffect(() => {
    if (!channel) {
      setPosts([]);
      return;
    }
    const c = new AbortController();
    setLoading(true);
    setError('');
    fetch('/api/instagram/media?channel=' + encodeURIComponent(channel), {
      signal: c.signal,
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok)
          throw new Error(data.error || 'Erro ao carregar publicações.');
        return data;
      })
      .then((d) => setPosts(d.media))
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [channel]);
  const field =
    'border-border bg-background w-full rounded-lg border px-3 py-2';
  return (
    <div className="space-y-3 md:col-span-2">
      <label className="block space-y-1 text-sm">
        Perfil para selecionar publicação
        <select
          className={field}
          value={channel}
          onChange={(e) => {
            onChannel(e.target.value);
            onMedia('');
          }}
        >
          <option value="">Selecione um perfil</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              @{c.username}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-sm">
        Publicação
        <select
          className={field}
          value={media}
          disabled={!channel || loading}
          onChange={(e) => onMedia(e.target.value)}
        >
          <option value="">Todas as publicações</option>
          {posts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.type} · {p.caption.slice(0, 90)}
            </option>
          ))}
        </select>
      </label>
      <p className="text-muted-foreground text-xs">
        São exibidas até 50 publicações recentes do perfil.
      </p>
      {loading && <p className="text-sm">Carregando publicações...</p>}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
