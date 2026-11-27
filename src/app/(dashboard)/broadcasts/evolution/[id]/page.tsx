'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Pause, Play, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Recipient = { id: string; phone: string; contact_name: string | null; status: string;
  sent_at: string | null; replied_at: string | null; error_message: string | null };
type Campaign = { id: string; name: string; status: string; total_recipients: number;
  sent_count: number; failed_count: number; last_error: string | null; scheduled_at: string | null;
  message_variants: Array<{ text: string; mediaName?: string }>;
  delivery_config: { dailyLimit: number; windowStart: string; windowEnd: string; weekdays: number[];
    minDelaySeconds: number; maxDelaySeconds: number } };

export default function EvolutionCampaignPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);
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
  async function change(status: 'paused' | 'scheduled') {
    setChanging(true);
    try {
      const response = await fetch(`/api/whatsapp/evolution-campaigns/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Falha ao alterar disparo.');
      await load();
      toast.success(status === 'paused' ? 'Disparo pausado.' : 'Disparo retomado.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha ao alterar disparo.'); }
    finally { setChanging(false); }
  }
  if (loading) return <p className="p-8 text-sm text-muted-foreground">Carregando disparo…</p>;
  if (!campaign) return <p className="p-8 text-sm text-muted-foreground">Disparo não encontrado.</p>;
  return <div className="mx-auto max-w-5xl space-y-5 pb-10">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><Button variant="ghost" size="sm" onClick={() => router.push('/broadcasts')}><ArrowLeft className="size-4" /> Voltar</Button>
        <h1 className="mt-2 text-2xl font-bold">{campaign.name}</h1><p className="text-sm text-muted-foreground">Disparo por chip WhatsApp (Evolution) · {campaign.status}</p></div>
      <div className="flex gap-2"><Button variant="outline" onClick={() => void load()}><RefreshCw className="size-4" /> Atualizar</Button>
        {['scheduled','sending'].includes(campaign.status) && <Button variant="outline" disabled={changing} onClick={() => void change('paused')}><Pause className="size-4" /> Pausar</Button>}
        {campaign.status === 'paused' && <Button disabled={changing} onClick={() => void change('scheduled')}><Play className="size-4" /> Retomar</Button>}</div>
    </div>
    {campaign.last_error && <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{campaign.last_error}</p>}
    <div className="grid gap-3 sm:grid-cols-4">{[
      ['Contatos',campaign.total_recipients],['Enviados',campaign.sent_count],['Falhas',campaign.failed_count],
      ['Respostas',recipients.filter((recipient) => recipient.replied_at).length],
    ].map(([label,value]) => <div key={label} className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></div>)}</div>
    <div className="rounded-xl border border-border bg-card p-4 text-sm"><p><b>Agendado:</b> {campaign.scheduled_at ? new Date(campaign.scheduled_at).toLocaleString('pt-BR') : '—'}</p>
      <p><b>Janela:</b> {campaign.delivery_config.windowStart}–{campaign.delivery_config.windowEnd} · limite de {campaign.delivery_config.dailyLimit}/dia</p>
      <p><b>Mensagens em rotação:</b> {campaign.message_variants.length}</p></div>
    <div className="overflow-x-auto rounded-xl border border-border bg-card"><table className="w-full text-left text-sm">
      <thead className="border-b border-border text-muted-foreground"><tr><th className="p-3">Contato</th><th className="p-3">Telefone</th><th className="p-3">Status</th><th className="p-3">Enviado</th><th className="p-3">Resposta</th></tr></thead>
      <tbody className="divide-y divide-border">{recipients.map((recipient) => <tr key={recipient.id}>
        <td className="p-3">{recipient.contact_name || '—'}</td><td className="p-3">+{recipient.phone}</td>
        <td className="p-3">{recipient.status}{recipient.error_message ? <span className="block text-xs text-amber-500">{recipient.error_message}</span> : null}</td>
        <td className="p-3">{recipient.sent_at ? new Date(recipient.sent_at).toLocaleString('pt-BR') : '—'}</td>
        <td className="p-3">{recipient.replied_at ? new Date(recipient.replied_at).toLocaleString('pt-BR') : '—'}</td>
      </tr>)}</tbody></table></div>
    <p className="text-xs text-muted-foreground">Entregas incertas não são reenviadas automaticamente. Confira o WhatsApp antes de retomar o disparo.</p>
  </div>;
}
