'use client';
import { useEffect, useRef, useState } from 'react';
import { Loader2, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { MessageThread } from '@/components/inbox/message-thread';
import { ContactSidebar } from '@/components/inbox/contact-sidebar';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useRealtime } from '@/hooks/use-realtime';
import { cn } from '@/lib/utils';
import type { Contact, Conversation, Deal, Message } from '@/types';
import { mergeChatMessage } from '@/lib/contacts/chat-messages';

type Channel = { key: string; label: string; connected: boolean };
type Chat = Conversation;
export function LeadChatPanel({
  deal,
  onClose,
  onChanged,
}: {
  deal: Deal;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { accountId, user, isAgent, canSendMessages } = useAuth();
  const [contact, setContact] = useState<Contact | null>(null),
    [conversations, setConversations] = useState<Chat[]>([]),
    [selectedId, setSelectedId] = useState(deal.conversation_id ?? ''),
    [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [denied, setDenied] = useState(false),
    [refresh, setRefresh] = useState(0),
    [resync, setResync] = useState(0),
    [showInfo, setShowInfo] = useState(false),
    [desktopInfo, setDesktopInfo] = useState(true);
  const [channels, setChannels] = useState<Channel[]>([]),
    [channelKey, setChannelKey] = useState(''),
    [creating, setCreating] = useState(false);
  const conversation = conversations.find((c) => c.id === selectedId) ?? null;
  const changedRef = useRef(onChanged);
  useEffect(() => {
    changedRef.current = onChanged;
  });
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const db = createClient();
    async function load() {
      setLoading(true);
      setError('');
      try {
        if (!deal.contact_id)
          throw Error(
            'Este negócio não possui um contato vinculado. Vincule um contato para iniciar a conversa.'
          );
        if (isAgent) {
          const access = await db
            .from('accounts')
            .select('agents_can_view_inbox_messages')
            .eq('id', accountId!)
            .single();
          if (access.error) throw access.error;
          if (access.data.agents_can_view_inbox_messages === false) {
            if (!cancelled) {
              setDenied(true);
              setConversations([]);
              setMessages([]);
            }
            return;
          }
        }
        const [c, v] = await Promise.all([
          db
            .from('contacts')
            .select('*')
            .eq('account_id', accountId!)
            .eq('id', deal.contact_id)
            .maybeSingle(),
          db
            .from('conversations')
            .select('*')
            .eq('account_id', accountId!)
            .eq('contact_id', deal.contact_id)
            .order('last_message_at', { ascending: false, nullsFirst: false }),
        ]);
        if (c.error || v.error) throw c.error || v.error;
        if (!c.data) throw Error('Contato indisponível para este usuário.');
        if (cancelled) return;
        setDenied(false);
        setContact(c.data);
        setConversations(v.data ?? []);
        setSelectedId((previous) =>
          v.data?.some((row) => row.id === previous)
            ? previous
            : (v.data?.find((row) => row.id === deal.conversation_id)?.id ??
              v.data?.[0]?.id ??
              '')
        );
        if (!v.data?.length) {
          const r = await fetch('/api/ai/agents/channels', {
            cache: 'no-store',
          });
          if (r.ok) {
            const data = await r.json();
            if (!cancelled) {
              setChannels(data.channels ?? []);
              setChannelKey(
                (previous) =>
                  previous ||
                  (data.channels ?? []).find((item: Channel) => item.connected)
                    ?.key ||
                  ''
              );
            }
          }
        }
      } catch (e) {
        if (!cancelled)
          setError((e as Error).message || 'Não foi possível abrir o chat.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [accountId, deal.contact_id, deal.conversation_id, isAgent, refresh]);
  useEffect(() => {
    if (!accountId || !isAgent) return;
    const db = createClient();
    const channel = db
      .channel('lead-chat-access-' + deal.id)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'accounts',
          filter: `id=eq.${accountId}`,
        },
        (event) => {
          if (event.new.agents_can_view_inbox_messages === false) {
            setDenied(true);
            setConversations([]);
            setMessages([]);
          } else setRefresh((v) => v + 1);
        }
      )
      .subscribe();
    return () => {
      void db.removeChannel(channel);
    };
  }, [accountId, deal.id, isAgent]);
  const { isConnected } = useRealtime({
    channelName: 'kanban-chat-' + deal.id,
    enabled: !!conversation && !denied,
    onMessageEvent: (event) => {
      if (event.eventType === 'DELETE') {
        setMessages((old) => old.filter((m) => m.id !== event.old.id));
        return;
      }
      if (event.new.conversation_id !== selectedId) return;
      setMessages((old) => mergeChatMessage(old, event.new));
    },
    onConversationEvent: (event) => {
      if (event.eventType === 'DELETE') {
        setConversations((old) => old.filter((c) => c.id !== event.old.id));
        return;
      }
      if (event.new.contact_id === deal.contact_id)
        setConversations((old) =>
          old.some((c) => c.id === event.new.id)
            ? old.map((c) =>
                c.id === event.new.id ? { ...c, ...event.new } : c
              )
            : [event.new, ...old]
        );
    },
  });
  useEffect(() => {
    if (isConnected) setResync((v) => v + 1);
  }, [isConnected]);
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === 'visible') {
        setResync((v) => v + 1);
        setRefresh((v) => v + 1);
      }
    };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, []);
  function updated() {
    setRefresh((v) => v + 1);
    changedRef.current();
  }
  async function createConversation() {
    if (!contact || !accountId || !user || !channelKey) return;
    setCreating(true);
    try {
      const db = createClient();
      const existing = await db
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', contact.id)
        .eq('whatsapp_channel_key', channelKey)
        .limit(1)
        .maybeSingle();
      if (existing.error) throw existing.error;
      let id = existing.data?.id;
      if (!id) {
        const result = await db
          .from('conversations')
          .insert({
            account_id: accountId,
            user_id: user.id,
            contact_id: contact.id,
            whatsapp_channel_key: channelKey,
            status: 'open',
          })
          .select('id')
          .single();
        if (result.error) throw result.error;
        id = result.data.id;
      }
      setSelectedId(id);
      setRefresh((v) => v + 1);
    } catch (e) {
      toast.error((e as Error).message || 'Não foi possível iniciar o chat.');
    } finally {
      setCreating(false);
    }
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) {
          onChanged();
          onClose();
        }
      }}
    >
      <SheetContent
        side="right"
        className="min-h-0 gap-0 overflow-hidden p-0 data-[side=right]:h-[100dvh] data-[side=right]:w-full data-[side=right]:sm:max-w-none data-[side=right]:md:w-[calc(100vw-4rem)] data-[side=right]:xl:w-[70vw] data-[side=right]:xl:max-w-[1200px]"
      >
        <SheetHeader className="shrink-0 flex-row items-center justify-between gap-2 border-b py-2 pr-12 pl-4">
          <SheetTitle className="truncate text-sm">Chat do lead</SheetTitle>
          <div className="flex shrink-0 items-center gap-2">
            {showInfo && (
              <button
                className="text-primary inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs lg:hidden"
                onClick={() => setShowInfo(false)}
              >
                ← Voltar para a conversa
              </button>
            )}
          </div>
        </SheetHeader>
        {loading && !contact ? (
          <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            Abrindo conversa…
          </div>
        ) : denied ? (
          <div className="text-muted-foreground p-6 text-sm">
            O administrador desativou seu acesso às conversas e mensagens. A
            edição do negócio continua disponível acima.
          </div>
        ) : error ? (
          <div className="space-y-3 p-6 text-sm" role="alert">
            <p>{error}</p>
            <Button variant="outline" onClick={() => setRefresh((v) => v + 1)}>
              Tentar novamente
            </Button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div
              className={cn(
                'min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
                showInfo ? 'hidden lg:flex' : 'flex'
              )}
            >
              {conversations.length > 1 && (
                <div className="border-b p-2">
                  <select
                    className="bg-background w-full rounded-md border p-2 text-xs"
                    aria-label="Conversa e canal do contato"
                    value={selectedId}
                    onChange={(e) => {
                      setMessages([]);
                      setSelectedId(e.target.value);
                    }}
                  >
                    {conversations.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.whatsapp_channel_key || 'WhatsApp'} ·{' '}
                        {new Date(c.created_at).toLocaleDateString('pt-BR')}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {conversation ? (
                <MessageThread
                  textDeliveryMode="api"
                  onOpenContactMobile={() => setShowInfo(true)}
                  key={conversation.id}
                  conversation={conversation}
                  contact={contact}
                  messages={messages.filter(
                    (message) => message.conversation_id === conversation.id
                  )}
                  onMessagesLoaded={setMessages}
                  onNewMessage={(m) =>
                    setMessages((old) => mergeChatMessage(old, m))
                  }
                  onUpdateMessage={(id, changes) => {
                    setMessages((old) =>
                      old.map((m) => (m.id === id ? { ...m, ...changes } : m))
                    );
                    if (id.startsWith('temp-') && changes.status === 'sent')
                      setResync((v) => v + 1);
                  }}
                  onStatusChange={(id, status) => {
                    setConversations((old) =>
                      old.map((c) => (c.id === id ? { ...c, status } : c))
                    );
                    changedRef.current();
                  }}
                  onAssignChange={(id, assigned) =>
                    setConversations((old) =>
                      old.map((c) =>
                        c.id === id
                          ? { ...c, assigned_agent_id: assigned ?? undefined }
                          : c
                      )
                    )
                  }
                  resyncToken={resync}
                  onRefresh={() => setResync((v) => v + 1)}
                />
              ) : (
                <div className="m-auto max-w-sm space-y-3 p-6 text-center text-sm">
                  <p>Este lead ainda não possui uma conversa.</p>
                  {channels.length > 0 ? (
                    <>
                      <select
                        aria-label="WhatsApp para iniciar conversa"
                        className="bg-background w-full rounded-md border p-2 text-xs"
                        value={channelKey}
                        onChange={(e) => setChannelKey(e.target.value)}
                      >
                        <option value="">Selecione um WhatsApp</option>
                        {channels.map((c) => (
                          <option
                            key={c.key}
                            value={c.key}
                            disabled={!c.connected}
                          >
                            {c.label}
                            {c.connected ? '' : ' (desconectado)'}
                          </option>
                        ))}
                      </select>
                      <Button
                        disabled={!canSendMessages || creating || !channelKey}
                        onClick={() => void createConversation()}
                      >
                        Iniciar chat
                      </Button>
                    </>
                  ) : (
                    <p className="text-muted-foreground">
                      Conecte um WhatsApp em Conexões para iniciar o
                      atendimento.
                    </p>
                  )}
                </div>
              )}
            </div>
            {contact && (
              <div
                className={cn(
                  'relative min-h-0 w-full shrink-0 lg:w-auto',
                  showInfo ? 'block' : 'hidden lg:block'
                )}
              >
                <button
                  className={cn(
                    'border-background bg-primary text-primary-foreground absolute top-16 z-20 hidden size-6 items-center justify-center rounded-full border-2 shadow-md lg:flex',
                    desktopInfo ? '-left-3' : 'right-1'
                  )}
                  aria-label={
                    desktopInfo
                      ? 'Recolher ficha do lead'
                      : 'Expandir ficha do lead'
                  }
                  title={
                    desktopInfo
                      ? 'Recolher ficha do lead'
                      : 'Expandir ficha do lead'
                  }
                  onClick={() => setDesktopInfo((v) => !v)}
                >
                  {desktopInfo ? (
                    <ChevronsRight className="size-3.5" />
                  ) : (
                    <ChevronsLeft className="size-3.5" />
                  )}
                </button>
                <div className={cn('h-full', !desktopInfo && 'lg:hidden')}>
                  <ContactSidebar
                    key={deal.id}
                    initialDealId={deal.id}
                    contact={contact}
                    conversation={conversation}
                    onContactUpdated={updated}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
