'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  RefreshCw,
  Users,
  Archive,
  ArchiveRestore,
  Download,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { enUS, ptBR } from 'date-fns/locale';
import { useLocale } from 'next-intl';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { InboxChannelTabs } from './inbox-channel-tabs';
import type { InboxChannelFilter } from '@/lib/inbox/instagram';
import { cn } from '@/lib/utils';
import { canSendMessages } from '@/lib/auth/roles';
import { canEditSettings } from '@/lib/auth/roles';
import { GroupComposer } from './group-composer';
type Group = {
  group_jid: string;
  subject: string;
  last_message_at: string | null;
  participant_count: number;
  is_admin: boolean;
  announcement: boolean | null;
  archived_at: string | null;
  last_message_preview: string | null;
  last_message_from_me: boolean | null;
};
type Message = {
  id: string;
  participant_name: string | null;
  content_text: string;
  message_type: string;
  from_me: boolean;
  created_at: string;
  media_url: string | null;
};
type GroupFilter = 'all' | 'admin' | 'archived' | 'open' | 'allowed';

function GroupAvatar({
  jid,
  className = 'size-9',
}: {
  jid: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={cn(
        'bg-muted relative flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        className
      )}
    >
      <Users className="text-muted-foreground size-1/2" />
      {!failed && (
        <img
          loading="lazy"
          src={`/api/whatsapp/groups/avatar?jid=${encodeURIComponent(jid)}`}
          alt=""
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
export function GroupInbox({
  onChannelChange,
}: {
  onChannelChange: (value: InboxChannelFilter) => void;
}) {
  const { accountId, accountRole } = useAuth();
  const locale = useLocale();
  const [groups, setGroups] = useState<Group[]>([]),
    [selected, setSelected] = useState<Group | null>(null),
    [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState(''),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [messageRefresh, setMessageRefresh] = useState(0);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [filter, setFilter] = useState<GroupFilter>('all');
  const [exporting, setExporting] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollToLatestRef = useRef(false);
  const load = useCallback(async () => {
    if (!accountId) return;
    const db = createClient();
    const result = await db
      .from('whatsapp_groups')
      .select(
        'group_jid,subject,last_message_at,last_message_preview,last_message_from_me,participant_count,is_admin,announcement,archived_at'
      )
      .eq('account_id', accountId)
      .order('last_message_at', { ascending: false, nullsFirst: false });
    if (result.error) setError('Não foi possível carregar os grupos.');
    else {
      setError('');
      setGroups(result.data ?? []);
    }
    setLoading(false);
  }, [accountId]);
  async function syncGroups() {
    setLoading(true);
    try {
      const response = await fetch('/api/whatsapp/groups', {
        cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || 'Falha ao sincronizar grupos.');
      if (data.warning) toast.info(data.warning);
      await load();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'Falha ao atualizar grupos.'
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (!accountId || !selected) return;
    let cancelled = false;
    const db = createClient();
    const read = async () => {
      const result = await db
        .from('group_messages')
        .select(
          'id,participant_name,content_text,message_type,from_me,created_at,media_url'
        )
        .eq('account_id', accountId)
        .eq('group_jid', selected.group_jid)
        .order('created_at', { ascending: false })
        .limit(100);
      if (cancelled) return;
      if (result.error) setError('Não foi possível carregar as mensagens.');
      else setMessages((result.data ?? []).reverse());
      setLoadingMessages(false);
    };
    void read();
    const timer = setInterval(() => void read(), 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [accountId, selected, messageRefresh]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !messages.length) return;
    if (
      scrollToLatestRef.current ||
      element.scrollHeight - element.scrollTop - element.clientHeight < 140
    ) {
      element.scrollTop = element.scrollHeight;
      scrollToLatestRef.current = false;
    }
  }, [messages]);

  async function toggleArchive(group: Group) {
    setArchiving(group.group_jid);
    try {
      const archived = !group.archived_at;
      const response = await fetch('/api/whatsapp/groups/archive', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupJid: group.group_jid, archived }),
      });
      if (!response.ok)
        throw new Error('Não foi possível alterar o arquivo do grupo.');
      setGroups((current) =>
        current.map((item) =>
          item.group_jid === group.group_jid
            ? {
                ...item,
                archived_at: archived ? new Date().toISOString() : null,
              }
            : item
        )
      );
      if (archived && selected?.group_jid === group.group_jid)
        setSelected(null);
      toast.success(archived ? 'Grupo arquivado.' : 'Grupo restaurado.');
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'Falha ao arquivar grupo.'
      );
    } finally {
      setArchiving(null);
    }
  }

  async function exportParticipants(group: Group) {
    setExporting(group.group_jid);
    try {
      const response = await fetch('/api/whatsapp/groups/participants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ group_jid: group.group_jid }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          payload?.error ?? 'Não foi possível exportar os contatos.'
        );
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `participantes-${
        group.subject
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-zA-Z0-9-]+/g, '-')
          .slice(0, 45) || 'grupo'
      }.csv`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      const unavailable = Number(
        response.headers.get('x-unavailable-phones') ?? 0
      );
      toast.success(
        unavailable
          ? `Lista exportada. ${unavailable} participante(s) sem telefone disponível.`
          : 'Contatos exportados.'
      );
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'Falha ao exportar contatos.'
      );
    } finally {
      setExporting(null);
    }
  }
  function groupMatches(group: Group) {
    if (!group.subject.toLowerCase().includes(search.toLowerCase()))
      return false;
    if (filter === 'archived') return Boolean(group.archived_at);
    if (group.archived_at) return false;
    if (filter === 'admin') return group.is_admin;
    if (filter === 'open') return group.announcement === false;
    if (filter === 'allowed')
      return group.is_admin || group.announcement === false;
    return true;
  }
  function timeAgo(value: string | null) {
    return value
      ? formatDistanceToNow(new Date(value), {
          locale: locale === 'pt-BR' ? ptBR : enUS,
        })
      : '';
  }
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
              onClick={() => void syncGroups()}
              className="rounded-md border p-2"
            >
              <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
            </button>
          </div>
          <div aria-label="Filtrar grupos" className="flex flex-wrap gap-1.5">
            {(
              [
                ['all', 'Todos'],
                ['admin', 'Sou adm'],
                ['archived', 'Arquivados'],
                ['open', 'Abertos'],
                ['allowed', 'Posso enviar'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  'min-h-8 rounded-full border px-2.5 text-xs transition-colors',
                  filter === value
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {error && (
          <p role="alert" className="text-destructive p-3 text-sm">
            {error}
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups.filter(groupMatches).map((group) => (
            <div
              key={group.group_jid}
              className={cn(
                'hover:bg-muted flex w-full items-center gap-1 pr-2',
                selected?.group_jid === group.group_jid && 'bg-primary/10'
              )}
            >
              <button
                type="button"
                onClick={() => {
                  setMessages([]);
                  setLoadingMessages(true);
                  scrollToLatestRef.current = true;
                  setSelected(group);
                }}
                className="flex min-w-0 flex-1 items-center gap-2.5 p-3 text-left"
              >
                <GroupAvatar jid={group.group_jid} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {group.subject}
                    </span>
                    <time className="text-muted-foreground shrink-0 text-[10px]">
                      {timeAgo(group.last_message_at)}
                    </time>
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {group.last_message_preview
                      ? `${group.last_message_from_me ? 'Você: ' : ''}${group.last_message_preview}`
                      : `${group.participant_count} participantes${group.is_admin ? ' · Administrador' : ''}`}
                  </span>
                </span>
              </button>
              {accountRole && canSendMessages(accountRole) && (
                <button
                  type="button"
                  disabled={archiving === group.group_jid}
                  onClick={() => void toggleArchive(group)}
                  title={
                    group.archived_at ? 'Restaurar grupo' : 'Arquivar grupo'
                  }
                  aria-label={`${group.archived_at ? 'Restaurar' : 'Arquivar'} ${group.subject}`}
                  className="text-muted-foreground hover:text-primary rounded p-1 disabled:opacity-50"
                >
                  {group.archived_at ? (
                    <ArchiveRestore className="size-4" />
                  ) : (
                    <Archive className="size-4" />
                  )}
                </button>
              )}
              {accountRole &&
                canEditSettings(accountRole) &&
                group.is_admin && (
                  <button
                    type="button"
                    disabled={exporting === group.group_jid}
                    onClick={() => void exportParticipants(group)}
                    title="Exportar contatos do grupo"
                    aria-label={`Exportar contatos de ${group.subject}`}
                    className="text-muted-foreground hover:text-primary rounded p-1 disabled:opacity-50"
                  >
                    <Download className="size-4" />
                  </button>
                )}
            </div>
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
              <GroupAvatar jid={selected.group_jid} className="size-8" />
              <h2 className="truncate text-sm font-semibold">
                {selected.subject}
              </h2>
            </header>
            <div
              ref={scrollRef}
              className="min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto p-4"
            >
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
                      'max-w-[85%] min-w-0 overflow-hidden rounded-xl p-3 text-sm',
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
                    {message.media_url && message.message_type === 'image' && (
                      <img
                        src={message.media_url}
                        alt="Imagem enviada"
                        loading="lazy"
                        className="mb-1 max-h-72 max-w-full rounded object-contain"
                      />
                    )}
                    {message.media_url && message.message_type === 'video' && (
                      <video
                        src={message.media_url}
                        controls
                        preload="metadata"
                        className="mb-1 max-h-72 max-w-full rounded"
                      />
                    )}
                    {message.media_url && message.message_type === 'audio' && (
                      <audio
                        src={message.media_url}
                        controls
                        preload="metadata"
                        className="mb-1 max-w-full"
                      />
                    )}
                    {message.media_url &&
                      message.message_type === 'document' && (
                        <a
                          href={message.media_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mb-1 block break-all underline"
                        >
                          Abrir documento
                        </a>
                      )}
                    {message.content_text &&
                      !/^\[(image|video|audio|document)\]$/.test(
                        message.content_text
                      ) && (
                        <p className="[overflow-wrap:anywhere] break-words whitespace-pre-wrap">
                          {message.content_text}
                        </p>
                      )}
                    {!message.content_text && !message.media_url && (
                      <p>[{message.message_type}]</p>
                    )}
                    <time className="mt-1 block text-right text-[10px] opacity-70">
                      {new Date(message.created_at).toLocaleString('pt-BR')}
                    </time>
                  </div>
                </div>
              ))}
              {loadingMessages && (
                <p className="text-muted-foreground text-sm">
                  Carregando mensagens…
                </p>
              )}
              {!loadingMessages && !messages.length && (
                <p className="text-muted-foreground text-sm">
                  Sem mensagens registradas para este grupo.
                </p>
              )}
            </div>
            {accountRole && canSendMessages(accountRole) && (
              <GroupComposer
                key={selected.group_jid}
                groupJid={selected.group_jid}
                onSent={() => {
                  setMessageRefresh((value) => value + 1);
                  void load();
                }}
              />
            )}
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
