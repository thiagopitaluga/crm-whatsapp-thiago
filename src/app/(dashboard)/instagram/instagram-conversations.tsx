'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronsLeft,
  ChevronsRight,
  Info,
  MessageCircle,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Smile,
  Sparkles,
  Zap,
} from 'lucide-react';
import { ContactSidebar } from '@/components/inbox/contact-sidebar';
import { MessageBubble } from '@/components/inbox/message-bubble';
import { QuickReplyPicker } from '@/components/inbox/quick-reply-picker';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useAuth } from '@/hooks/use-auth';
import type { Contact, Message as InboxMessage } from '@/types';
import { cn } from '@/lib/utils';
import type { InstagramInboxConversation } from '@/lib/inbox/instagram';

type Conversation = {
  id: string;
  instagram_user_id: string;
  last_message_at: string;
  last_message_text?: string;
  contact_id: string | null;
  contact: Contact | null;
  status: string;
  tags: string[];
  profile_data: { name?: string; username?: string; profile_pic?: string };
  channel_username: string;
  assigned_agent_id: string | null;
  unread_count: number;
  deal_id?: string;
};
type Message = {
  id: string;
  direction: string;
  body: string;
  created_at: string;
  metadata?: {
    attachments?: {
      image_data?: { url?: string };
      video_data?: { url?: string };
      file_url?: string;
    }[];
  };
};
const nameOf = (c: Conversation) =>
  c.profile_data?.name ||
  c.contact?.name ||
  c.profile_data?.username ||
  `Contato ${c.instagram_user_id}`;
function Photo({ conversation }: { conversation: Conversation }) {
  return (
    <div className="bg-muted text-foreground flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-medium">
      {conversation.profile_data?.profile_pic ? (
        <img
          src={conversation.profile_data.profile_pic}
          alt=""
          className="size-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        nameOf(conversation).slice(0, 1).toUpperCase()
      )}
    </div>
  );
}

