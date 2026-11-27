'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { InboxChannelTabs } from './inbox-channel-tabs';
import type { InboxChannelFilter } from '@/lib/inbox/instagram';
import { cn } from '@/lib/utils';
type Group = {
  group_jid: string;
  subject: string;
  last_message_at: string | null;
  participant_count: number;
};
type Message = {
  id: string;
  participant_name: string | null;
  content_text: string;
  message_type: string;
  from_me: boolean;
  created_at: string;
};
export function GroupInbox({
  onChannelChange,
}: {
  onChannelChange: (value: InboxChannelFilter) => void;
}) {
  const { accountId } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]),
    [selected, setSelected] = useState<Group | null>(null),
    [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState(''),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!accountId) return;
    const db = createClient();
    const result = await db
      .from('whatsapp_groups')
      .select('group_jid,subject,last_message_at,participant_count')
      .eq('account_id', accountId)
      .order('last_message_at', { ascending: false, nullsFirst: false });
    if (result.error) setError('Não foi possível carregar os grupos.');
    else {
      setError('');
      setGroups(result.data ?? []);
    }
    setLoading(false);
  }, [accountId]);
  useEffect(() => {
    // Initial account-scoped database fetch, not derived render state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  useEffect(() => {
    if (!accountId || !selected) return;
    let cancelled = false;
    const db = createClient();
    const read = async () => {
      const result = await db
        .from('group_messages')
        .select(
          'id,participant_name,content_text,message_type,from_me,created_at'
        )
        .eq('account_id', accountId)
        .eq('group_jid', selected.group_jid)
        .order('created_at', { ascending: false })
        .limit(100);
      if (cancelled) return;
      if (result.error) setError('Não foi possível carregar as mensagens.');
      else setMessages((result.data ?? []).reverse());
    };
    void read();
    const timer = setInterval(() => void read(), 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [accountId, selected, loading]);
  return (
    <div className="-m-4 flex h-[calc(100dvh-3.5rem)] min-h-0 overflow-hidden sm:-m-6">
      <aside
        className={cn(
          'bg-card flex min-h-0 w-full shrink-0 flex-col border-r lg:w-80',
          selected && 'hidden lg:flex'
        )}
      >
        <div className="space-y-2 border-b p-3">
          <InboxChannelTabs value="groups" onChange={onChannelChange} />
          <div className="flex gap-2">
            <input
              aria-label="Pesquisar grupos"
              placeholder="Pesquisar grupos…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-muted min-w-0 flex-1 rounded-md border p-2 text-sm"
            />
            <button
              title="Atualizar grupos"
              aria-label="Atualizar grupos"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                void load();
              }}
              className="rounded-md border p-2"
            >
              <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-destructive p-3 text-sm">
            {error}
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups
            .filter((g) =>
              g.subject.toLowerCase().includes(search.toLowerCase())
            )
            .map((group) => (
              <button
                key={group.group_jid}
                onClick={() => {
                  setMessages([]);
                  setSelected(group);
                }}
                className={cn(
                  'hover:bg-muted flex w-full gap-3 p-4 text-left',
                  selected?.group_jid === group.group_jid && 'bg-primary/10'
                )}
              >
                <Users className="bg-muted size-9 shrink-0 rounded-full p-2" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {group.subject}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {group.participant_count} participantes
                  </p>
                </div>
              </button>
            ))}
          {!loading && !groups.length && (
            <p className="text-muted-foreground p-4 text-sm">
              Nenhum grupo sincronizado. Atualize a lista no painel Grupos.
            </p>
          )}
        </div>
      </aside>
      <main
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col',
          !selected && 'hidden lg:flex'
        )}
      >
        {selected ? (
          <>
            <header className="bg-card flex shrink-0 items-center gap-3 border-b p-3">
              <button
                aria-label="Voltar aos grupos"
                className="lg:hidden"
                onClick={() => setSelected(null)}
              >
                <ArrowLeft className="size-4" />
              </button>
              <Users className="size-5" />
              <h2 className="truncate text-sm font-semibold">
                {selected.subject}
              </h2>
            </header>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    'flex',
                    message.from_me ? 'justify-end' : 'justify-start'
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[85%] rounded-xl p-3 text-sm',
                      message.from_me
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    )}
                  >
                    <p className="mb-1 text-xs font-medium">
                      {message.from_me
                        ? 'Você'
                        : message.participant_name || 'Participante'}
                    </p>
                    <p className="break-words whitespace-pre-wrap">
                      {message.content_text || `[${message.message_type}]`}
                    </p>
                    <time className="mt-1 block text-right text-[10px] opacity-70">
                      {new Date(message.created_at).toLocaleString('pt-BR')}
                    </time>
                  </div>
                </div>
              ))}
              {!messages.length && (
                <p className="text-muted-foreground text-sm">
                  Sem mensagens registradas para este grupo.
                </p>
              )}
            </div>
            <p className="text-muted-foreground shrink-0 border-t p-3 text-xs">
              Histórico disponível a partir da ativação do monitoramento de
              grupos.
            </p>
          </>
        ) : (
          <p className="text-muted-foreground m-auto text-sm">
            Selecione um grupo para visualizar as mensagens.
          </p>
        )}
      </main>
    </div>
  );
}
