'use client';
import { useState } from 'react';
export function InstagramConversationStatus({
  conversationId,
  status,
  onChange,
}: {
  conversationId: string;
  status: string;
  onChange: (status: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function change(value: string) {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/instagram/conversations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, status: value }),
      });
      const result = await r.json();
      if (!r.ok)
        throw new Error(result.error || 'Não foi possível alterar a conversa.');
      onChange(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao alterar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="border-border mb-3 flex flex-wrap items-center gap-2 border-b pb-3">
      <label className="text-sm">
        Atendimento{' '}
        <select
          aria-label="Status da conversa do Instagram"
          className="border-border bg-background ml-2 rounded-lg border p-2"
          disabled={busy}
          value={status}
          onChange={(e) => void change(e.target.value)}
        >
          <option value="open">Aberto · automações permitidas</option>
          <option value="human">Humano · automações pausadas</option>
          <option value="closed">Encerrado</option>
        </select>
      </label>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
