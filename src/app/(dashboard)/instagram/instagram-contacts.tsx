'use client';
import { useEffect, useState } from 'react';
type Contact = {
  id: string;
  instagram_user_id: string;
  last_message_at: string;
  channel_id: string;
  tags?: string[];
  profile_data?: { username?: string; displayName?: string };
};
export function InstagramContacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/instagram/conversations', { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error('Não foi possível carregar os contatos.');
        return r.json();
      })
      .then((d) => setContacts(d.conversations))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  const filtered = contacts.filter((contact) =>
    [
      contact.instagram_user_id,
      contact.profile_data?.username,
      contact.profile_data?.displayName,
      ...(contact.tags || []),
    ].some((s) =>
      s
        ?.toLocaleLowerCase('pt-BR')
        .includes(query.trim().toLocaleLowerCase('pt-BR'))
    )
  );
  return (
    <section className="border-border bg-card space-y-4 rounded-xl border p-5">
      <h2 className="font-semibold">Contatos do Instagram</h2>
      <p className="text-muted-foreground text-sm">
        Pessoas que enviaram mensagem, identificadas pelo perfil e canal. Os
        atributos disponíveis na Meta são usados nas condições dos fluxos.
      </p>
      <label className="text-sm">
        Buscar por identificador
        <input
          className="border-border bg-background mt-1 block w-full max-w-sm rounded-lg border p-2"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : filtered.length ? (
        <ul className="divide-border divide-y">
          {filtered.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap justify-between gap-2 py-3 text-sm"
            >
              <span>
                {c.profile_data?.displayName ||
                  c.profile_data?.username ||
                  `Instagram · ${c.instagram_user_id}`}
                <small className="text-muted-foreground block">
                  {(c.tags || []).join(' · ')}
                </small>
              </span>
              <span className="text-muted-foreground">
                Última mensagem:{' '}
                {new Date(c.last_message_at).toLocaleString('pt-BR')}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">
          Nenhum contato encontrado.
        </p>
      )}
      <p className="text-muted-foreground text-xs">
        Exibindo até 200 conversas recentes.
      </p>
    </section>
  );
}
