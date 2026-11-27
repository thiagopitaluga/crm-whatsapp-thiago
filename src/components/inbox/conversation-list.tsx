'use client';
import { InboxChannelTabs } from './inbox-channel-tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ContactAvatar } from '@/components/contacts/contact-avatar';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  CONVERSATION_SELECT,
  matchesContactFilters,
  normalizeConversations,
} from '@/lib/inbox/conversations';
import { cn } from '@/lib/utils';
import type { Conversation, ConversationStatus, Tag } from '@/types';
import {
  Search,
  X,
  RefreshCw,
  SlidersHorizontal,
  MoreHorizontal,
  Check,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { enUS, ptBR } from 'date-fns/locale';
import { useLocale, useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { canSendMessages } from '@/lib/auth/roles';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  filterInboxChannel,
  type InboxChannelFilter,
} from '@/lib/inbox/instagram';

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
  additionalConversations?: Conversation[];
  channelFilter?: InboxChannelFilter;
  onChannelFilterChange?: (filter: InboxChannelFilter) => void;
  initialUnreadOnly?: boolean;
  initialMineOnly?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: 'bg-primary',
  pending: 'bg-amber-500',
  closed: 'bg-muted-foreground',
};

type InboxFilter = ConversationStatus | 'all' | 'unread';

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
  additionalConversations = [],
  channelFilter = 'all',
  onChannelFilterChange,
  initialUnreadOnly,
  initialMineOnly,
  onRefresh,
  refreshing = false,
}: ConversationListProps) {
  const t = useTranslations('Inbox.conversationList');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const FILTER_OPTIONS: { label: string; value: InboxFilter }[] = useMemo(
    () => [
      { label: t('filterAll'), value: 'all' },
      { label: t('filterOpen'), value: 'open' },
      { label: t('filterClosed'), value: 'closed' },
      { label: t('filterUnread'), value: 'unread' },
    ],
    [t]
  );

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<InboxFilter>(
    initialUnreadOnly ? 'unread' : 'all'
  );
  const { accountId, accountRole, user } = useAuth();
  const [assignee, setAssignee] = useState(initialMineOnly ? 'mine' : '');
  const [connection, setConnection] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>(
    []
  );
  const [pipelineContacts, setPipelineContacts] = useState<{
    account: string;
    pipeline: string;
    ids: Set<string>;
    error?: boolean;
  } | null>(null);
  const [draft, setDraft] = useState({
    status: 'all' as InboxFilter,
    assignee: '',
    connection: '',
    pipelineId: '',
    tagIds: [] as string[],
    company: '',
  });
  const [members, setMembers] = useState<
    { user_id: string; full_name: string | null }[]
  >([]);
  const [connectionNames, setConnectionNames] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    if (!accountId) return;
    const db = createClient();
    let active = true;
    void Promise.all([
      db
        .from('profiles')
        .select('user_id,full_name')
        .eq('account_id', accountId)
        .order('full_name'),
      db
        .from('whatsapp_channels')
        .select('channel_key,label')
        .eq('account_id', accountId),
      db
        .from('pipelines')
        .select('id,name')
        .eq('account_id', accountId)
        .order('name'),
    ]).then(([people, channels, funnels]) => {
      if (!active) return;
      setMembers(people.data ?? []);
      setPipelines(funnels.data ?? []);
      setConnectionNames(
        Object.fromEntries(
          (channels.data ?? []).map((row) => [row.channel_key, row.label])
        )
      );
    });
    return () => {
      active = false;
    };
  }, [accountId]);

  useEffect(() => {
    if (!accountId || !pipelineId) return;
    let cancelled = false;
    const db = createClient();
    void (async () => {
      const ids = new Set<string>();
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await db
          .from('deals')
          .select('id,contact_id')
          .eq('account_id', accountId)
          .eq('pipeline_id', pipelineId)
          .order('id')
          .range(offset, offset + 999);
        if (cancelled) return;
        if (error) {
          setPipelineContacts({
            account: accountId,
            pipeline: pipelineId,
            ids: new Set(),
            error: true,
          });
          return;
        }
        for (const row of data ?? [])
          if (row.contact_id) ids.add(row.contact_id);
        if (!data || data.length < 1000) break;
      }
      if (!cancelled)
        setPipelineContacts({ account: accountId, pipeline: pipelineId, ids });
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, pipelineId, resyncToken]);
  const pipelineReady =
    pipelineContacts?.account === accountId &&
    pipelineContacts.pipeline === pipelineId;

  const connectionOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const item of [...conversations, ...additionalConversations]) {
      if (item.inbox_channel === 'instagram') {
        if (channelFilter !== 'whatsapp' && item.inbox_channel_label)
          options.set(
            'ig:' + item.inbox_channel_label,
            '@' + item.inbox_channel_label
          );
      } else if (channelFilter !== 'instagram') {
        const key = item.whatsapp_channel_key ?? 'unassigned';
        options.set(
          'wa:' + key,
          connectionNames[key] ??
            (key === 'unassigned'
              ? 'WhatsApp · sem número identificado'
              : key === 'whatsapp_evolution'
                ? 'WhatsApp principal'
                : 'WhatsApp · ' + key.split(':').at(-1))
        );
      }
    }
    return options;
  }, [conversations, additionalConversations, channelFilter, connectionNames]);
  const activeConnection = connectionOptions.has(connection) ? connection : '';
  const [loading, setLoading] = useState(true);
  // Contact-based filters (issue #272). Tags use OR logic (a conversation
  // matches if its contact carries any selected tag), consistent with
  // Broadcast audience filtering. Company is an exact match on the field.
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select(CONVERSATION_SELECT)
        .eq('account_id', accountId)
        .order('last_message_at', { ascending: false });

      if (cancelled) return;

      if (error) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error('Failed to fetch conversations:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setLoading(false);
        return;
      }

      onConversationsLoadedRef.current(normalizeConversations(data ?? []));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [accountId, resyncToken]);

  // Tag definitions for the filter picker — loaded once so labels/colours
  // stay stable regardless of which conversations happen to be loaded.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('tags').select('*').order('name');
      if (!cancelled && data) setTags(data as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Company options are derived from the loaded conversations — there's no
  // separate companies table, and only companies with a live conversation
  // are worth offering as an inbox filter.
  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const c of [...conversations, ...additionalConversations]) {
      const co = c.contact?.company?.trim();
      if (co) set.add(co);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [conversations, additionalConversations]);

  const tagsById = useMemo(() => {
    const m = new Map<string, Tag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  const filtered = useMemo(() => {
    let result = filterInboxChannel(
      [...conversations, ...additionalConversations],
      channelFilter
    );

    if (filter === 'unread') {
      result = result.filter((c) => c.unread_count > 0);
    } else if (filter === 'open') {
      result = result.filter((c) => c.status !== 'closed');
    } else if (filter !== 'all') {
      result = result.filter((c) => c.status === filter);
    }
    if (assignee) {
      result = result.filter((c) =>
        assignee === 'unassigned'
          ? !c.assigned_agent_id
          : c.assigned_agent_id === (assignee === 'mine' ? user?.id : assignee)
      );
    }
    if (activeConnection) {
      result = result.filter(
        (c) =>
          activeConnection ===
          (c.inbox_channel === 'instagram'
            ? 'ig:' + c.inbox_channel_label
            : 'wa:' + (c.whatsapp_channel_key ?? 'unassigned'))
      );
    }
    if (pipelineId) {
      result =
        pipelineReady && !pipelineContacts?.error
          ? result.filter((c) => pipelineContacts?.ids.has(c.contact_id))
          : [];
    }

    // Contact-based filters (tags via OR logic, exact company match).
    if (selectedTagIds.length > 0 || selectedCompany !== null) {
      result = result.filter((c) =>
        c.inbox_channel === 'instagram'
          ? (!selectedTagIds.length ||
              selectedTagIds.some((id) =>
                c.inbox_tag_names?.includes(tagsById.get(id)?.name ?? '')
              )) &&
            (selectedCompany === null ||
              c.contact?.company?.trim() === selectedCompany)
          : matchesContactFilters(c, {
              tagIds: selectedTagIds,
              company: selectedCompany,
            })
      );
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? '';
        const phone = c.contact?.phone?.toLowerCase() ?? '';
        const lastMsg = c.last_message_text?.toLowerCase() ?? '';
        return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
      });
    }

    return result.sort((a, b) => {
      const dateA = Date.parse(a.last_message_at ?? '') || 0;
      const dateB = Date.parse(b.last_message_at ?? '') || 0;
      return dateB - dateA || a.id.localeCompare(b.id);
    });
  }, [
    conversations,
    additionalConversations,
    channelFilter,
    filter,
    assignee,
    activeConnection,
    user?.id,
    search,
    selectedTagIds,
    selectedCompany,
    tagsById,
    pipelineId,
    pipelineReady,
    pipelineContacts,
  ]);

  const toggleTag = useCallback((id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }, []);

  const clearContactFilters = useCallback(() => {
    setSelectedTagIds([]);
    setSelectedCompany(null);
    setPipelineId('');
  }, []);

  const hasContactFilters =
    selectedTagIds.length > 0 || selectedCompany !== null || !!pipelineId;

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const activeFilters =
    Number(filter !== 'all') +
    Number(!!assignee) +
    Number(!!activeConnection) +
    Number(!!pipelineId) +
    Number(selectedTagIds.length > 0) +
    Number(!!selectedCompany);
  function openFilters() {
    setDraft({
      status: filter,
      assignee,
      connection: activeConnection,
      pipelineId,
      tagIds: [...selectedTagIds],
      company: selectedCompany ?? '',
    });
    setFiltersOpen(true);
  }
  function applyFilters() {
    setFilter(draft.status);
    setAssignee(draft.assignee);
    setConnection(draft.connection);
    setPipelineId(draft.pipelineId);
    setSelectedTagIds(draft.tagIds);
    setSelectedCompany(draft.company || null);
    setFiltersOpen(false);
  }

  async function quickStatus(conversation: Conversation) {
    if (!accountId) return;
    const status = conversation.status === 'closed' ? 'open' : 'closed';
    try {
      if (conversation.inbox_channel === 'instagram') {
        const response = await fetch('/api/instagram/conversations', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ conversationId: conversation.id, status }),
        });
        if (!response.ok) throw new Error('Falha ao alterar o status.');
      } else {
        const { error } = await createClient()
          .from('conversations')
          .update({ status })
          .eq('account_id', accountId)
          .eq('id', conversation.id);
        if (error) throw error;
      }
      onRefresh?.();
      toast.success(
        status === 'closed' ? 'Conversa fechada.' : 'Conversa reaberta.'
      );
    } catch {
      toast.error('Não foi possível alterar o status da conversa.');
    }
  }

  async function quickAssign(
    conversation: Conversation,
    agentId: string | null
  ) {
    if (
      !accountId ||
      (agentId && !members.some((member) => member.user_id === agentId))
    )
      return;
    try {
      if (conversation.inbox_channel === 'instagram') {
        const response = await fetch('/api/instagram/conversations', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            conversationId: conversation.id,
            assignedAgentId: agentId,
          }),
        });
        if (!response.ok) throw new Error('Falha ao atribuir conversa.');
      } else {
        const { error } = await createClient()
          .from('conversations')
          .update({ assigned_agent_id: agentId })
          .eq('account_id', accountId)
          .eq('id', conversation.id);
        if (error) throw error;
      }
      onRefresh?.();
      toast.success('Responsável atualizado.');
    } catch {
      toast.error('Não foi possível atribuir a conversa.');
    }
  }

  async function quickTag(conversation: Conversation, tag: Tag) {
    if (!accountId || !conversation.contact_id) {
      toast.error('Esta conversa ainda não tem um contato vinculado.');
      return;
    }
    try {
      const db = createClient();
      const { data: contact, error: contactError } = await db
        .from('contacts')
        .select('id')
        .eq('account_id', accountId)
        .eq('id', conversation.contact_id)
        .maybeSingle();
      if (contactError || !contact) throw new Error('Contato não encontrado.');
      const { error } = await db
        .from('contact_tags')
        .upsert(
          { contact_id: contact.id, tag_id: tag.id },
          { onConflict: 'contact_id,tag_id', ignoreDuplicates: true }
        );
      if (error) throw error;
      onRefresh?.();
      toast.success('Etiqueta adicionada ao contato.');
    } catch {
      toast.error('Não foi possível adicionar a etiqueta.');
    }
  }

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="border-border bg-card flex h-full w-full max-w-full min-w-0 flex-col overflow-hidden border-r lg:w-80">
      {/* Search + Filter */}
      <div className="border-border min-w-0 shrink-0 space-y-2 border-b p-3">
        {onChannelFilterChange && (
          <InboxChannelTabs
            value={channelFilter}
            onChange={onChannelFilterChange}
          />
        )}
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={handleSearchChange}
              placeholder={t('searchPlaceholder')}
              className="border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/50 pl-9 text-sm"
            />
          </div>
          <button
            type="button"
            title="Filtrar conversas"
            aria-label="Filtrar conversas"
            onClick={openFilters}
            className={cn(
              'border-border hover:bg-muted relative inline-flex size-9 shrink-0 items-center justify-center rounded-md border',
              activeFilters > 0 && 'text-primary border-primary/50'
            )}
          >
            <SlidersHorizontal className="size-4" />
            {activeFilters > 0 && (
              <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 rounded-full px-1 text-[9px]">
                {activeFilters}
              </span>
            )}
          </button>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Atualizar todas as conversas"
              aria-busy={refreshing}
              title="Atualizar todas as conversas"
              className="border-border hover:bg-muted focus-visible:outline-primary inline-flex size-9 shrink-0 items-center justify-center rounded-md border focus-visible:outline-2 disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCw
                aria-hidden="true"
                className={cn(
                  'size-4',
                  refreshing && 'animate-spin motion-reduce:animate-none'
                )}
              />
            </button>
          )}
        </div>

        <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Filtrar conversas</DialogTitle>
              <DialogDescription>
                Combine os filtros para encontrar as conversas que precisa
                atender.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm font-medium">
                Status da conversa
                <select
                  aria-label="Status da conversa"
                  className="bg-background mt-2 h-11 w-full rounded-lg border px-3 text-sm font-normal"
                  value={draft.status}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      status: e.target.value as InboxFilter,
                    }))
                  }
                >
                  {FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm font-medium">
                Responsável
                <select
                  aria-label="Responsável pela conversa"
                  className="bg-background mt-2 h-11 w-full rounded-lg border px-3 text-sm font-normal"
                  value={draft.assignee}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, assignee: e.target.value }))
                  }
                >
                  <option value="">Todos os responsáveis</option>
                  {user && <option value="mine">Minhas conversas</option>}
                  <option value="unassigned">Sem responsável</option>
                  {members
                    .filter((m) => m.user_id !== user?.id && m.full_name)
                    .map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.full_name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="space-y-2 text-sm font-medium">
                Número ou perfil
                <select
                  aria-label="Número ou perfil da conversa"
                  className="bg-background mt-2 h-11 w-full rounded-lg border px-3 text-sm font-normal"
                  value={draft.connection}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, connection: e.target.value }))
                  }
                >
                  <option value="">Todos os números e perfis</option>
                  {Array.from(connectionOptions, ([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm font-medium">
                Funil de vendas
                <select
                  aria-label="Funil de vendas"
                  className="bg-background mt-2 h-11 w-full rounded-lg border px-3 text-sm font-normal"
                  value={draft.pipelineId}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, pipelineId: e.target.value }))
                  }
                >
                  <option value="">Todos os funis</option>
                  {pipelines.map((pipeline) => (
                    <option key={pipeline.id} value={pipeline.id}>
                      {pipeline.name}
                    </option>
                  ))}
                </select>
              </label>
              {!!companies.length && (
                <label className="space-y-2 text-sm font-medium sm:col-span-2">
                  Empresa
                  <select
                    aria-label="Empresa"
                    className="bg-background mt-2 h-11 w-full rounded-lg border px-3 text-sm font-normal"
                    value={draft.company}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, company: e.target.value }))
                    }
                  >
                    <option value="">{t('allCompanies')}</option>
                    {companies.map((company) => (
                      <option key={company} value={company}>
                        {company}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <fieldset className="border-t pt-4">
              <legend className="text-sm font-medium">Etiquetas</legend>
              <p className="text-muted-foreground mt-2 mb-3 text-xs">
                Mostra contatos com pelo menos uma das etiquetas selecionadas.
              </p>
              <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                {!tags.length && (
                  <p className="text-muted-foreground text-sm">
                    Nenhuma etiqueta cadastrada.
                  </p>
                )}
                {tags.map((tag) => (
                  <button
                    type="button"
                    key={tag.id}
                    aria-pressed={draft.tagIds.includes(tag.id)}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        tagIds: d.tagIds.includes(tag.id)
                          ? d.tagIds.filter((id) => id !== tag.id)
                          : [...d.tagIds, tag.id],
                      }))
                    }
                    className={cn(
                      'inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm',
                      draft.tagIds.includes(tag.id)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'hover:bg-muted'
                    )}
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="flex justify-between gap-3 border-t pt-4">
              <Button
                variant="outline"
                onClick={() =>
                  setDraft({
                    status: 'all',
                    assignee: '',
                    connection: '',
                    pipelineId: '',
                    tagIds: [],
                    company: '',
                  })
                }
              >
                Limpar filtros
              </Button>
              <Button onClick={applyFilters}>Aplicar filtros</Button>
            </div>
          </DialogContent>
        </Dialog>
        {hasContactFilters && (
          <div className="flex flex-wrap items-center gap-1">
            {pipelineId && (
              <button
                onClick={() => setPipelineId('')}
                className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
              >
                <span className="max-w-36 truncate">
                  Funil:{' '}
                  {pipelines.find((p) => p.id === pipelineId)?.name ??
                    'Selecionado'}
                </span>
                <X className="size-3" />
              </button>
            )}
            {selectedTagIds.map((id) => {
              const tag = tagsById.get(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleTag(id)}
                  className="bg-muted text-foreground hover:bg-muted/70 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: tag?.color ?? 'var(--muted-foreground)',
                    }}
                  />
                  <span className="max-w-24 truncate">
                    {tag?.name ?? t('tags')}
                  </span>
                  <X className="h-3 w-3" />
                </button>
              );
            })}
            {selectedCompany && (
              <button
                onClick={() => setSelectedCompany(null)}
                className="bg-muted text-foreground hover:bg-muted/70 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
              >
                <span className="max-w-24 truncate">{selectedCompany}</span>
                <X className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={clearContactFilters}
              className="text-muted-foreground hover:text-foreground px-1 text-[11px]"
            >
              {t('clearAll')}
            </button>
          </div>
        )}
      </div>

      {/* Conversation Items.
          `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this ScrollArea grows to fit
          every conversation instead of shrinking to the remaining
          space — the list then overflows and gets clipped by the
          parent's overflow-hidden with no scrollbar (issue #229). */}
      <ScrollArea className="min-h-0 flex-1">
        {loading || (pipelineId && !pipelineReady) ? (
          <div className="flex items-center justify-center py-12">
            <div className="border-primary h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        ) : pipelineId && pipelineContacts?.error ? (
          <p role="alert" className="text-destructive p-4 text-sm">
            Não foi possível consultar os leads deste funil. Atualize as
            conversas para tentar novamente.
          </p>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-muted-foreground text-sm">
              {t('noConversations')}
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                t={t}
                canAct={Boolean(accountRole && canSendMessages(accountRole))}
                members={members}
                tags={tags}
                onStatus={() => void quickStatus(conv)}
                onAssign={(id) => void quickAssign(conv, id)}
                onTag={(tag) => void quickTag(conv, tag)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  t: ReturnType<typeof useTranslations>;
  canAct: boolean;
  members: { user_id: string; full_name: string | null }[];
  tags: Tag[];
  onStatus: () => void;
  onAssign: (id: string | null) => void;
  onTag: (tag: Tag) => void;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  t,
  canAct,
  members,
  tags,
  onStatus,
  onAssign,
  onTag,
}: ConversationItemProps) {
  const locale = useLocale();
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || t('unknown');
  const initials = displayName.charAt(0).toUpperCase();

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
        locale: locale === 'pt-BR' ? ptBR : enUS,
      })
    : '';

  return (
    <div
      className={cn(
        'relative',
        isActive && 'border-primary bg-muted/70 border-l-2'
      )}
    >
      <button
        onClick={handleClick}
        className={cn(
          'hover:bg-muted/50 flex w-full items-start gap-3 px-3 py-3 pr-11 text-left transition-colors'
        )}
      >
        {conversation.inbox_channel === 'instagram' ? (
          <div className="bg-muted flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full">
            {contact?.avatar_url ? (
              <img
                src={contact.avatar_url}
                alt=""
                className="size-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              initials
            )}
          </div>
        ) : contact ? (
          <ContactAvatar
            id={contact.id}
            name={displayName}
            url={contact.avatar_url}
            className="size-10"
          />
        ) : (
          <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-full">
            {initials}
          </div>
        )}

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-foreground truncate text-sm font-medium">
              {displayName}
            </span>
            <span className="text-muted-foreground shrink-0 text-[10px]">
              {timeAgo}
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <p className="text-muted-foreground truncate text-xs">
              {conversation.last_message_text || t('noMessagesYet')}
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              {conversation.unread_count > 0 && (
                <span className="bg-primary text-primary-foreground flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold">
                  {conversation.unread_count}
                </span>
              )}
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  STATUS_COLORS[conversation.status]
                )}
                title={conversation.status}
              />
            </div>
          </div>
          <span
            className={cn(
              'mt-1 inline-block rounded-full px-1.5 py-0.5 text-[9px]',
              conversation.inbox_channel === 'instagram'
                ? 'bg-pink-500/10 text-pink-500'
                : 'bg-emerald-500/10 text-emerald-500'
            )}
          >
            {conversation.inbox_channel === 'instagram'
              ? 'Instagram'
              : 'WhatsApp'}
          </span>
        </div>
      </button>
      {canAct && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Ações rápidas para ${displayName}`}
            title="Ações rápidas"
            className="text-muted-foreground hover:bg-muted absolute right-2 bottom-3 flex size-8 items-center justify-center rounded-md"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem onClick={onStatus}>
              {conversation.status === 'closed'
                ? 'Reabrir conversa'
                : 'Fechar conversa'}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Atribuir contato</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                <DropdownMenuItem onClick={() => onAssign(null)}>
                  Sem responsável
                </DropdownMenuItem>
                {members.map((member) => (
                  <DropdownMenuItem
                    key={member.user_id}
                    onClick={() => onAssign(member.user_id)}
                  >
                    {member.full_name ?? 'Usuário'}
                    {conversation.assigned_agent_id === member.user_id && (
                      <Check className="ml-auto size-3" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                Adicionar etiqueta
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                {tags.length ? (
                  tags.map((tag) => (
                    <DropdownMenuItem key={tag.id} onClick={() => onTag(tag)}>
                      <span
                        className="mr-2 size-2 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      {tag.name}
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem disabled>Nenhuma etiqueta</DropdownMenuItem>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
