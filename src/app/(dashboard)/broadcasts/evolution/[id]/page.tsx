'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Pause, Play, RefreshCw, Search, Copy, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { personalizeCampaignMessage } from '@/lib/broadcasts/evolution-campaign';

type Recipient = { id: string; phone: string; contact_name: string | null; status: string;
  sequence_no: number; message_variant_index: number | null; sent_text: string | null;
  sent_at: string | null; replied_at: string | null; error_message: string | null };
type Campaign = { id: string; name: string; status: string; total_recipients: number;
  sent_count: number; failed_count: number; last_error: string | null; scheduled_at: string | null;
  message_variants: Array<{ text: string; mediaName?: string }>;
  delivery_config: { dailyLimit: number; windowStart: string; windowEnd: string; weekdays: number[];
    minDelaySeconds: number; maxDelaySeconds: number; endAt?: string } };

type RecipientFilter = 'sent' | 'all' | 'pending' | 'issues';

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(value)) : '—';
}

function sentMessage(recipient: Recipient, campaign: Campaign) {
  if (recipient.status !== 'sent' || recipient.message_variant_index === null) return null;
  const variant = campaign.message_variants[recipient.message_variant_index];
  if (!variant) return null;
  const seed = recipient.sequence_no + recipient.phone.split('').reduce((sum, digit) => sum + Number(digit), 0);
  return { text: recipient.sent_text ?? personalizeCampaignMessage(variant.text, {
    phone: recipient.phone, name: recipient.contact_name ?? '',
  }, seed), mediaName: variant.mediaName };
}

function recipientStatus(status: string) {
  if (status === 'sent') return 'Enviado';
  if (status === 'pending') return 'Pendente';
  if (status === 'sending') return 'Enviando';
  if (status === 'failed') return 'Falha';
  if (status === 'uncertain') return 'Entrega incerta';
  return status;
}

function campaignStatus(status: string) {
  if (['scheduled', 'sending'].includes(status)) return 'Em andamento';
  if (status === 'draft') return 'Rascunho';
  if (status === 'paused') return 'Pausado';
  if (status === 'completed') return 'Concluído';
  if (status === 'partial') return 'Encerrado com pendências';
  return status;
}

