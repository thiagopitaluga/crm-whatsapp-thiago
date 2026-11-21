'use client';
import { useEffect, useState } from 'react';
import { InstagramContactLink } from './instagram-contact-link';
type Conversation = {
  id: string;
  instagram_user_id: string;
  last_message_at: string;
  contact_id: string | null;
};
type Message = {
  id: string;
  direction: string;
  body: string;
  created_at: string;
};
export function InstagramConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/instagram/conversations', { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error('Não foi possível carregar as conversas.');
        return r.json();
      })
      .then((d) => setConversations(d.conversations))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    fetch(
      '/api/instagram/conversations?conversation=' +
        encodeURIComponent(selected),
      { signal: controller.signal }
    )
      .then(async (r) => {
        if (!r.ok) throw new Error('Não foi possível carregar as mensagens.');
        return r.json();
      })
      .then((d) => setMessages(d.messages))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [selected]);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await fetch('/api/instagram/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: selected, text }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao enviar.');
      setMessages((previous) => [
        ...previous,
        {
          id: crypto.randomUUID(),
          direction: 'outbound',
          body: text,
          created_at: new Date().toISOString(),
        },
      ]);
      setText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao enviar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="border-border bg-card grid min-h-96 overflow-hidden rounded-xl border md:grid-cols-[240px_1fr]">
      <div className="border-border space-y-1 border-r p-3">
        <h2 className="p-2 font-semibold">Conversas</h2>
        {conversations.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setSelected(c.id);
              setMessages([]);
            }}
            className={`w-full rounded-lg p-3 text-left text-sm ${selected === c.id ? 'bg-muted' : 'hover:bg-muted/50'}`}
          >
            <span>Contato {c.instagram_user_id}</span>
            <small className="text-muted-foreground block">
              {new Date(c.last_message_at).toLocaleString('pt-BR')}
            </small>
          </button>
        ))}
        {!conversations.length && (
          <p className="text-muted-foreground p-2 text-sm">
            Nenhuma conversa recebida.
          </p>
        )}
      </div>
      <div className="flex min-h-96 flex-col p-4">
        {selected ? (
          <>
            <InstagramContactLink
              conversationId={selected}
              contactId={
                conversations.find((c) => c.id === selected)?.contact_id ?? null
              }
              onChange={(id) =>
                setConversations((previous) =>
                  previous.map((c) =>
                    c.id === selected ? { ...c, contact_id: id } : c
                  )
                )
              }
            />
            <div className="flex-1 space-y-2">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[80%] rounded-lg p-3 text-sm ${m.direction === 'outbound' ? 'bg-primary text-primary-foreground ml-auto' : 'bg-muted'}`}
                >
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <small>
                    {new Date(m.created_at).toLocaleString('pt-BR')}
                  </small>
                </div>
              ))}
            </div>
            <form onSubmit={send} className="mt-4 flex gap-2">
              <input
                className="border-border bg-background min-w-0 flex-1 rounded-lg border p-2"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={1000}
                placeholder="Escreva uma mensagem"
              />
              <button
                disabled={busy || !text.trim()}
                className="bg-primary text-primary-foreground rounded-lg px-4 disabled:opacity-50"
              >
                Enviar
              </button>
            </form>
          </>
        ) : (
          <p className="text-muted-foreground m-auto text-sm">
            Selecione uma conversa.
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive mt-2 text-sm">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
