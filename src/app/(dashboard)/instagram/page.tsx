'use client';
import { useEffect, useState } from 'react';
import {
  BarChart3,
  Camera,
  Link2,
  MessageCircle,
  Users,
  Workflow,
} from 'lucide-react';
import { InstagramConversations } from './instagram-conversations';
import { InstagramIntegration } from './instagram-integration';
import { InstagramOverview } from './instagram-overview';
import { InstagramContacts } from './instagram-contacts';
import { InstagramAutomations } from './instagram-automations';
const tabs = [
  { id: 'overview', label: 'Visão geral', icon: Camera },
  { id: 'automations', label: 'Automações', icon: Workflow },
  { id: 'conversations', label: 'Conversas', icon: MessageCircle },
  { id: 'contacts', label: 'Contatos', icon: Users },
  { id: 'results', label: 'Resultados', icon: BarChart3 },
  { id: 'integration', label: 'Integração', icon: Link2 },
] as const;
type Tab = (typeof tabs)[number]['id'];
export default function InstagramPage() {
  const [tab, setTab] = useState<Tab>('overview');
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('connection'))
      setTab('integration');
  }, []);
  return (
    <div
      className={
        tab === 'conversations'
          ? 'flex h-full min-h-0 flex-col gap-6 overflow-hidden'
          : 'space-y-6'
      }
    >
      <nav
        aria-label="Seções do Instagram"
        className="border-border flex shrink-0 flex-wrap gap-2 border-b pb-3"
      >
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${tab === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>
      {tab === 'overview' ? (
        <InstagramOverview />
      ) : tab === 'results' ? (
        <InstagramOverview results />
      ) : tab === 'conversations' ? (
        <InstagramConversations />
      ) : tab === 'contacts' ? (
        <InstagramContacts />
      ) : tab === 'integration' ? (
        <InstagramIntegration />
      ) : (
        <InstagramAutomations />
      )}
    </div>
  );
}