export default function EvolutionCampaignPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);
  const [recipientFilter, setRecipientFilter] = useState<RecipientFilter>('sent');
  const [recipientSearch, setRecipientSearch] = useState('');
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/whatsapp/evolution-campaigns/${id}`, { cache: 'no-store' });
      const data = await response.json() as { campaign?: Campaign; recipients?: Recipient[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Falha ao carregar disparo.');
      setCampaign(data.campaign ?? null); setRecipients(data.recipients ?? []);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha ao carregar disparo.'); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!['scheduled','sending'].includes(campaign?.status ?? '')) return;
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [campaign?.status, load]);
  async function change(status: 'paused' | 'scheduled'): Promise<boolean> {
    setChanging(true);
    try {
      const response = await fetch(`/api/whatsapp/evolution-campaigns/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Falha ao alterar disparo.');
      await load();
      toast.success(status === 'paused' ? 'Disparo pausado.' : 'Disparo iniciado.');
      return true;
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha ao alterar disparo.'); return false; }
    finally { setChanging(false); }
  }
  async function edit() {
    if (changing || !campaign) return;
    if (['scheduled', 'sending'].includes(campaign.status) && !await change('paused')) return;
    router.push(`/broadcasts/evolution/${id}/edit`);
  }
  async function duplicate() {
    if (changing) return;
    setChanging(true);
    try {
      const response = await fetch(`/api/whatsapp/evolution-campaigns/${id}`, { method: 'POST' });
      const data = await response.json() as { campaign_id?: string; error?: string };
      if (!response.ok || !data.campaign_id) throw new Error(data.error ?? 'Falha ao duplicar disparo.');
      toast.success('Cópia criada como rascunho. Revise antes de iniciar.');
      router.push(`/broadcasts/evolution/${data.campaign_id}/edit`);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha ao duplicar disparo.'); }
    finally { setChanging(false); }
  }
  const search = recipientSearch.trim().toLocaleLowerCase('pt-BR');
  const filteredRecipients = recipients.filter((recipient) => {
    const matchesFilter = recipientFilter === 'all' ||
      (recipientFilter === 'sent' && recipient.status === 'sent') ||
      (recipientFilter === 'pending' && ['pending', 'sending'].includes(recipient.status)) ||
      (recipientFilter === 'issues' && ['failed', 'uncertain'].includes(recipient.status));
    return matchesFilter && (!search || `${recipient.contact_name ?? ''} ${recipient.phone}`.toLocaleLowerCase('pt-BR').includes(search));
  }).sort((a, b) => {
    if (a.sent_at && b.sent_at) return b.sent_at.localeCompare(a.sent_at);
    if (a.sent_at) return -1;
    if (b.sent_at) return 1;
    return a.sequence_no - b.sequence_no;
  });
  if (loading) return <p className="p-8 text-sm text-muted-foreground">Carregando disparo…</p>;
  if (!campaign) return <p className="p-8 text-sm text-muted-foreground">Disparo não encontrado.</p>;
  return <div className="mx-auto max-w-5xl space-y-5 pb-10">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><Button variant="ghost" size="sm" onClick={() => router.push('/broadcasts')}><ArrowLeft className="size-4" /> Voltar</Button>
        <h1 className="mt-2 text-2xl font-bold">{campaign.name}</h1><p className="text-sm text-muted-foreground">Disparo por chip WhatsApp (Evolution) · {campaignStatus(campaign.status)}</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void load()}><RefreshCw className="size-4" /> Atualizar</Button>
        {['scheduled','sending'].includes(campaign.status) && <Button variant="outline" disabled={changing} onClick={() => void change('paused')}><Pause className="size-4" /> Pausar</Button>}
        {['paused','draft'].includes(campaign.status) && <Button disabled={changing} onClick={() => void change('scheduled')}><Play className="size-4" /> {campaign.status === 'draft' ? 'Iniciar' : 'Retomar'}</Button>}
        {['scheduled','sending','paused','draft'].includes(campaign.status) && <Button variant="outline" disabled={changing} onClick={() => void edit()}><Pencil className="size-4" /> Editar</Button>}
        <Button variant="outline" disabled={changing} onClick={() => void duplicate()}><Copy className="size-4" /> Duplicar</Button></div>
    </div>
    {campaign.last_error && <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{campaign.last_error}</p>}
    <div className="grid gap-3 sm:grid-cols-4">{[
      ['Contatos',campaign.total_recipients],['Enviados',campaign.sent_count],['Falhas',campaign.failed_count],
      ['Respostas',recipients.filter((recipient) => recipient.replied_at).length],
    ].map(([label,value]) => <div key={label} className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></div>)}</div>
    <div className="rounded-xl border border-border bg-card p-4 text-sm"><p><b>Agendado:</b> {campaign.scheduled_at ? new Date(campaign.scheduled_at).toLocaleString('pt-BR') : '—'}</p>
      <p><b>Janela:</b> {campaign.delivery_config.windowStart}–{campaign.delivery_config.windowEnd} · limite de {campaign.delivery_config.dailyLimit}/dia</p>
      <p><b>Intervalo:</b> {campaign.delivery_config.minDelaySeconds}–{campaign.delivery_config.maxDelaySeconds} segundos</p>
      {campaign.delivery_config.endAt && <p><b>Encerramento:</b> {new Date(campaign.delivery_config.endAt).toLocaleString('pt-BR')}</p>}
      <p><b>Mensagens em rotação:</b> {campaign.message_variants.length}</p></div>
    <section className="space-y-4 rounded-xl border border-border bg-card p-4" aria-label="Disparos por contato">
      <div><h2 className="font-semibold">Disparos por contato</h2>
        <p className="text-sm text-muted-foreground">Veja a mensagem personalizada, o horário e o resultado de cada envio.</p></div>
      <div className="flex flex-wrap gap-2">{([
        ['sent', 'Enviados', recipients.filter((r) => r.status === 'sent').length],
        ['all', 'Todos', recipients.length],
        ['pending', 'Pendentes', recipients.filter((r) => ['pending', 'sending'].includes(r.status)).length],
        ['issues', 'Falhas e incertos', recipients.filter((r) => ['failed', 'uncertain'].includes(r.status)).length],
      ] as const).map(([value, label, count]) =>
        <Button key={value} type="button" size="sm" variant={recipientFilter === value ? 'default' : 'outline'}
          onClick={() => setRecipientFilter(value)}>{label} ({count})</Button>)}</div>
      <label className="relative block"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <span className="sr-only">Buscar contato ou telefone</span>
        <input className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Buscar contato ou telefone" value={recipientSearch} onChange={(event) => setRecipientSearch(event.target.value)} /></label>
      <div className="space-y-3">{filteredRecipients.length ? filteredRecipients.map((recipient) => {
        const message = sentMessage(recipient, campaign);
        return <article key={recipient.id} className="min-w-0 rounded-lg border border-border p-3 sm:p-4">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><p className="break-words font-medium">{recipient.contact_name || 'Contato sem nome'}</p>
              <p className="text-xs text-muted-foreground">+{recipient.phone}</p></div>
            <div className="text-right text-xs"><span className={recipient.status === 'sent' ? 'font-medium text-emerald-500' :
              ['failed', 'uncertain'].includes(recipient.status) ? 'font-medium text-amber-500' : 'text-muted-foreground'}>
              {recipientStatus(recipient.status)}</span>
              {recipient.sent_at && <p className="mt-1 text-muted-foreground">{formatDate(recipient.sent_at)}</p>}</div>
          </div>
          {message && <div className="mt-3 min-w-0 rounded-lg bg-muted/60 p-3 text-sm">
            <p className="mb-2 text-xs text-muted-foreground">Mensagem enviada · variação {(recipient.message_variant_index ?? 0) + 1}</p>
            <p className="whitespace-pre-wrap break-words">{message.text}</p>
            {message.mediaName && <p className="mt-2 break-words text-xs text-muted-foreground">Anexo: {message.mediaName}</p>}
          </div>}
          {recipient.error_message && <p className="mt-2 break-words text-xs text-amber-500">{recipient.error_message}</p>}
          {recipient.replied_at && <p className="mt-2 text-xs text-muted-foreground">Respondeu em {formatDate(recipient.replied_at)}</p>}
        </article>;
      }) : <p className="py-8 text-center text-sm text-muted-foreground">Nenhum contato encontrado neste filtro.</p>}</div>
    </section>
    <details className="rounded-xl border border-border bg-card p-4 text-sm"><summary className="cursor-pointer font-semibold">Ver as {campaign.message_variants.length} mensagens em rotação</summary>
      <div className="mt-3 space-y-3">{campaign.message_variants.map((variant, index) => <div key={index} className="rounded-lg border border-border p-3">
        <p className="mb-1 text-xs font-medium text-muted-foreground">Variação {index + 1}</p>
        <p className="whitespace-pre-wrap break-words">{variant.text}</p>
        {variant.mediaName && <p className="mt-2 text-xs text-muted-foreground">Anexo: {variant.mediaName}</p>}
      </div>)}</div>
    </details>
    <p className="text-xs text-muted-foreground">“Enviado” confirma que o provedor aceitou a mensagem; não confirma entrega ou leitura. Entregas incertas não são reenviadas automaticamente.</p>
  </div>;
}
