'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Download, Paperclip, Plus, Send, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { uploadAccountMedia, MEDIA_MAX_BYTES_BY_KIND } from '@/lib/storage/upload-media';
import type { CampaignAction, CampaignAudience, CampaignDelivery, CampaignMessage } from '@/lib/broadcasts/evolution-campaign';
import { brazilPhone, personalizeCampaignMessage, validateSpintax } from '@/lib/broadcasts/evolution-campaign';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

type Contact = { id: string; name: string | null; phone: string };
type Named = { id: string; name: string };
type Stage = Named & { pipeline_id: string };
type Profile = { id: string; full_name: string };
type Channel = { id: string; label: string; channel_key: string; evolution_instance_name: string };
const emptyAction = (): CampaignAction => ({ pipelineId: '', stageId: '', tagId: '', assigneeId: '' });
const control = 'min-h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary';
const weekDays = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

function parseCsv(text: string) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const separator = lines[0]?.includes(';') ? ';' : ',';
  const first = lines[0]?.toLowerCase() ?? '';
  const start = /telefone|phone|celular/.test(first) ? 1 : 0;
  return [...new Map(lines.slice(start).map((line) => {
    const [rawPhone, ...rest] = line.split(separator);
    const phone = brazilPhone(rawPhone ?? '');
    return [phone, { phone, name: rest.join(separator).replace(/^"|"$/g, '').trim() }];
  }).filter(([phone]) => Boolean(phone)) as [string, {phone:string;name:string}][]).values()];
}

