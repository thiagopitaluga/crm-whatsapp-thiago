'use client';
import { useEffect, useState } from 'react';
type Contact = { id: string; name: string | null; phone: string | null };
export function InstagramContactLink({
  conversationId,
  contactId,
  onChange,
}: {
  conversationId: string;
  contactId: string | null;
  onChange: (id: string | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setQuery('');
    setContacts([]);
    setError('');
  }, [conversationId]);
  async function search(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const r = await fetch(
        '/api/instagram/contacts?q=' + encodeURIComponent(query)
      );
      if (!r.ok) throw new Error('Não foi possível buscar contatos.');
      setContacts((await r.json()).contacts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha na busca.');
    }
  }
  async function link(id: string | null) {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/instagram/conversations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, contactId: id }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Não foi possível vincular.');
      onChange(id);
      setContacts([]);
      setQuery('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao vincular.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="border-border mb-4 rounded-lg border p-3 text-sm">
      <p className="font-medium">Contato do CRM</p>
      {contactId ? (
        <div className="mt-2 flex items-center gap-3">
          <span>Contato vinculado ao CRM</span>
          <button type="button" disabled={busy} onClick={() => void link(null)}>
            Desvincular
          </button>
        </div>
      ) : (
        <>
          <form onSubmit={search} className="mt-2 flex gap-2">
            <input
              aria-label="Buscar contato do CRM"
              className="border-border bg-background min-w-0 flex-1 rounded border p-2"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nome ou telefone"
            />
            <button disabled={query.trim().length < 2}>Buscar</button>
          </form>
          <ul>
            {contacts.map((c) => (
              <li
                key={c.id}
                className="border-border flex items-center justify-between gap-2 border-t py-2"
              >
                <span>
                  {c.name || 'Sem nome'} · {c.phone || 'Sem telefone'}
                </span>
                <button disabled={busy} onClick={() => void link(c.id)}>
                  Vincular
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && (
        <p role="alert" className="text-destructive mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
