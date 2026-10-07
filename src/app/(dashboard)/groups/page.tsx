'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, Check, ChevronDown, Loader2, Pencil, RefreshCw, Search, Send, Trash2, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCan } from '@/hooks/use-can'
import { MEDIA_MAX_BYTES_BY_KIND, uploadAccountMedia } from '@/lib/storage/upload-media'
import { MAX_BROADCAST_GROUPS, type GroupContentKind, type GroupRecurrence } from '@/lib/whatsapp/group-broadcast-input'
import { GroupMonitorPanel } from './group-monitor-panel'

type Group = { group_jid: string; subject: string; participant_count: number; is_admin: boolean; folder?: string; labels?: string[]; last_message_at?: string | null }
type Audience = { id: string; name: string; group_jids: string[] }
type Template = { id: string; name: string; message_text: string }
type Settings = { daily_group_cap: number; min_interval_ms: number; pause_on_error: boolean }
type Broadcast = {
  id: string; name: string; message_text: string; status: string; scheduled_at: string; sent_at: string | null; created_at: string
  total_groups: number; sent_count: number; failed_count: number; last_error: string | null
  content_kind: GroupContentKind; media_url: string | null; media_name: string | null
  poll_options: string[]; recurrence: GroupRecurrence; retry_of: string | null
  group_broadcast_targets: Array<{ group_jid: string; group_subject: string; status: string; sent_at: string | null; error_message: string | null }>
}

