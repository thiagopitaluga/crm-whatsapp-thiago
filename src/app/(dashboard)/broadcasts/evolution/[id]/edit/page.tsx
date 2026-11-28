'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { validateSpintax, type CampaignAction, type CampaignDelivery, type CampaignMessage } from '@/lib/broadcasts/evolution-campaign';

type Campaign = {
  id: string; name: string; status: string; total_recipients: number; sent_count: number;
  message_variants: CampaignMessage[]; delivery_config: CampaignDelivery;
  on_sent: CampaignAction; on_reply: CampaignAction;
};
type Named = { id: string; name: string };
type Channel = { id: string; label: string };

const field = 'min-h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';
const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function toLocalInput(iso: string) {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function EditEvolutionCampaignPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { accountId } = useAuth();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [messages, setMessages] = useState<string[]>([]);
  const [delivery, setDelivery] = useState<CampaignDelivery | null>(null);
  const [tags, setTags] = useState<Named[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [onSentTagId, setOnSentTagId] = useState('');
  const [onReplyTagId, setOnReplyTagId] = useState('');

  useEffect(() => {
    if (!accountId) return;
    let active = true;
    async function load() {
      try {
        const db = createClient();
        const [response, tagResult, channelResult] = await Promise.all([
          fetch(`/api/whatsapp/evolution-campaigns/${id}`, { cache: 'no-store' }),
          db.from('tags').select('id,name').eq('account_id', accountId!),
          db.from('whatsapp_channels').select('id,label').eq('account_id', accountId!).eq('provider', 'evolution'),
        ]);
        const result = await response.json() as { campaign?: Campaign; error?: string };
        if (!response.ok || !result.campaign) throw new Error(result.error ?? 'Falha ao carregar disparo.');
        if (tagResult.error) throw tagResult.error;
        if (channelResult.error) throw channelResult.error;
        if (!active) return;
        const loaded = result.campaign;
        setCampaign(loaded); setName(loaded.name);
        setMessages(loaded.message_variants.map((message) => message.text));
        setDelivery(loaded.delivery_config);
        setOnSentTagId(loaded.on_sent?.tagId ?? '');
        setOnReplyTagId(loaded.on_reply?.tagId ?? '');
        setTags(tagResult.data ?? []); setChannels(channelResult.data ?? []);
      } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha ao carregar disparo.'); }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [accountId, id]);

  async function pause() {
    setSaving(true);
    try {
      const response = await fetch(`/api/whatsapp/evolution-campaigns/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'paused' }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Falha ao pausar disparo.');
      setCampaign((current) => current ? { ...current, status: 'paused' } : current);
      toast.success('Disparo pausado. Agora você pode editar.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha ao pausar disparo.'); }
    finally { setSaving(false); }
  }

  async function save() {
    if (!delivery || !campaign || saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/whatsapp/evolution-campaigns/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          edit: { name, messages, delivery: {
            ...delivery, endAt: delivery.endAt ? new Date(delivery.endAt).toISOString() : '',
          } }, onSentTagId, onReplyTagId,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Falha ao salvar disparo.');
      toast.success('Alterações salvas. Inicie ou retome o disparo quando quiser.');
      router.push(`/broadcasts/evolution/${id}`);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha ao salvar disparo.'); }
    finally { setSaving(false); }
  }

  if (loading) return <p className="p-8 text-sm text-muted-foreground">Carregando disparo…</p>;
  if (!campaign || !delivery) return <p className="p-8 text-sm text-muted-foreground">Disparo não encontrado.</p>;
  const editable = ['draft', 'paused'].includes(campaign.status);
  const hasMedia = campaign.message_variants.some((message) => message.mediaUrl);
  const updateDelivery = (changes: Partial<CampaignDelivery>) => setDelivery((current) => current ? { ...current, ...changes } : current);
  return <div className="mx-auto max-w-3xl space-y-5 pb-10">
    <Button variant="ghost" size="sm" onClick={() => router.push(`/broadcasts/evolution/${id}`)}><ArrowLeft className="size-4" /> Voltar ao disparo</Button>
    <div><h1 className="text-2xl font-bold">Editar disparo</h1>
      <p className="mt-1 text-sm text-muted-foreground">{campaign.sent_count} de {campaign.total_recipients} mensagens já enviadas. As alterações valem somente para os próximos envios.</p></div>
    {!editable && <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
      {['scheduled','sending'].includes(campaign.status) ? <><p>Pause o disparo para editar as próximas mensagens e os horários.</p>
        <Button className="mt-3" disabled={saving} onClick={() => void pause()}>Pausar e editar</Button></>
        : <p>Este disparo já foi encerrado. Duplique-o para criar uma nova campanha.</p>}
    </div>}
    {editable && <>
      <p className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">A campanha permanece {campaign.status === 'draft' ? 'em rascunho' : 'pausada'} depois de salvar. Destinatários e mensagens já enviados não são alterados.</p>
      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold">Campanha e mensagens</h2>
        <label className="block space-y-1 text-sm">Nome<input className={field} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
        {messages.map((text, index) => <div key={index} className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between"><span className="text-sm font-medium">Variação {index + 1}</span>
            {!hasMedia && messages.length > 1 && <Button size="icon" variant="ghost" aria-label={`Remover variação ${index + 1}`} onClick={() => setMessages((items) => items.filter((_, position) => position !== index))}><Trash2 className="size-4" /></Button>}</div>
          <textarea className={`${field} min-h-28 resize-y`} maxLength={4096} value={text}
            onChange={(event) => setMessages((items) => items.map((item, position) => position === index ? event.target.value : item))} />
          {campaign.message_variants[index]?.mediaName && <p className="text-xs text-muted-foreground">Anexo mantido: {campaign.message_variants[index].mediaName}</p>}
          {validateSpintax(text) && <p className="text-xs text-destructive">{validateSpintax(text)}</p>}
        </div>)}
        {!hasMedia && messages.length < 10 && <Button variant="outline" onClick={() => setMessages((items) => [...items, ''])}><Plus className="size-4" /> Adicionar variação</Button>}
      </section>
      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold">Envio</h2>
        <div><p className="mb-2 text-sm">Números para envio</p><div className="flex flex-wrap gap-2">{channels.map((channel) =>
          <label key={channel.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <input type="checkbox" checked={delivery.senderIds.includes(channel.id)} onChange={() => updateDelivery({ senderIds: delivery.senderIds.includes(channel.id)
              ? delivery.senderIds.filter((value) => value !== channel.id) : [...delivery.senderIds, channel.id] })} />{channel.label}
          </label>)}</div></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">Limite diário<input type="number" min={1} max={5000} className={field} value={delivery.dailyLimit} onChange={(event) => updateDelivery({ dailyLimit: Number(event.target.value) })} /></label>
          <label className="space-y-1 text-sm">Encerrar em (opcional)<input type="datetime-local" className={field} value={toLocalInput(delivery.endAt)} onChange={(event) => updateDelivery({ endAt: event.target.value })} /></label>
          <label className="space-y-1 text-sm">Janela começa<input type="time" className={field} value={delivery.windowStart} onChange={(event) => updateDelivery({ windowStart: event.target.value })} /></label>
          <label className="space-y-1 text-sm">Janela termina<input type="time" className={field} value={delivery.windowEnd} onChange={(event) => updateDelivery({ windowEnd: event.target.value })} /></label>
          <label className="space-y-1 text-sm">Intervalo mínimo (segundos)<input type="number" min={30} max={3600} className={field} value={delivery.minDelaySeconds} onChange={(event) => updateDelivery({ minDelaySeconds: Number(event.target.value) })} /></label>
          <label className="space-y-1 text-sm">Intervalo máximo (segundos)<input type="number" min={30} max={7200} className={field} value={delivery.maxDelaySeconds} onChange={(event) => updateDelivery({ maxDelaySeconds: Number(event.target.value) })} /></label>
          <label className="space-y-1 text-sm">Mensagens por lote<input type="number" min={1} max={1000} className={field} value={delivery.batchSize} onChange={(event) => updateDelivery({ batchSize: Number(event.target.value) })} /></label>
          <label className="space-y-1 text-sm">Pausa entre lotes (minutos)<input type="number" min={1} max={120} className={field} value={delivery.batchPauseMinutes} onChange={(event) => updateDelivery({ batchPauseMinutes: Number(event.target.value) })} /></label>
        </div>
        <div><p className="mb-2 text-sm">Dias permitidos</p><div className="flex flex-wrap gap-2">{days.map((day, index) => <Button key={day} type="button" size="sm"
          variant={delivery.weekdays.includes(index) ? 'default' : 'outline'} onClick={() => updateDelivery({ weekdays: delivery.weekdays.includes(index)
            ? delivery.weekdays.filter((value) => value !== index) : [...delivery.weekdays, index] })}>{day}</Button>)}</div></div>
      </section>
      <section className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">Etiquetas automáticas</h2>
        <label className="space-y-1 text-sm">Após o envio confirmado<select className={field} value={onSentTagId} onChange={(event) => setOnSentTagId(event.target.value)}>
          <option value="">Nenhuma</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
        </select></label>
        <label className="space-y-1 text-sm">Após o contato responder<select className={field} value={onReplyTagId} onChange={(event) => setOnReplyTagId(event.target.value)}>
          <option value="">Nenhuma</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
        </select></label>
        <p className="text-xs text-muted-foreground sm:col-span-2">Outras ações configuradas no disparo são preservadas.</p>
      </section>
      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => router.push(`/broadcasts/evolution/${id}`)}>Cancelar</Button>
        <Button disabled={saving} onClick={() => void save()}>{saving ? 'Salvando…' : 'Salvar alterações'}</Button></div>
    </>}
  </div>;
}
