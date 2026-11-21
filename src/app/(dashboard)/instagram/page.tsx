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
import { AutomationStatus } from './automation-status';
import { InstagramMediaPicker } from './instagram-media-picker';

const tabs = [
  { id: 'overview', label: 'Visão geral', icon: Camera },
  { id: 'automations', label: 'Automações', icon: Workflow },
  { id: 'conversations', label: 'Conversas', icon: MessageCircle },
  { id: 'contacts', label: 'Contatos', icon: Users },
  { id: 'results', label: 'Resultados', icon: BarChart3 },
  { id: 'integration', label: 'Integração', icon: Link2 },
] as const;
type Tab = (typeof tabs)[number]['id'];
type Automation = {
  id: string;
  name: string;
  trigger_type: string;
  keywords: string;
  reply_text: string;
  is_active: boolean;
  channel_id: string | null;
  target_media_id: string | null;
};
const labels: Record<string, string> = {
  message_keyword: 'Palavra-chave no Direct',
  first_message: 'Primeira mensagem',
  comment_keyword: 'Comentário em publicação',
};

export default function InstagramPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [items, setItems] = useState<Automation[]>([]);
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState('message_keyword');
  const [keywords, setKeywords] = useState('');
  const [mediaId, setMediaId] = useState('');
  const [mediaChannel, setMediaChannel] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('connection')) setTab('integration');
  }, []);
  useEffect(() => {
    if (tab !== 'automations') return;
    const controller = new AbortController();
    fetch('/api/instagram/automations', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Não foi possível carregar os rascunhos.');
        return response.json();
      })
      .then((body) => setItems(body.automations ?? []))
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    return () => controller.abort();
  }, [tab]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/instagram/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          trigger_type: trigger,
          keywords,
          reply_text: reply,
          target_media_id: trigger === 'comment_keyword' ? mediaId : '',
          channel_id: mediaChannel,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || 'Não foi possível salvar.');
      setItems((previous) => [body.automation, ...previous]);
      setName('');
      setKeywords('');
      setReply('');
      setMediaId('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Erro ao salvar.');
    } finally {
      setBusy(false);
    }
  }
  const field =
    'border-border bg-background w-full rounded-lg border px-3 py-2';
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-bold">Instagram</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Atendimento e automações para seus perfis profissionais.
        </p>
      </header>
      <nav
        aria-label="Seções do Instagram"
        className="border-border flex flex-wrap gap-2 border-b pb-3"
      >
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => {
              setTab(id);
              setError('');
            }}
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
      ) : tab === 'contacts' ? (
        <InstagramContacts />
      ) : tab === 'conversations' ? (
        <InstagramConversations />
      ) : tab === 'integration' ? (
        <InstagramIntegration />
      ) : tab === 'automations' ? (
        <div className="space-y-4">
          <section className="border-border bg-card space-y-4 rounded-xl border p-5">
            <h2 className="font-semibold">Criar rascunho de automação</h2>
            <p className="text-muted-foreground text-sm">
              Os rascunhos são salvos para configuração. A execução pelo
              Instagram ainda está em desenvolvimento.
            </p>
            <form onSubmit={save} className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                Nome
                <input
                  required
                  maxLength={150}
                  className={field}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm">
                Gatilho
                <select
                  className={field}
                  value={trigger}
                  onChange={(e) => setTrigger(e.target.value)}
                >
                  {Object.entries(labels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {trigger !== 'first_message' && (
                <label className="space-y-1 text-sm">
                  Palavras-chave
                  <input
                    className={field}
                    value={keywords}
                    onChange={(e) => setKeywords(e.target.value)}
                    placeholder="Separe por vírgulas"
                  />
                </label>
              )}
              {trigger === 'comment_keyword' && (
                <InstagramMediaPicker
                  channel={mediaChannel}
                  media={mediaId}
                  onChannel={setMediaChannel}
                  onMedia={setMediaId}
                />
              )}
              <label className="space-y-1 text-sm md:col-span-2">
                Mensagem
                <textarea
                  className={field}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={3}
                />
              </label>
              <button
                disabled={busy}
                className="bg-primary text-primary-foreground w-fit rounded-lg px-4 py-2 text-sm"
              >
                {busy ? 'Salvando...' : 'Salvar rascunho'}
              </button>
            </form>
          </section>
          <section className="border-border bg-card rounded-xl border p-5">
            <h2 className="font-semibold">Rascunhos</h2>
            {items.length ? (
              items.map((item) => (
                <div
                  key={item.id}
                  className="border-border border-t py-3 text-sm"
                >
                  <strong>{item.name}</strong>
                  <p className="text-muted-foreground">
                    {labels[item.trigger_type]} ·{' '}
                    {item.is_active ? 'Ativa' : 'Rascunho'}
                  </p>
                  <AutomationStatus
                    id={item.id}
                    active={item.is_active}
                    channelId={item.channel_id}
                    locked={Boolean(item.target_media_id)}
                    onUpdate={(active, channelId) =>
                      setItems((previous) =>
                        previous.map((a) =>
                          a.id === item.id
                            ? { ...a, is_active: active, channel_id: channelId }
                            : a
                        )
                      )
                    }
                  />
                </div>
              ))
            ) : (
              <p className="text-muted-foreground mt-3 text-sm">
                Nenhum rascunho criado.
              </p>
            )}
          </section>
        </div>
      ) : (
        <section className="border-border bg-card rounded-xl border p-5">
          <h2 className="font-semibold">
            {tabs.find((item) => item.id === tab)?.label}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            {tab === 'overview'
              ? 'O painel de Instagram está em implementação.'
              : 'Esta seção está em implementação e ficará disponível após a integração com o Instagram.'}
          </p>
        </section>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
