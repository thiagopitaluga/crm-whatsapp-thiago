'use client';
import { useEffect, useState } from 'react';
import {
  Info,
  SlidersHorizontal,
  File,
  History,
  ListTodo,
  Radio,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ContactDetailView,
  type ContactDetailTab,
} from '@/components/contacts/contact-detail-view';
import {
  ContactSidebarSections,
  type SidebarTab,
} from './contact-sidebar-sections';
import { ContactDataPanel, type ExtendedContact } from './contact-data-panel';
import { ContactOverview } from './contact-overview';
import type { Contact, Conversation, Deal } from '@/types';
import { cn } from '@/lib/utils';
import { ContactAvatar } from '@/components/contacts/contact-avatar';
const tabs = [
  ['overview', 'Informações', Info],
  ['data', 'Dados', SlidersHorizontal],
  ['files', 'Arquivos', File],
  ['history', 'Histórico', History],
  ['tasks', 'Tarefas', ListTodo],
  ['campaigns', 'Campanhas', Radio],
] as const;
export function ContactSidebar({
  contact,
  conversation = null,
  onContactUpdated,
  initialDealId,
}: {
  contact: Contact | null;
  conversation?: Conversation | null;
  onContactUpdated?: () => void;
  initialDealId?: string;
}) {
  const { accountId } = useAuth();
  const [tab, setTab] = useState<SidebarTab>('overview'),
    [deals, setDeals] = useState<Deal[]>([]),
    [dealId, setDealId] = useState(initialDealId ?? ''),
    [refresh, setRefresh] = useState(0),
    [source, setSource] = useState('WhatsApp'),
    [detail, setDetail] = useState<ContactDetailTab | null>(null),
    [loadError, setLoadError] = useState(false);
  const [current, setCurrent] = useState<ExtendedContact | null>(contact);
  const contactId = contact?.id;
  useEffect(() => {
    if (!contactId || !accountId) return;
    let cancelled = false;
    const db = createClient();
    void Promise.all([
      db
        .from('contacts')
        .select('*')
        .eq('account_id', accountId)
        .eq('id', contactId)
        .single(),
      db
        .from('deals')
        .select('*,stage:pipeline_stages(*)')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false }),
      db
        .from('lead_form_submissions')
        .select('source_type')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .limit(1),
    ]).then(([c, d, f]) => {
      if (cancelled) return;
      setLoadError(!!(c.error || d.error));
      if (c.data) setCurrent(c.data);
      setDeals(d.data ?? []);
      if (f.data?.length)
        setSource(
          f.data[0].source_type.toLowerCase().includes('meta')
            ? 'Formulário Meta'
            : 'Formulário'
        );
      else setSource('WhatsApp');
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, contactId, refresh]);
  function updated() {
    setRefresh((v) => v + 1);
    onContactUpdated?.();
  }
  if (!current)
    return (
      <div className="text-muted-foreground w-80 border-l p-4 text-sm">
        Selecione uma conversa.
      </div>
    );
  const selected = deals.find((d) => d.id === dealId) || deals[0];
  const name = current.name || current.phone;
  return (
    <aside
      aria-label="Ficha do contato"
      className="bg-card flex h-full w-80 flex-col border-l"
    >
      <header className="shrink-0 border-b px-4 pt-5 pb-3 text-center">
        <ContactAvatar
          id={current.id}
          name={name}
          url={current.avatar_url}
          className="bg-primary/10 text-primary mx-auto size-14 text-lg font-semibold"
        />
        <h3 className="mt-2 text-sm font-semibold break-words">{name}</h3>
        <button
          title="Copiar telefone"
          className="text-muted-foreground mt-1 text-xs"
          onClick={() => void navigator.clipboard.writeText(current.phone)}
        >
          {current.phone}
        </button>
        <p className="mt-2">
          <span className="text-primary bg-primary/10 border-primary/20 rounded-full border px-2 py-0.5 text-[10px]">
            {source}
          </span>
        </p>
      </header>
      <nav
        role="tablist"
        aria-label="Ficha do contato"
        className="flex shrink-0 justify-around border-b p-1"
      >
        {tabs.map(([key, label, Icon]) => (
          <button
            key={key}
            title={label}
            aria-label={label}
            role="tab"
            aria-selected={tab === key}
            aria-controls={'contact-panel-' + key}
            onClick={() => setTab(key)}
            className={cn(
              'flex size-10 items-center justify-center border-b-2 transition-colors',
              tab === key
                ? 'border-primary bg-primary/5 text-primary'
                : 'text-muted-foreground hover:bg-muted border-transparent'
            )}
          >
            <Icon className="size-4" />
          </button>
        ))}
      </nav>
      {loadError && (
        <p role="alert" className="text-destructive p-2 text-xs">
          Não foi possível carregar todos os dados.{' '}
          <button onClick={updated}>Tentar novamente</button>
        </p>
      )}
      <div
        id={'contact-panel-' + tab}
        role="tabpanel"
        aria-label={tabs.find((t) => t[0] === tab)?.[1]}
        className="flex min-h-0 flex-1 flex-col"
      >
        {tab === 'overview' || tab === 'data' ? (
          <ScrollArea className="min-h-0 flex-1">
            {tab === 'overview' ? (
              <ContactOverview
                key={current.id}
                contact={current}
                conversation={conversation}
                deals={deals}
                selectedDeal={selected}
                onSelectDeal={setDealId}
                onUpdated={updated}
              />
            ) : (
              <ContactDataPanel
                key={current.id + '-' + (selected?.id ?? '')}
                contact={current}
                dealId={selected?.id}
                onUpdated={updated}
              />
            )}
          </ScrollArea>
        ) : (
          <ContactSidebarSections
            key={current.id + '-' + tab}
            contact={current}
            tab={tab}
            onOpenDetails={setDetail}
          />
        )}
      </div>
      <ContactDetailView
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        contactId={current.id}
        initialTab={detail ?? 'details'}
        onUpdated={updated}
      />
    </aside>
  );
}