function ActionFields({ title, value, onChange, pipelines, stages, tags, profiles }: {
  title: string; value: CampaignAction; onChange: (value: CampaignAction) => void;
  pipelines: Named[]; stages: Stage[]; tags: Named[]; profiles: Profile[];
}) {
  return <fieldset className="space-y-3 rounded-xl border border-border bg-card p-4">
    <legend className="px-1 text-sm font-semibold">{title}</legend>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-xs text-muted-foreground">Mover para funil
        <select className={control} value={value.pipelineId} onChange={(event) => onChange({ ...value, pipelineId: event.target.value, stageId: '' })}>
          <option value="">Não mover</option>{pipelines.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">Etapa
        <select className={control} value={value.stageId} disabled={!value.pipelineId} onChange={(event) => onChange({ ...value, stageId: event.target.value })}>
          <option value="">Primeira etapa</option>{stages.filter((item) => item.pipeline_id === value.pipelineId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">Adicionar etiqueta
        <select className={control} value={value.tagId} onChange={(event) => onChange({ ...value, tagId: event.target.value })}>
          <option value="">Não adicionar</option>{tags.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">Atribuir responsável
        <select className={control} value={value.assigneeId} onChange={(event) => onChange({ ...value, assigneeId: event.target.value })}>
          <option value="">Não alterar</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}
        </select>
      </label>
    </div>
  </fieldset>;
}

export function EvolutionWizard({ onBackToMethod }: { onBackToMethod: () => void }) {
  const router = useRouter();
  const { accountId } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const messageInputs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const spintaxSelection = useRef({ start: 0, end: 0 });
  const [spintaxIndex, setSpintaxIndex] = useState<number | null>(null);
  const [spintaxOptions, setSpintaxOptions] = useState('Olá\nOi\nBom dia');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [messages, setMessages] = useState<CampaignMessage[]>([{ text: '' }]);
  const [audience, setAudience] = useState<CampaignAudience>({
    mode: 'contacts', contactIds: [], csvContacts: [],
    segment: { pipelineId: '', stageIds: [], tagIds: [], assigneeId: '', createdFrom: '', createdTo: '' },
  });
  const [delivery, setDelivery] = useState<CampaignDelivery>({
    senderIds: [], dailyLimit: 100, windowStart: '09:00', windowEnd: '18:00', slots: [],
    weekdays: [1,2,3,4,5], minDelaySeconds: 45, maxDelaySeconds: 120,
    batchSize: 30, batchPauseMinutes: 5, sendNow: true, scheduledAt: '', timeZone: 'America/Sao_Paulo',
  });
  const [onSent, setOnSent] = useState(emptyAction);
  const [onReply, setOnReply] = useState(emptyAction);
  const [confirmed, setConfirmed] = useState(false);
  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [pipelines, setPipelines] = useState<Named[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [tags, setTags] = useState<Named[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);

  useEffect(() => {
    if (!accountId) return;
    let active = true;
    async function load() {
      const db = createClient();
      try {
        const [pipelineResult, stageResult, tagResult, profileResult, channelResult] = await Promise.all([
          db.from('pipelines').select('id,name').eq('account_id', accountId!),
          db.from('pipeline_stages').select('id,name,pipeline_id').order('position'),
          db.from('tags').select('id,name').eq('account_id', accountId!),
          db.from('profiles').select('id,full_name').eq('account_id', accountId!),
          db.from('whatsapp_channels').select('id,label,channel_key,evolution_instance_name').eq('account_id', accountId!).eq('provider', 'evolution'),
        ]);
        const loadedContacts: Contact[] = [];
        for (let offset = 0; offset <= 5000; offset += 1000) {
          const result = await db.from('contacts').select('id,name,phone').eq('account_id', accountId!)
            .order('created_at').range(offset, offset + 999);
          if (result.error) throw result.error;
          loadedContacts.push(...(result.data ?? []));
          if ((result.data ?? []).length < 1000) break;
        }
        for (const result of [pipelineResult, stageResult, tagResult, profileResult, channelResult])
          if (result.error) throw result.error;
        if (!active) return;
        setContacts(loadedContacts.slice(0, 5000)); setPipelines(pipelineResult.data ?? []);
        setStages(stageResult.data ?? []); setTags(tagResult.data ?? []);
        setProfiles(profileResult.data ?? []); setChannels(channelResult.data ?? []);
      } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha ao carregar opções.'); }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [accountId]);

  const visibleContacts = useMemo(() => contacts.filter((contact) =>
    `${contact.name ?? ''} ${contact.phone}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))), [contacts, search]);
  const spintaxGroups = messages.reduce((total, message) =>
    total + (message.text.match(/\{[^{}]*\|[^{}]*\}/g)?.length ?? 0), 0);
  const steps = ['Mensagem', 'Público', 'Envio e ações', 'Resumo'];
  const updateMessage = (index: number, patch: Partial<CampaignMessage>) =>
    setMessages((items) => items.map((item, position) => position === index ? { ...item, ...patch } : item));
  const audienceReady = audience.mode === 'contacts' ? audience.contactIds.length > 0
    : audience.mode === 'csv' ? audience.csvContacts.length > 0
      : Boolean(audience.segment.pipelineId || audience.segment.tagIds.length || audience.segment.assigneeId ||
        audience.segment.createdFrom || audience.segment.createdTo);
  const messagesReady = Boolean(name.trim()) && messages.every((message) =>
    (message.text.trim() || message.mediaUrl) && !validateSpintax(message.text));
  const deliveryReady = delivery.senderIds.length > 0 && delivery.weekdays.length > 0 &&
    delivery.windowStart < delivery.windowEnd && delivery.minDelaySeconds <= delivery.maxDelaySeconds &&
    (delivery.sendNow || Boolean(delivery.scheduledAt));
  const canNext = step === 0 ? messagesReady : step === 1 ? audienceReady : deliveryReady;

  async function attach(index: number, file: File | undefined) {
    if (!file || !accountId) return;
    const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'document';
    if (file.size > MEDIA_MAX_BYTES_BY_KIND[kind]) { toast.error('Arquivo excede o limite de tamanho.'); return; }
    setUploading(index);
    try {
      const result = await uploadAccountMedia('chat-media', file, 'group-broadcast', accountId);
      updateMessage(index, { mediaUrl: result.publicUrl, mediaKind: kind, mediaName: file.name });
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha no anexo.'); }
    finally { setUploading(null); if (fileInput.current) fileInput.current.value = ''; }
  }

  function openSpintax(index: number) {
    const input = messageInputs.current[index];
    spintaxSelection.current = {
      start: input?.selectionStart ?? messages[index].text.length,
      end: input?.selectionEnd ?? messages[index].text.length,
    };
    setSpintaxOptions('Olá\nOi\nBom dia');
    setSpintaxIndex(index);
  }

  function insertSpintax() {
    if (spintaxIndex === null) return;
    const choices = spintaxOptions.split(/\r?\n/).map((choice) => choice.trim()).filter(Boolean);
    if (choices.length < 2 || choices.length > 20 || choices.some((choice) => /[{}|]/.test(choice))) {
      toast.error('Informe de 2 a 20 opções, uma por linha, sem chaves ou barras verticais.');
      return;
    }
    const snippet = `{${choices.join('|')}}`;
    const { start, end } = spintaxSelection.current;
    const index = spintaxIndex;
    if (messages[index].text.length - (end - start) + snippet.length > 4096) {
      toast.error('A mensagem ultrapassaria o limite de 4.096 caracteres.');
      return;
    }
    setMessages((items) => items.map((item, position) => position === index ? {
      ...item, text: `${item.text.slice(0, start)}${snippet}${item.text.slice(end)}`,
    } : item));
    setSpintaxIndex(null);
    requestAnimationFrame(() => {
      const input = messageInputs.current[index];
      input?.focus();
      input?.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  }

  async function create() {
    if (saving || !confirmed) return;
    setSaving(true);
    try {
      const response = await fetch('/api/whatsapp/evolution-campaigns', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), messages, audience,
          delivery: { ...delivery, scheduledAt: delivery.sendNow ? '' : new Date(delivery.scheduledAt).toISOString() },
          onSent, onReply, consentConfirmed: confirmed }),
      });
      const result = await response.json() as { error?: string; campaign_id?: string; recipients?: number };
      if (!response.ok || !result.campaign_id) throw new Error(result.error ?? 'Falha ao criar disparo.');
      toast.success(`Disparo criado para ${result.recipients} contatos.`);
      router.push(`/broadcasts/evolution/${result.campaign_id}`);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha ao criar disparo.'); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Carregando contatos e conexões…</div>;
  return <div className="mx-auto max-w-4xl space-y-5 pb-10">
    <div className="flex flex-wrap items-center gap-2 text-sm">{steps.map((label, index) =>
      <span key={label} className={`rounded-full border px-3 py-1.5 ${step === index ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
        {index + 1}. {label}
      </span>)}</div>

    {step === 0 && <section className="space-y-4">
      <label className="block space-y-1 text-sm font-medium">Nome do disparo
        <input className={control} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: convite para clientes de novembro" maxLength={120} />
      </label>
      <p className="text-sm text-muted-foreground">As mensagens serão alternadas entre os contatos. Você pode usar {'{name}'}, {'{first_name}'}, {'{phone}'} e variações como {'{Olá|Oi|Bom dia}'}.</p>
      {messages.map((message, index) => <div key={index} className="space-y-2 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Mensagem {index + 1}</h2>
          {messages.length > 1 && <Button variant="ghost" size="sm" aria-label={`Remover mensagem ${index + 1}`} onClick={() => setMessages((items) => items.filter((_, position) => position !== index))}><Trash2 className="size-4" /></Button>}</div>
        <textarea ref={(element) => { messageInputs.current[index] = element; }} className={`${control} min-h-32 resize-y`} value={message.text} maxLength={4096}
          onChange={(event) => updateMessage(index, { text: event.target.value })} placeholder="Escreva a mensagem…" />
        {validateSpintax(message.text) && <p className="text-xs text-destructive">{validateSpintax(message.text)}</p>}
        <div className="flex flex-wrap gap-2">{['{name}','{first_name}','{phone}'].map((token) =>
          <Button key={token} type="button" size="sm" variant="outline" onClick={() => updateMessage(index, { text: `${message.text}${message.text ? ' ' : ''}${token}` })}>{token}</Button>)}</div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => openSpintax(index)}>+ Criar spintax</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setPreviewIndex(previewIndex === index ? null : index)}>
            {previewIndex === index ? 'Ocultar prévia' : 'Ver 3 variações'}
          </Button>
        </div>
        {previewIndex === index && <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
          <p className="font-medium text-foreground">Prévia com o contato Maria Silva</p>
          {[1, 2, 3].map((seed) => <p key={seed} className="whitespace-pre-wrap break-words text-muted-foreground">
            {seed}. {personalizeCampaignMessage(message.text, { name: 'Maria Silva', phone: '5511999999999' }, seed)}
          </p>)}
        </div>}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={uploading === index} onClick={() => { fileInput.current?.setAttribute('data-index', String(index)); fileInput.current?.click(); }}>
            <Paperclip className="size-4" /> {uploading === index ? 'Enviando…' : 'Anexar arquivo'}</Button>
          {message.mediaUrl && <><span className="max-w-64 truncate text-xs text-muted-foreground">{message.mediaName}</span>
            <Button variant="ghost" size="sm" onClick={() => updateMessage(index, { mediaUrl: undefined, mediaKind: undefined, mediaName: undefined })}>Remover anexo</Button></>}
        </div>
      </div>)}
      <input ref={fileInput} type="file" className="hidden" accept="image/*,video/*,.pdf,.doc,.docx,.txt,.csv"
        onChange={(event) => void attach(Number(event.target.dataset.index ?? 0), event.target.files?.[0])} />
      <Button variant="outline" disabled={messages.length >= 10} onClick={() => setMessages((items) => [...items, { text: '' }])}><Plus className="size-4" /> Adicionar mensagem</Button>
      <Dialog open={spintaxIndex !== null} onOpenChange={(open) => { if (!open) setSpintaxIndex(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Criar spintax</DialogTitle>
          <DialogDescription>Digite uma opção por linha. Uma delas será escolhida para cada contato.</DialogDescription>
          <label className="space-y-1 text-sm">Opções
            <textarea className={`${control} min-h-32 resize-y`} value={spintaxOptions} onChange={(event) => setSpintaxOptions(event.target.value)} />
          </label>
          <p className="break-words text-xs text-muted-foreground">Resultado: {'{'}{spintaxOptions.split(/\r?\n/).map((choice) => choice.trim()).filter(Boolean).join('|')}{'}'}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setSpintaxIndex(null)}>Cancelar</Button>
            <Button type="button" onClick={insertSpintax}>Inserir na mensagem</Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>}

    {step === 1 && <section className="space-y-4">
      <div role="tablist" aria-label="Origem dos contatos" className="flex flex-wrap gap-2">{([['contacts','Contatos'],['segment','Segmento do CRM'],['csv','Upload de lista']] as const).map(([mode,label]) =>
        <Button key={mode} role="tab" aria-selected={audience.mode === mode} variant={audience.mode === mode ? 'default' : 'outline'}
          onClick={() => setAudience((current) => ({ ...current, mode }))}>{label}</Button>)}</div>
      {audience.mode === 'contacts' && <div className="space-y-3">
        <input className={control} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou telefone" />
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{audience.contactIds.length} selecionados · {visibleContacts.length} encontrados</span>
          <Button variant="outline" size="sm" onClick={() => setAudience((current) => ({ ...current,
            contactIds: [...new Set([...current.contactIds, ...visibleContacts.map((contact) => contact.id)])] }))}>Selecionar todos os resultados</Button>
        </div>
        <div className="max-h-80 divide-y divide-border overflow-y-auto rounded-xl border border-border">{visibleContacts.map((contact) =>
          <label key={contact.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
            <input type="checkbox" checked={audience.contactIds.includes(contact.id)} onChange={() => setAudience((current) => ({ ...current,
              contactIds: current.contactIds.includes(contact.id) ? current.contactIds.filter((id) => id !== contact.id) : [...current.contactIds, contact.id] }))} />
            <span className="min-w-0 truncate">{contact.name || contact.phone}</span><span className="ml-auto text-xs text-muted-foreground">{contact.phone}</span>
          </label>)}</div>
      </div>}
      {audience.mode === 'segment' && <div className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">Funil de vendas<select className={control} value={audience.segment.pipelineId}
            onChange={(event) => setAudience((current) => ({ ...current, segment: { ...current.segment, pipelineId: event.target.value, stageIds: [] } }))}>
            <option value="">Todos os funis</option>{pipelines.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="space-y-1 text-sm">Responsável<select className={control} value={audience.segment.assigneeId}
            onChange={(event) => setAudience((current) => ({ ...current, segment: { ...current.segment, assigneeId: event.target.value } }))}>
            <option value="">Todos</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label>
          <label className="space-y-1 text-sm">Lead criado a partir de<input type="date" className={control} value={audience.segment.createdFrom}
            onChange={(event) => setAudience((current) => ({ ...current, segment: { ...current.segment, createdFrom: event.target.value } }))} /></label>
          <label className="space-y-1 text-sm">Lead criado até<input type="date" className={control} value={audience.segment.createdTo}
            onChange={(event) => setAudience((current) => ({ ...current, segment: { ...current.segment, createdTo: event.target.value } }))} /></label>
        </div>
        {audience.segment.pipelineId && <div><p className="mb-2 text-sm">Etapas do funil</p><div className="flex flex-wrap gap-2">
          {stages.filter((item) => item.pipeline_id === audience.segment.pipelineId).map((item) => <label key={item.id} className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs">
            <input type="checkbox" checked={audience.segment.stageIds.includes(item.id)} onChange={() => setAudience((current) => ({ ...current,
              segment: { ...current.segment, stageIds: current.segment.stageIds.includes(item.id)
                ? current.segment.stageIds.filter((id) => id !== item.id) : [...current.segment.stageIds, item.id] } }))} />{item.name}</label>)}</div></div>}
        <div><p className="mb-2 text-sm">Etiquetas (qualquer uma)</p><div className="flex flex-wrap gap-2">{tags.map((item) => <label key={item.id} className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs">
          <input type="checkbox" checked={audience.segment.tagIds.includes(item.id)} onChange={() => setAudience((current) => ({ ...current,
            segment: { ...current.segment, tagIds: current.segment.tagIds.includes(item.id)
              ? current.segment.tagIds.filter((id) => id !== item.id) : [...current.segment.tagIds, item.id] } }))} />{item.name}</label>)}</div></div>
        <p className="text-xs text-muted-foreground">Os filtros escolhidos são combinados. O total exato será confirmado ao criar o disparo.</p>
      </div>}
      {audience.mode === 'csv' && <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">Arquivo CSV com as colunas telefone e nome. Telefones com DDD; o código 55 é adicionado quando necessário.</p>
        <Button variant="outline" onClick={() => {
          const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob(['telefone;nome\n5511999999999;Maria Silva\n'], { type: 'text/csv;charset=utf-8' }));
          link.download = 'modelo-contatos-disparo.csv'; link.click(); URL.revokeObjectURL(link.href);
        }}><Download className="size-4" /> Baixar modelo CSV</Button>
        <input type="file" accept=".csv,text/csv" className={control} onChange={async (event) => {
          const file = event.target.files?.[0]; if (!file) return;
          if (file.size > 1024 * 1024) { toast.error('CSV acima de 1 MB.'); return; }
          const rows = parseCsv(await file.text());
          setAudience((current) => ({ ...current, csvContacts: rows }));
          toast.success(`${rows.length} contatos válidos carregados.`);
        }} />
        <p className="text-sm">{audience.csvContacts.length} contatos válidos na lista.</p>
      </div>}
    </section>}

    {step === 2 && <section className="space-y-5">
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold">Números para envio</h2><p className="text-xs text-muted-foreground">Os números selecionados serão alternados entre os destinatários.</p>
        {channels.length ? channels.map((channel) => <label key={channel.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-sm">
          <input type="checkbox" checked={delivery.senderIds.includes(channel.id)} onChange={() => setDelivery((current) => ({ ...current,
            senderIds: current.senderIds.includes(channel.id) ? current.senderIds.filter((id) => id !== channel.id) : [...current.senderIds, channel.id] }))} />
          {channel.label}</label>) : <p className="text-sm text-muted-foreground">Conecte um número Evolution em Conexões.</p>}
      </div>
      <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm">Limite diário<input type="number" min={1} max={5000} className={control} value={delivery.dailyLimit}
          onChange={(event) => setDelivery((current) => ({ ...current, dailyLimit: Number(event.target.value) }))} /></label>
        <span className="hidden sm:block" />
        <label className="space-y-1 text-sm">Janela: início<input type="time" className={control} value={delivery.windowStart} onChange={(event) => setDelivery((current) => ({ ...current, windowStart: event.target.value }))} /></label>
        <label className="space-y-1 text-sm">Janela: fim<input type="time" className={control} value={delivery.windowEnd} onChange={(event) => setDelivery((current) => ({ ...current, windowEnd: event.target.value }))} /></label>
        <div className="space-y-2 sm:col-span-2"><div className="flex items-center justify-between"><span className="text-sm">Horários de envio (opcional)</span>
          <Button variant="outline" size="sm" onClick={() => setDelivery((current) => ({ ...current, slots: [...current.slots, { start: '09:00', end: '12:00', limit: 50 }] }))}><Plus className="size-4" /> Horário</Button></div>
          {delivery.slots.map((slot, index) => <div key={index} className="flex flex-wrap items-center gap-2">
            <input aria-label={`Início do horário ${index + 1}`} type="time" className={`${control} w-32`} value={slot.start} onChange={(event) => setDelivery((current) => ({ ...current, slots: current.slots.map((item, i) => i === index ? { ...item, start: event.target.value } : item) }))} />
            <input aria-label={`Fim do horário ${index + 1}`} type="time" className={`${control} w-32`} value={slot.end} onChange={(event) => setDelivery((current) => ({ ...current, slots: current.slots.map((item, i) => i === index ? { ...item, end: event.target.value } : item) }))} />
            <input aria-label={`Limite do horário ${index + 1}`} type="number" min={1} className={`${control} w-24`} value={slot.limit} onChange={(event) => setDelivery((current) => ({ ...current, slots: current.slots.map((item, i) => i === index ? { ...item, limit: Number(event.target.value) } : item) }))} />
            <Button variant="ghost" size="sm" aria-label="Remover horário" onClick={() => setDelivery((current) => ({ ...current, slots: current.slots.filter((_, i) => i !== index) }))}><Trash2 className="size-4" /></Button>
          </div>)}
        </div>
        <div className="space-y-2 sm:col-span-2"><span className="text-sm">Dias permitidos</span><div className="flex flex-wrap gap-2">{weekDays.map((day, index) =>
          <Button key={day} type="button" size="sm" variant={delivery.weekdays.includes(index) ? 'default' : 'outline'} onClick={() => setDelivery((current) => ({ ...current,
            weekdays: current.weekdays.includes(index) ? current.weekdays.filter((number) => number !== index) : [...current.weekdays, index] }))}>{day}</Button>)}</div></div>
        <label className="space-y-1 text-sm">Delay mínimo (segundos)<input type="number" min={30} className={control} value={delivery.minDelaySeconds} onChange={(event) => setDelivery((current) => ({ ...current, minDelaySeconds: Number(event.target.value) }))} /></label>
        <label className="space-y-1 text-sm">Delay máximo (segundos)<input type="number" min={30} className={control} value={delivery.maxDelaySeconds} onChange={(event) => setDelivery((current) => ({ ...current, maxDelaySeconds: Number(event.target.value) }))} /></label>
        <label className="space-y-1 text-sm">Mensagens por lote<input type="number" min={1} className={control} value={delivery.batchSize} onChange={(event) => setDelivery((current) => ({ ...current, batchSize: Number(event.target.value) }))} /></label>
        <label className="space-y-1 text-sm">Pausa após lote (minutos)<input type="number" min={1} className={control} value={delivery.batchPauseMinutes} onChange={(event) => setDelivery((current) => ({ ...current, batchPauseMinutes: Number(event.target.value) }))} /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={delivery.sendNow} onChange={(event) => setDelivery((current) => ({ ...current, sendNow: event.target.checked }))} /> Iniciar na próxima janela permitida</label>
        {!delivery.sendNow && <label className="space-y-1 text-sm sm:col-span-2">Agendar para<input type="datetime-local" className={control} value={delivery.scheduledAt} onChange={(event) => setDelivery((current) => ({ ...current, scheduledAt: event.target.value }))} /></label>}
        <p className="text-xs text-muted-foreground sm:col-span-2">O agendador verifica campanhas a cada minuto. Os intervalos são mínimos; a entrega pode ocorrer depois do horário calculado.</p>
      </div>
      <ActionFields title="Ao enviar (opcional)" value={onSent} onChange={setOnSent} pipelines={pipelines} stages={stages} tags={tags} profiles={profiles} />
      <ActionFields title="Quando o contato responder (opcional)" value={onReply} onChange={setOnReply} pipelines={pipelines} stages={stages} tags={tags} profiles={profiles} />
    </section>}

    {step === 3 && <section className="space-y-4 rounded-xl border border-border bg-card p-5 text-sm">
      <h2 className="text-lg font-semibold">Resumo do disparo</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <p><b>Nome:</b> {name}</p><p><b>Método:</b> Chip WhatsApp (Evolution)</p>
        <p><b>Mensagens:</b> {messages.length} versão(ões) em rotação</p>
        <p><b>Spintax:</b> {spintaxGroups} grupo(s) de variações</p>
        <p><b>Público:</b> {audience.mode === 'contacts' ? `${audience.contactIds.length} contatos` : audience.mode === 'csv' ? `${audience.csvContacts.length} linhas do CSV` : 'segmento do CRM'}</p>
        <p><b>Números:</b> {delivery.senderIds.map((id) => channels.find((channel) => channel.id === id)?.label).join(', ')}</p>
        <p><b>Limite:</b> {delivery.dailyLimit} por dia</p>
        <p><b>Janela:</b> {delivery.windowStart}–{delivery.windowEnd} (Brasília)</p>
        <p><b>Dias:</b> {delivery.weekdays.sort().map((day) => weekDays[day]).join(', ')}</p>
        <p><b>Intervalo:</b> {delivery.minDelaySeconds}–{delivery.maxDelaySeconds} segundos</p>
        <p><b>Lote:</b> {delivery.batchSize} mensagens + {delivery.batchPauseMinutes} min de pausa</p>
        <p><b>Início:</b> {delivery.sendNow ? 'próxima janela permitida' : new Date(delivery.scheduledAt).toLocaleString('pt-BR')}</p>
        <p><b>Ações ao enviar:</b> {Object.values(onSent).filter(Boolean).length || 'nenhuma'}</p>
        <p><b>Ações após resposta:</b> {Object.values(onReply).filter(Boolean).length || 'nenhuma'}</p>
      </div>
      <label className="flex items-start gap-2 rounded-lg border border-border p-3"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        <span>Confirmei que estes contatos podem receber a mensagem e revisei o público, os números e o agendamento.</span></label>
      <p className="text-xs text-muted-foreground">A rotação e os intervalos organizam o envio, mas não garantem ausência de restrições pelo WhatsApp.</p>
    </section>}

    <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
      <Button variant="outline" onClick={() => step ? setStep(step - 1) : onBackToMethod()}><ArrowLeft className="size-4" /> Voltar</Button>
      {step < 3 ? <Button disabled={!canNext} onClick={() => setStep(step + 1)}>Próximo <ArrowRight className="size-4" /></Button>
        : <Button disabled={!confirmed || saving} onClick={() => void create()}><Send className="size-4" /> {saving ? 'Criando…' : 'Criar disparo'}</Button>}
    </div>
  </div>;
}