function toLocalDateTime(value: string) {
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function defaultSchedule() {
  const date = new Date(Date.now() + 5 * 60_000)
  date.setSeconds(0, 0)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

const statusClasses: Record<string, string> = {
  scheduled: 'bg-blue-500/10 text-blue-400', sending: 'bg-amber-500/10 text-amber-400',
  sent: 'bg-emerald-500/10 text-emerald-400', partial: 'bg-amber-500/10 text-amber-400',
  failed: 'bg-destructive/10 text-destructive', cancelled: 'bg-muted text-muted-foreground',
}
const statusLabels: Record<string, string> = { scheduled: 'Agendado', sending: 'Enviando', sent: 'Enviado', partial: 'Parcial', failed: 'Falhou', cancelled: 'Cancelado' }

export default function GroupsPage() {
  const canSchedule = useCan('edit-settings')
  const [groups, setGroups] = useState<Group[]>([])
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([])
  const [schedulerEnabled, setSchedulerEnabled] = useState(false)
  const [audiences, setAudiences] = useState<Audience[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [settings, setSettings] = useState<Settings>({ daily_group_cap: 100, min_interval_ms: 1500, pause_on_error: true })
  const [folderFilter, setFolderFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [scheduledAt, setScheduledAt] = useState(defaultSchedule)
  const [kind, setKind] = useState<GroupContentKind>('text')
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [mediaName, setMediaName] = useState<string | null>(null)
  const [pollOptions, setPollOptions] = useState('')
  const [recurrence, setRecurrence] = useState<GroupRecurrence>('none')
  const [sendNow, setSendNow] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = useCallback(async (withDirectory = false) => {
    if (withDirectory) setRefreshing(true)
    try {
      const [groupResponse, broadcastResponse, centerResponse] = await Promise.all([
        fetch('/api/whatsapp/groups', { cache: 'no-store' }),
        fetch('/api/whatsapp/group-broadcasts', { cache: 'no-store' }),
        fetch('/api/whatsapp/group-center', { cache: 'no-store' }),
      ])
      const groupData = await groupResponse.json() as { groups?: Group[]; error?: string; warning?: string }
      const broadcastData = await broadcastResponse.json() as { broadcasts?: Broadcast[]; scheduler_enabled?: boolean; error?: string }
      const centerData = await centerResponse.json() as { audiences?: Audience[]; templates?: Template[]; settings?: Settings; error?: string }
      if (!broadcastResponse.ok) throw new Error(broadcastData.error ?? 'Não foi possível carregar os agendamentos.')
      if (!centerResponse.ok) throw new Error(centerData.error ?? 'Não foi possível carregar as preferências.')
      setGroups(groupResponse.ok ? groupData.groups ?? [] : [])
      setBroadcasts(broadcastData.broadcasts ?? [])
      setSchedulerEnabled(broadcastData.scheduler_enabled === true)
      setAudiences(centerData.audiences ?? []); setTemplates(centerData.templates ?? [])
      if (centerData.settings) setSettings(centerData.settings)
      setError(groupResponse.ok ? groupData.warning ?? null : groupData.error ?? 'Conecte o WhatsApp por QR para atualizar a lista de grupos.')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os grupos.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const selectedGroups = useMemo(() => groups.filter((group) => selected.has(group.group_jid)), [groups, selected])
  const visibleGroups = useMemo(() => groups.filter((group) =>
    (!folderFilter || (group.folder ?? '') === folderFilter) &&
    [group.subject, group.folder ?? '', ...(group.labels ?? [])].join(' ').toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR').trim()),
  ), [groups, search, folderFilter])
  const folders = useMemo(() => [...new Set(groups.map((group) => group.folder).filter((folder): folder is string => !!folder))].sort(), [groups])
  const report = useMemo(() => ({
    scheduled: broadcasts.filter((item) => item.status === 'scheduled').length,
    sent: broadcasts.reduce((sum, item) => sum + item.sent_count, 0),
    failed: broadcasts.reduce((sum, item) => sum + item.failed_count, 0),
    active: groups.filter((group) => !!group.last_message_at && Date.now() - Date.parse(group.last_message_at) < 7 * 86_400_000).length,
  }), [broadcasts, groups])
  const allVisibleSelected = visibleGroups.length > 0 && visibleGroups.every((group) => selected.has(group.group_jid))
  function toggle(jid: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(jid)) next.delete(jid)
      else if (next.size < MAX_BROADCAST_GROUPS) next.add(jid)
      else toast.info(`Selecione até ${MAX_BROADCAST_GROUPS} grupos por disparo.`)
      return next
    })
  }
  function selectAllVisible() {
    setSelected((current) => {
      const next = new Set(current)
      if (allVisibleSelected) visibleGroups.forEach((group) => next.delete(group.group_jid))
      else visibleGroups.forEach((group) => { if (next.size < MAX_BROADCAST_GROUPS) next.add(group.group_jid) })
      if (!allVisibleSelected && visibleGroups.some((group) => !next.has(group.group_jid))) toast.info(`Selecione até ${MAX_BROADCAST_GROUPS} grupos por disparo.`)
      return next
    })
  }

  async function saveCenter(body: Record<string, unknown>, success: string) {
    try {
      const response = await fetch('/api/whatsapp/group-center', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível salvar.')
      toast.success(success); await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível salvar.') }
  }
  function editGroup(group: Group) {
    const folder = window.prompt('Pasta deste grupo:', group.folder ?? '')
    if (folder === null) return
    const labels = window.prompt('Etiquetas separadas por vírgula:', (group.labels ?? []).join(', '))
    if (labels === null) return
    void saveCenter({ action: 'group', group_jid: group.group_jid, folder,
      labels: labels.split(',').map((label) => label.trim()).filter(Boolean) }, 'Grupo organizado.')
  }
  function saveAudience() {
    const audienceName = window.prompt('Nome desta seleção de grupos:')?.trim()
    if (audienceName) void saveCenter({ action: 'audience', name: audienceName, group_jids: [...selected] }, 'Seleção salva.')
  }
  function saveTemplate() {
    const templateName = window.prompt('Nome do modelo de mensagem:')?.trim()
    if (templateName) void saveCenter({ action: 'template', name: templateName, message_text: message }, 'Modelo salvo.')
  }

  async function uploadFile(file: File) {
    if (kind === 'text' || kind === 'poll') return
    if (file.size > MEDIA_MAX_BYTES_BY_KIND[kind]) { toast.error('Arquivo maior que o limite de 16 MB (imagem: 5 MB).'); return }
    setUploading(true)
    try {
      const result = await uploadAccountMedia('chat-media', file, 'group-broadcast')
      setMediaUrl(result.publicUrl)
      setMediaName(file.name)
      toast.success('Arquivo pronto para envio.')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha no upload.') }
    finally { setUploading(false) }
  }

  async function schedule() {
    if (!canSchedule) return
    if (!name.trim() || (!message.trim() && (kind === 'text' || kind === 'poll')) || selectedGroups.length === 0 || selectedGroups.length > MAX_BROADCAST_GROUPS) {
      toast.error(`Informe o nome, a mensagem e selecione entre 1 e ${MAX_BROADCAST_GROUPS} grupos.`)
      return
    }
    if (selectedGroups.length > 30 && !window.confirm(`${editingId ? 'Salvar' : 'Agendar'} este disparo para ${selectedGroups.length} grupos? O envio será gradual e respeitará o limite diário configurado.`)) return
    setScheduling(true)
    try {
      const response = await fetch(editingId ? `/api/whatsapp/group-broadcasts/${editingId}` : '/api/whatsapp/group-broadcasts', {
        method: editingId ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, message_text: message, scheduled_at: new Date(scheduledAt).toISOString(),
          groups: selectedGroups, content_kind: kind, media_url: mediaUrl, media_name: mediaName,
          poll_options: pollOptions.split('\n').map((option) => option.trim()).filter(Boolean),
          recurrence, send_now: !editingId && sendNow }),
      })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível agendar o disparo.')
      toast.success(editingId ? 'Agendamento atualizado.' : 'Disparo para grupos agendado.')
      resetForm()
      await load()
    } catch (scheduleError) {
      toast.error(scheduleError instanceof Error ? scheduleError.message : 'Não foi possível agendar o disparo.')
    } finally { setScheduling(false) }
  }

  function resetForm() {
    setEditingId(null)
    setName('')
    setMessage('')
    setSelected(new Set())
    setScheduledAt(defaultSchedule())
    setKind('text'); setMediaUrl(null); setMediaName(null); setPollOptions(''); setRecurrence('none'); setSendNow(false)
  }

  function startEdit(broadcast: Broadcast) {
    setEditingId(broadcast.id)
    setName(broadcast.name)
    setMessage(broadcast.message_text)
    setScheduledAt(toLocalDateTime(broadcast.scheduled_at))
    setKind(broadcast.content_kind ?? 'text'); setMediaUrl(broadcast.media_url); setMediaName(broadcast.media_name)
    setPollOptions((broadcast.poll_options ?? []).join('\n')); setRecurrence(broadcast.recurrence ?? 'none'); setSendNow(false)
    setSelected(new Set(broadcast.group_broadcast_targets.map((target) => target.group_jid)))
    document.getElementById('group-broadcast-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  function duplicateBroadcast(broadcast: Broadcast) {
    startEdit(broadcast)
    setEditingId(null)
    setName(`Cópia: ${broadcast.name}`.slice(0, 120))
    setScheduledAt(defaultSchedule())
    toast.info('Cópia preparada. Revise os grupos e a data antes de agendar.')
  }

  async function deleteBroadcast(broadcast: Broadcast) {
    if (!canSchedule || !window.confirm(`Excluir o disparo “${broadcast.name}”? O histórico deste disparo será removido. Esta ação não pode ser desfeita.`)) return
    setDeletingId(broadcast.id)
    try {
      const response = await fetch(`/api/whatsapp/group-broadcasts/${broadcast.id}`, { method: 'DELETE' })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível excluir o disparo.')
      if (editingId === broadcast.id) resetForm()
      toast.success('Disparo excluído.')
      await load()
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : 'Não foi possível excluir o disparo.')
    } finally { setDeletingId(null) }
  }

  async function retryFailed(broadcast: Broadcast) {
    if (!canSchedule || !window.confirm(`Reenviar somente aos grupos com falha confirmada em “${broadcast.name}”?`)) return
    try {
      const response = await fetch(`/api/whatsapp/group-broadcasts/${broadcast.id}/retry`, { method: 'POST' })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível reenviar.')
      toast.success('Reenvio dos grupos com falha colocado na fila.'); await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível reenviar.') }
  }

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="size-6 animate-spin text-primary" /></div>

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><UsersRound className="size-6 text-primary" />Grupos</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Visualize os grupos do WhatsApp conectado por QR e programe mensagens para os grupos que você selecionar.</p>
        </div>
        <Button variant="outline" onClick={() => void load(true)} disabled={refreshing}>
          <RefreshCw className={refreshing ? 'animate-spin' : ''} />Atualizar grupos
        </Button>
      </header>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200">
        Use somente grupos que você administra e cujos participantes esperam receber comunicações. A conexão por QR depende do WhatsApp Web e pode exigir uma nova leitura do QR.
      </div>
      {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div> : null}
      {!schedulerEnabled ? <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-200">Os disparos em grupos ainda não estão ativos: o agendador do servidor precisa ser configurado. Você pode consultar e organizar grupos, mas não agendar envios agora.</div> : null}

      <section aria-label="Visão geral dos grupos" className="grid grid-cols-2 gap-3 md:grid-cols-4">{[
        ['Grupos ativos em 7 dias', report.active], ['Disparos agendados', report.scheduled],
        ['Entregas confirmadas', report.sent], ['Falhas ou incertas', report.failed],
      ].map(([label, value]) => <div key={label} className="rounded-xl border border-border bg-card p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>)}</section>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.05fr]">
        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border p-4">
            <div><h2 className="font-semibold">Grupos disponíveis</h2><p className="text-xs text-muted-foreground">{groups.length} grupo{groups.length === 1 ? '' : 's'} na conta conectada</p></div>
            <span className="text-sm font-medium text-primary">{selected.size}/{MAX_BROADCAST_GROUPS} selecionado{selected.size === 1 ? '' : 's'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <div className="relative min-w-40 flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="Buscar grupos" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar grupos..." className="pl-9" /></div>
            <Button variant="outline" size="sm" onClick={selectAllVisible} disabled={visibleGroups.length === 0}>
              {allVisibleSelected ? 'Desmarcar todos' : `Selecionar todos${search ? ' encontrados' : ''}`}
            </Button>
            <select aria-label="Filtrar por pasta" value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-xs"><option value="">Todas as pastas</option>{folders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}</select>
          </div>
          {canSchedule ? <div className="flex flex-wrap gap-2 border-b border-border p-3">
            <Button variant="ghost" size="sm" disabled={selected.size === 0} onClick={saveAudience}>Salvar seleção</Button>
            <select aria-label="Carregar seleção salva" defaultValue="" onChange={(event) => { const audience = audiences.find((item) => item.id === event.target.value); if (audience) setSelected(new Set(audience.group_jids.filter((jid) => groups.some((group) => group.group_jid === jid)).slice(0, MAX_BROADCAST_GROUPS))) }} className="h-9 min-w-40 rounded-md border border-input bg-background px-2 text-xs"><option value="">Seleções salvas</option>{audiences.map((audience) => <option key={audience.id} value={audience.id}>{audience.name}</option>)}</select>
          </div> : null}
          <div className="max-h-[540px] divide-y divide-border overflow-y-auto">
            {visibleGroups.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">{groups.length ? 'Nenhum grupo corresponde à busca.' : 'Nenhum grupo encontrado. Confirme que o WhatsApp está conectado por QR e atualize a lista.'}</div> : visibleGroups.map((group) => {
              const active = selected.has(group.group_jid)
              return <div key={group.group_jid} className="flex items-center hover:bg-muted/60"><button type="button" onClick={() => toggle(group.group_jid)} className="flex min-w-0 flex-1 items-center gap-3 p-4 text-left">
                <span className={`flex size-5 shrink-0 items-center justify-center rounded border ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-input'}`}>{active ? <Check className="size-3.5" /> : null}</span>
                <span className="min-w-0 flex-1"><span className="block truncate font-medium text-foreground">{group.subject}</span><span className="text-xs text-muted-foreground">{group.participant_count} participante{group.participant_count === 1 ? '' : 's'}{group.is_admin ? ' · Você é admin' : ''}{group.folder ? ` · ${group.folder}` : ''}</span>{group.labels?.length ? <span className="block truncate text-xs text-primary">{group.labels.join(' · ')}</span> : null}</span>
                <ChevronDown className="size-4 -rotate-90 text-muted-foreground" />
              </button>{canSchedule ? <button type="button" aria-label={`Organizar ${group.subject}`} title="Pasta e etiquetas" onClick={() => editGroup(group)} className="mr-3 rounded p-2 text-muted-foreground hover:text-primary"><Pencil className="size-4" /></button> : null}</div>
            })}
          </div>
        </section>

        <section id="group-broadcast-form" className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-semibold"><CalendarClock className="size-4 text-primary" />{editingId ? 'Editar disparo agendado' : 'Programar disparo'}</h2>
            {editingId ? <Button variant="ghost" size="sm" onClick={resetForm}>Cancelar edição</Button> : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">A mensagem será enviada uma vez para cada grupo selecionado na data marcada.</p>
          <div className="mt-5 space-y-4">
            <label className="block text-sm font-medium">Nome do disparo<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Ex.: Aviso de reunião" className="mt-1.5" /></label>
            <label className="block text-sm font-medium">Tipo de conteúdo<select value={kind} onChange={(event) => { setKind(event.target.value as GroupContentKind); setMediaUrl(null); setMediaName(null) }} className="mt-1.5 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="text">Texto</option><option value="image">Imagem</option><option value="video">Vídeo</option><option value="audio">Áudio</option><option value="document">Documento</option><option value="poll">Enquete</option>
            </select></label>
            <label className="block text-sm font-medium">{kind === 'poll' ? 'Pergunta da enquete' : 'Mensagem'}<textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4096} placeholder="Escreva a mensagem que será enviada aos grupos..." className="mt-1.5 min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" /></label>
            <p className="text-xs text-muted-foreground">Use <code>{'{{grupo}}'}</code> para o nome de cada grupo e <code>{'{{data}}'}</code> para a data do envio.</p>
            {canSchedule ? <div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" disabled={!message.trim()} onClick={saveTemplate}>Salvar modelo</Button><select aria-label="Usar modelo salvo" defaultValue="" onChange={(event) => { const template = templates.find((item) => item.id === event.target.value); if (template) setMessage(template.message_text) }} className="h-9 min-w-40 rounded-md border border-input bg-background px-2 text-xs"><option value="">Usar modelo salvo</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></div> : null}
            {kind === 'poll' ? <label className="block text-sm font-medium">Opções (uma por linha)<textarea value={pollOptions} onChange={(event) => setPollOptions(event.target.value)} placeholder={'Sim\nNão'} className="mt-1.5 min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" /></label> : null}
            {kind !== 'text' && kind !== 'poll' ? <label className="block text-sm font-medium">Arquivo<input type="file" accept={kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' : kind === 'audio' ? 'audio/*' : undefined} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file) }} className="mt-1.5 block w-full text-sm" />
              <span className="mt-1 block text-xs text-muted-foreground">{uploading ? 'Enviando arquivo...' : mediaName ?? 'Até 16 MB; imagens até 5 MB.'}</span></label> : null}
            {!editingId ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sendNow} onChange={(event) => { setSendNow(event.target.checked); if (event.target.checked) setRecurrence('none') }} /> Enviar assim que possível</label> : null}
            {!sendNow ? <div className="flex items-end gap-3"><label className="min-w-0 flex-1 text-sm font-medium">Data e hora<input type="datetime-local" value={scheduledAt} min={defaultSchedule()} onChange={(event) => setScheduledAt(event.target.value)} className="mt-1.5 flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" /></label><span className="pb-2 text-xs text-muted-foreground">Horário local</span></div> : null}
            {!sendNow ? <label className="block text-sm font-medium">Repetição<select value={recurrence} onChange={(event) => setRecurrence(event.target.value as GroupRecurrence)} className="mt-1.5 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="none">Não repetir</option><option value="daily">Diariamente</option><option value="weekly">Semanalmente</option><option value="monthly">Mensalmente</option></select></label> : null}
            <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground"><strong className="text-foreground">Prévia · {selectedGroups.length} grupos</strong><p className="mt-1 whitespace-pre-wrap break-words">{message || 'Sua mensagem aparecerá aqui.'}</p>{mediaName ? <p className="mt-1">Anexo: {mediaName}</p> : null}</div>
            <Button className="w-full" onClick={() => void schedule()} disabled={!schedulerEnabled || !canSchedule || scheduling || uploading || selectedGroups.length === 0 || selectedGroups.length > MAX_BROADCAST_GROUPS || (kind !== 'text' && kind !== 'poll' && !mediaUrl)}>
              {scheduling ? <Loader2 className="animate-spin" /> : editingId ? <Pencil /> : <Send />}{editingId ? 'Salvar agendamento' : sendNow ? `Enviar para ${selectedGroups.length} grupo${selectedGroups.length === 1 ? '' : 's'}` : `Agendar para ${selectedGroups.length || ''} grupo${selectedGroups.length === 1 ? '' : 's'}`}
            </Button>
            {!canSchedule ? <p className="text-center text-xs text-muted-foreground">Somente administradores podem programar disparos.</p> : null}
          </div>
        </section>
      </div>

      {canSchedule ? <section className="rounded-xl border border-border bg-card p-4"><h2 className="font-semibold">Segurança do envio</h2><p className="mt-1 text-xs text-muted-foreground">Limites por conta. O disparo para ao encontrar um erro se a pausa estiver ativada.</p><div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs">Máximo de grupos por dia<Input type="number" min={1} max={300} value={settings.daily_group_cap} onChange={(event) => setSettings((current) => ({ ...current, daily_group_cap: Number(event.target.value) }))} className="mt-1 w-28" /></label>
        <label className="text-xs">Intervalo entre envios (ms)<Input type="number" min={1250} max={10000} step={250} value={settings.min_interval_ms} onChange={(event) => setSettings((current) => ({ ...current, min_interval_ms: Number(event.target.value) }))} className="mt-1 w-32" /></label>
        <label className="flex h-9 items-center gap-2 text-xs"><input type="checkbox" checked={settings.pause_on_error} onChange={(event) => setSettings((current) => ({ ...current, pause_on_error: event.target.checked }))} /> Pausar após erro</label>
        <Button variant="outline" size="sm" onClick={() => void saveCenter({ action: 'settings', ...settings }, 'Limites atualizados.')}>Salvar limites</Button>
      </div></section> : null}

      <GroupMonitorPanel groups={groups} />

      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border p-4"><h2 className="font-semibold">Agendados e histórico</h2><p className="text-xs text-muted-foreground">Abra um disparo para ver a mensagem e o resultado em cada grupo.</p></div>
        {broadcasts.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">Nenhum disparo para grupos foi programado.</p> : <div className="divide-y divide-border">{broadcasts.map((broadcast) => {
          const expanded = expandedId === broadcast.id
          return <div key={broadcast.id} className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => setExpandedId(expanded ? null : broadcast.id)} aria-expanded={expanded} className="min-w-40 flex-1 text-left hover:text-primary">
                <span className="block font-medium">{broadcast.name}</span>
                <span className="text-xs text-muted-foreground">{new Date(broadcast.scheduled_at).toLocaleString('pt-BR')} · {broadcast.total_groups} grupo{broadcast.total_groups === 1 ? '' : 's'}</span>
              </button>
              <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClasses[broadcast.status] ?? statusClasses.cancelled}`}>{statusLabels[broadcast.status] ?? broadcast.status}</span>
              <span className="text-sm text-muted-foreground">{broadcast.sent_count} enviados · {broadcast.failed_count} falharam</span>
              <Button variant="ghost" size="sm" onClick={() => setExpandedId(expanded ? null : broadcast.id)}>{expanded ? 'Ocultar' : 'Ver detalhes'} <ChevronDown className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`} /></Button>
              {canSchedule ? <Button variant="outline" size="sm" onClick={() => duplicateBroadcast(broadcast)}>Duplicar</Button> : null}
              {canSchedule && broadcast.status === 'scheduled' ? <>
                <Button variant="outline" size="sm" onClick={() => startEdit(broadcast)}><Pencil className="size-4" />Editar</Button>
              </> : null}
              {canSchedule && ['failed', 'partial'].includes(broadcast.status) && broadcast.group_broadcast_targets.some((target) => target.status === 'failed') ? <Button variant="outline" size="sm" onClick={() => void retryFailed(broadcast)}>Reenviar falhas</Button> : null}
              {canSchedule && ['scheduled', 'failed'].includes(broadcast.status) ? <Button variant="ghost" size="sm" className="text-destructive" disabled={deletingId === broadcast.id} onClick={() => void deleteBroadcast(broadcast)}><Trash2 className="size-4" />Excluir</Button> : null}
            </div>
            {broadcast.last_error ? <p className="mt-2 text-xs text-destructive">{broadcast.last_error}</p> : null}
            {expanded ? <div className="mt-4 space-y-3 rounded-lg border border-border bg-muted/20 p-4 text-sm">
              <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mensagem</p><p className="mt-1 whitespace-pre-wrap break-words">{broadcast.message_text}</p>{broadcast.media_name ? <p className="mt-1">Anexo: {broadcast.media_name}</p> : null}</div>
              <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Grupos e resultados</p><ul className="mt-2 divide-y divide-border">{broadcast.group_broadcast_targets.map((target) => <li key={target.group_jid} className="flex flex-wrap justify-between gap-2 py-2"><span>{target.group_subject}</span><span className="text-muted-foreground">{target.status === 'sent' ? `Enviado${target.sent_at ? ` em ${new Date(target.sent_at).toLocaleString('pt-BR')}` : ''}` : target.status === 'failed' ? `Falhou${target.error_message ? `: ${target.error_message}` : ''}` : target.status === 'uncertain' ? 'Incerto: confira no WhatsApp' : 'Pendente'}</span></li>)}</ul></div>
            </div> : null}
          </div>
        })}</div>}
      </section>
    </div>
  )
}