export function InstagramConversations({
  initialConversation,
  onBack,
  hideList = false,
  resyncToken = 0,
}: {
  initialConversation?: InstagramInboxConversation;
  onBack?: () => void;
  hideList?: boolean;
  resyncToken?: number;
} = {}) {
  const { canSendMessages, user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>(
      initialConversation ? [initialConversation] : []
    ),
    [selected, setSelected] = useState(initialConversation?.id ?? ''),
    [messages, setMessages] = useState<Message[]>([]),
    [text, setText] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [tagFilter, setTagFilter] = useState(''),
    [profile, setProfile] = useState(''),
    [contact, setContact] = useState<Contact | null>(
      initialConversation?.contact ?? null
    ),
    [panel, setPanel] = useState(true),
    [mobilePanel, setMobilePanel] = useState(false),
    [quick, setQuick] = useState(false),
    [emojis, setEmojis] = useState(false),
    [members, setMembers] = useState<
      { user_id: string; full_name: string | null }[]
    >([]);
  const scroll = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null),
    textInput = useRef<HTMLTextAreaElement>(null),
    activeId = useRef(selected);
  useEffect(() => {
    activeId.current = selected;
  }, [selected]);
  const loadList = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const r = await fetch(
          '/api/instagram/conversations' + (hideList ? '?cached=1' : ''),
          { signal }
        );
        const d = await r.json();
        if (!r.ok)
          throw Error(d.error || 'Não foi possível carregar as conversas.');
        setConversations(d.conversations ?? []);
        if (d.syncWarning) setError(d.syncWarning);
      } catch (e) {
        if (!signal?.aborted)
          setError(e instanceof Error ? e.message : 'Falha ao carregar.');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [hideList]
  );
  const loadMessages = useCallback(async (id: string, signal?: AbortSignal) => {
    try {
      const r = await fetch('/api/instagram/conversations?conversation=' + id, {
        signal,
      });
      const d = await r.json();
      if (!r.ok)
        throw Error(d.error || 'Não foi possível carregar as mensagens.');
      if (signal?.aborted || activeId.current !== id) return;
      setMessages(d.messages ?? []);
      setContact(d.contact);
      setError(d.syncWarning ?? '');
      if (d.profile)
        setConversations((items) =>
          items.map((c) =>
            c.id === id
              ? {
                  ...c,
                  profile_data: d.profile,
                  contact: d.contact,
                  contact_id: d.contact?.id ?? c.contact_id,
                }
              : c
          )
        );
    } catch (e) {
      if (!signal?.aborted)
        setError(e instanceof Error ? e.message : 'Falha ao carregar.');
    }
  }, []);
  useEffect(() => {
    if (!resyncToken) return;
    const controller = new AbortController();
    void loadList(controller.signal);
    if (selected) void loadMessages(selected, controller.signal);
    return () => controller.abort();
  }, [resyncToken, loadList, loadMessages, selected]);
  useEffect(() => {
    const c = new AbortController();
    void loadList(c.signal);
    const timer = setInterval(() => void loadList(c.signal), 30000);
    fetch('/api/account/members', { signal: c.signal })
      .then((r) => r.json())
      .then((d) => setMembers(d.members ?? []))
      .catch(() => {});
    return () => {
      c.abort();
      clearInterval(timer);
    };
  }, [loadList]);
  const patch = useCallback(
    async (id: string, updates: Record<string, unknown>) => {
      const r = await fetch('/api/instagram/conversations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: id, ...updates }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || 'Falha ao atualizar.');
      setConversations((items) =>
        items.map((c) =>
          c.id === id
            ? {
                ...c,
                ...updates,
                ...('assignedAgentId' in updates
                  ? {
                      assigned_agent_id: updates.assignedAgentId as
                        string | null,
                    }
                  : {}),
                ...(updates.markRead ? { unread_count: 0 } : {}),
              }
            : c
        )
      );
    },
    []
  );
  useEffect(() => {
    if (!selected) return;
    const c = new AbortController();
    void loadMessages(selected, c.signal);
    if (canSendMessages)
      void patch(selected, { markRead: true }).catch(() => {});
    const timer = setInterval(() => {
      void loadMessages(selected, c.signal);
      if (canSendMessages && document.visibilityState === 'visible')
        void patch(selected, { markRead: true }).catch(() => {});
    }, 15000);
    return () => {
      c.abort();
      clearInterval(timer);
    };
  }, [selected, loadMessages, patch, canSendMessages]);
  const lastMessage = messages.at(-1)?.id;
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [selected, lastMessage]);
  const active = conversations.find((c) => c.id === selected);
  async function change(updates: Record<string, unknown>) {
    try {
      await patch(selected, updates);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao atualizar.');
    }
  }
  async function send(media?: { type: string; url: string }) {
    if (!selected || busy || !canSendMessages || (!text.trim() && !media))
      return;
    const id = selected;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/instagram/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: id,
          text: media ? '' : text.trim(),
          media,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || 'Falha ao enviar.');
      if (activeId.current === id) setText('');
      await loadMessages(id);
      void loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao enviar.');
    } finally {
      setBusy(false);
    }
  }
  async function upload(value: File) {
    try {
      setBusy(true);
      setError('');
      const r = await fetch('/api/instagram/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: value.name,
          type: value.type,
          size: value.size,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || 'Falha ao anexar.');
      const uploaded = await fetch(d.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': value.type },
        body: value,
      });
      if (!uploaded.ok) throw Error('Falha no upload.');
      const sent = await fetch('/api/instagram/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: selected,
          media: {
            type: value.type === 'application/pdf' ? 'pdf' : 'image',
            url: d.url,
          },
        }),
      });
      const result = await sent.json();
      if (!sent.ok) throw Error(result.error || 'Falha no envio.');
      await loadMessages(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao anexar.');
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  }
  const profiles = [...new Set(conversations.map((c) => c.channel_username))];
  const allTags = [...new Set(conversations.flatMap((c) => c.tags ?? []))];
  const filtered = conversations.filter(
    (c) =>
      (!profile || c.channel_username === profile) &&
      (!tagFilter || c.tags.includes(tagFilter)) &&
      (filter === 'all' ||
        (filter === 'unread' && c.unread_count > 0) ||
        (filter === 'mine' && c.assigned_agent_id === user?.id) ||
        c.status === filter) &&
      `${nameOf(c)} ${c.profile_data?.username ?? ''} ${c.contact?.phone ?? ''} ${c.tags.join(' ')}`
        .toLowerCase()
        .includes(search.toLowerCase())
  );
  const sidebar = contact ? (
    <ContactSidebar
      key={contact.id}
      contact={contact}
      initialDealId={active?.deal_id}
      channelLabel="Instagram"
      conversationStatusLabel={
        active?.status === 'closed'
          ? '● Encerrada'
          : active?.status === 'human'
            ? '● Atendimento humano'
            : '● Aberta'
      }
      filesContent={
        <div className="space-y-3 p-3">
          <h3 className="text-sm font-semibold">Arquivos do Direct</h3>
          {messages
            .flatMap((m) => m.metadata?.attachments ?? [])
            .map((a, index) => (
              <div key={index} className="rounded-lg border p-2 text-xs">
                {a.image_data?.url ? (
                  <a href={a.image_data.url} target="_blank" rel="noreferrer">
                    <img
                      src={a.image_data.url}
                      alt="Imagem recebida"
                      className="max-h-36 rounded"
                    />
                  </a>
                ) : a.video_data?.url ? (
                  <video src={a.video_data.url} controls className="max-h-36" />
                ) : a.file_url ? (
                  <a
                    href={a.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    Abrir documento
                  </a>
                ) : (
                  <span>Anexo indisponível</span>
                )}
              </div>
            ))}
          {!messages.some((m) => m.metadata?.attachments?.length) && (
            <p className="text-muted-foreground text-xs">
              Nenhum arquivo disponível nesta conversa.
            </p>
          )}
        </div>
      }
      channelIdentifier={
        active?.profile_data?.username
          ? '@' + active.profile_data.username
          : undefined
      }
      onContactUpdated={() => {
        void loadMessages(selected);
        void loadList();
      }}
    />
  ) : (
    <div className="text-muted-foreground p-4 text-sm">
      Carregando ficha do contato…
    </div>
  );
  return (
    <section
      className={cn(
        'bg-card border-border relative flex min-h-0 min-w-0 flex-1 overflow-hidden',
        !hideList && 'rounded-xl border'
      )}
    >
      {!hideList && (
        <aside
          aria-label="Conversas do Instagram"
          className={cn(
            'border-border flex min-h-0 w-full shrink-0 flex-col border-r md:w-72',
            selected && 'hidden md:flex'
          )}
        >
          <div className="shrink-0 space-y-3 border-b p-3">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-2.5 left-3 size-4" />
              <input
                aria-label="Pesquisar conversas"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Pesquisar conversas…"
                className="bg-muted w-full rounded-lg border py-2 pr-3 pl-9 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <select
                aria-label="Filtrar conversas"
                className="bg-card min-w-0 flex-1 rounded-lg border p-2 text-xs"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">Todas</option>
                <option value="unread">Não lidas</option>
                <option value="mine">Minhas conversas</option>
                <option value="open">Abertas</option>
                <option value="human">Atendimento humano</option>
                <option value="closed">Encerradas</option>
              </select>
              {profiles.length > 1 && (
                <select
                  aria-label="Filtrar perfil"
                  value={profile}
                  onChange={(e) => setProfile(e.target.value)}
                  className="bg-card min-w-0 flex-1 rounded-lg border p-2 text-xs"
                >
                  <option value="">Todos os perfis</option>
                  {profiles.map((p) => (
                    <option key={p} value={p}>
                      @{p}
                    </option>
                  ))}
                </select>
              )}
              <button
                title="Atualizar conversas"
                aria-label="Atualizar conversas"
                onClick={() => void loadList()}
                className="hover:bg-muted rounded-lg p-2"
              >
                <RefreshCw className="size-4" />
              </button>
            </div>
            {allTags.length > 0 && (
              <select
                aria-label="Filtrar por etiqueta"
                className="bg-card w-full rounded-lg border p-2 text-xs"
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
              >
                <option value="">Todas as etiquetas</option>
                {allTags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  activeId.current = c.id;
                  setSelected(c.id);
                  setMessages([]);
                  setContact(c.contact);
                  setError('');
                }}
                className={cn(
                  'hover:bg-muted/50 flex w-full items-center gap-3 border-l-2 border-transparent px-3 py-4 text-left',
                  selected === c.id && 'border-primary bg-primary/5'
                )}
              >
                <Photo conversation={c} />
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2">
                    <span className="truncate text-sm font-semibold">
                      {nameOf(c)}
                    </span>
                    <time className="text-muted-foreground shrink-0 text-[10px]">
                      {new Date(c.last_message_at).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                      })}
                    </time>
                  </div>
                  <p className="text-muted-foreground truncate text-xs">
                    {c.last_message_text || 'Conversa do Instagram'}
                  </p>
                  <p className="text-muted-foreground mt-1 text-[10px]">
                    @{c.channel_username}
                  </p>
                </div>
                {c.unread_count > 0 && (
                  <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-[10px]">
                    {c.unread_count}
                  </span>
                )}
              </button>
            ))}
            {!filtered.length && (
              <p className="text-muted-foreground p-5 text-sm">
                {loading
                  ? 'Carregando conversas…'
                  : 'Nenhuma conversa encontrada.'}
              </p>
            )}
          </div>
        </aside>
      )}
      <div
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col',
          !active && 'hidden md:flex'
        )}
      >
        {active ? (
          <>
            <header className="flex shrink-0 flex-wrap items-center gap-2 border-b p-3">
              <button
                aria-label="Voltar para conversas"
                className={cn('p-1', hideList ? 'lg:hidden' : 'md:hidden')}
                onClick={() => {
                  setSelected('');
                  onBack?.();
                }}
              >
                <ArrowLeft className="size-4" />
              </button>
              <Photo conversation={active} />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold">
                  {nameOf(active)}
                </h2>
                <p className="text-muted-foreground truncate text-xs">
                  @{active.profile_data?.username || active.instagram_user_id}
                </p>
              </div>
              <button
                aria-label="Atualizar mensagens"
                onClick={() => void loadMessages(selected)}
                className="p-2"
              >
                <RefreshCw className="size-4" />
              </button>
              <select
                aria-label="Status da conversa"
                disabled={!canSendMessages}
                value={active.status}
                onChange={(e) => void change({ status: e.target.value })}
                className="bg-card max-w-40 rounded-lg border p-2 text-xs"
              >
                <option value="open">Aberta · automação</option>
                <option value="human">Humano · pausada</option>
                <option value="closed">Encerrada</option>
              </select>
              <select
                aria-label="Atribuir conversa"
                disabled={!canSendMessages}
                value={active.assigned_agent_id ?? ''}
                onChange={(e) =>
                  void change({ assignedAgentId: e.target.value || null })
                }
                className="bg-card max-w-36 rounded-lg border p-2 text-xs"
              >
                <option value="">Atribuir</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name || 'Atendente'}
                  </option>
                ))}
              </select>
              <button
                title="Informações do contato"
                aria-label="Informações do contato"
                onClick={() => {
                  if (window.matchMedia('(min-width:1280px)').matches)
                    setPanel((p) => !p);
                  else setMobilePanel(true);
                }}
                className="hover:bg-muted rounded-lg p-2"
              >
                <Info className="size-4" />
              </button>
            </header>
            <div
              ref={scroll}
              className="bg-background min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"
            >
              <div className="mx-auto max-w-4xl space-y-2">
                {messages.map((m, index) => {
                  const attachment = m.metadata?.attachments?.[0];
                  const converted: InboxMessage = {
                    id: m.id,
                    conversation_id: selected,
                    sender_type:
                      m.direction === 'outbound' ? 'agent' : 'customer',
                    content_type: attachment?.image_data?.url
                      ? 'image'
                      : attachment?.file_url
                        ? 'document'
                        : 'text',
                    content_text:
                      m.body.startsWith('[') && attachment ? '' : m.body,
                    media_url:
                      attachment?.image_data?.url || attachment?.file_url,
                    status: 'sent',
                    created_at: m.created_at,
                  };
                  const day = new Date(m.created_at).toLocaleDateString(
                    'pt-BR'
                  );
                  return (
                    <div key={m.id}>
                      {(!index ||
                        day !==
                          new Date(
                            messages[index - 1].created_at
                          ).toLocaleDateString('pt-BR')) && (
                        <div className="my-4 text-center">
                          <span className="bg-muted text-muted-foreground rounded-full px-3 py-1 text-[10px]">
                            {day}
                          </span>
                        </div>
                      )}
                      <div
                        className={cn(
                          'flex',
                          m.direction === 'outbound'
                            ? 'justify-end'
                            : 'justify-start'
                        )}
                      >
                        <div className="max-w-[85%]">
                          {attachment?.video_data?.url ? (
                            <video
                              controls
                              src={attachment.video_data.url}
                              className="max-h-72 rounded-xl"
                            />
                          ) : (
                            <MessageBubble message={converted} />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!messages.length && (
                  <p className="text-muted-foreground py-10 text-center text-sm">
                    Nenhuma mensagem disponível nesta conversa.
                  </p>
                )}
              </div>
            </div>
            {error && (
              <p
                role="alert"
                className="text-destructive shrink-0 border-t px-3 py-2 text-xs"
              >
                {error}
              </p>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
              className="bg-card shrink-0 space-y-2 border-t p-3"
            >
              <div className="flex items-end gap-2">
                <textarea
                  ref={textInput}
                  aria-label="Mensagem do Instagram"
                  placeholder="Digite uma mensagem…"
                  rows={2}
                  maxLength={1000}
                  value={text}
                  disabled={!canSendMessages || busy}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === 'Enter' &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  className="bg-muted max-h-32 min-w-0 flex-1 resize-none rounded-xl border p-3 text-sm"
                />
                <button
                  aria-label="Enviar mensagem"
                  disabled={busy || !text.trim() || !canSendMessages}
                  className="bg-primary text-primary-foreground rounded-xl p-3 disabled:opacity-50"
                >
                  <Send className="size-4" />
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!canSendMessages || busy}
                  title="Anexar imagem ou PDF"
                  aria-label="Anexar imagem ou PDF"
                  onClick={() => file.current?.click()}
                  className="hover:bg-muted rounded-lg p-2"
                >
                  <Paperclip className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Emojis"
                  onClick={() => setEmojis((v) => !v)}
                  className="hover:bg-muted rounded-lg p-2"
                >
                  <Smile className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Respostas rápidas"
                  onClick={() => setQuick(true)}
                  className="hover:bg-muted rounded-lg p-2"
                >
                  <Zap className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Sugerir resposta com IA"
                  title="Sugerir resposta com IA"
                  disabled={busy || !canSendMessages}
                  className="hover:bg-muted rounded-lg p-2 disabled:opacity-50"
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      const r = await fetch('/api/instagram/draft', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ conversationId: selected }),
                      });
                      const d = await r.json();
                      if (!r.ok) throw Error(d.error);
                      if (activeId.current === selected) setText(d.draft);
                      textInput.current?.focus();
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : 'Falha ao sugerir resposta.'
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Sparkles className="size-4" />
                </button>
                <span className="text-muted-foreground ml-auto text-[10px]">
                  Enter envia · Shift+Enter nova linha
                </span>
              </div>
              {emojis && (
                <div className="flex flex-wrap gap-2">
                  {['😊', '👋', '👍', '❤️', '🙏', '✅', '📍', '📅'].map(
                    (emoji) => (
                      <button
                        type="button"
                        key={emoji}
                        onClick={() => {
                          setText((v) => v + emoji);
                          textInput.current?.focus();
                        }}
                      >
                        {emoji}
                      </button>
                    )
                  )}
                </div>
              )}
              <input
                ref={file}
                type="file"
                className="hidden"
                accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                onChange={(e) => {
                  if (e.target.files?.[0]) void upload(e.target.files[0]);
                }}
              />
            </form>
          </>
        ) : (
          <div className="text-muted-foreground m-auto flex flex-col items-center gap-3 p-6 text-center">
            <MessageCircle className="size-10" />
            <p>Selecione uma conversa do Instagram.</p>
            {error && (
              <p role="alert" className="text-destructive text-xs">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
      {active && (
        <>
          <div className="relative hidden shrink-0 xl:block">
            <button
              aria-label={
                panel ? 'Recolher informações' : 'Expandir informações'
              }
              onClick={() => setPanel((v) => !v)}
              className="bg-primary text-primary-foreground border-background absolute top-7 -left-3 z-10 rounded-full border-2 p-1"
            >
              {panel ? (
                <ChevronsRight className="size-3" />
              ) : (
                <ChevronsLeft className="size-3" />
              )}
            </button>
            {panel && (
              <div className="h-full w-80 overflow-hidden">{sidebar}</div>
            )}
          </div>
          <Sheet open={mobilePanel} onOpenChange={setMobilePanel}>
            <SheetContent className="w-80 overflow-hidden p-0 xl:hidden">
              <SheetHeader className="sr-only">
                <SheetTitle>Informações do contato</SheetTitle>
              </SheetHeader>
              {sidebar}
            </SheetContent>
          </Sheet>
        </>
      )}
      <QuickReplyPicker
        open={quick}
        onOpenChange={setQuick}
        onPick={(reply) => {
          if (reply.kind === 'interactive') {
            setError('Use uma resposta rápida de texto para o Instagram.');
            return;
          }
          setText(reply.content_text ?? '');
          setQuick(false);
          textInput.current?.focus();
        }}
      />
    </section>
  );
}
