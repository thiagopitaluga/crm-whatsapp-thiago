'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, Check, ClipboardCopy, ImagePlus, Loader2, RefreshCw, Settings2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { uploadAccountMedia } from '@/lib/storage/upload-media'
import type { GroupAction } from '@/lib/whatsapp/group-actions'

type Group = { group_jid: string; subject: string; is_admin: boolean }
type Channel = { id: string; label: string; phone: string | null; status: string }
type ActionRow = { id: string; group_subject: string; sender_channel_id: string; action: GroupAction; value: string | null;
  scheduled_at: string; status: string; result: string | null; error_message: string | null; executed_at: string | null }

const actions: Array<{ id: GroupAction; label: string; detail: string }> = [
  { id: 'subject', label: 'Alterar nome', detail: 'Atualiza o nome exibido no WhatsApp.' },
  { id: 'description', label: 'Alterar descrição', detail: 'Atualiza as informações do grupo.' },
  { id: 'picture', label: 'Alterar foto', detail: 'Envia uma nova imagem para a capa.' },
  { id: 'announcement', label: 'Somente admins enviam', detail: 'Fecha o envio de mensagens para participantes.' },
  { id: 'not_announcement', label: 'Liberar participantes', detail: 'Permite que todos enviem mensagens.' },
  { id: 'invite', label: 'Gerar link de convite', detail: 'Consulta e registra o link atual.' },
  { id: 'revoke_invite', label: 'Renovar link de convite', detail: 'Invalida o link anterior do grupo.' },
]
const actionLabel = Object.fromEntries(actions.map((action) => [action.id, action.label])) as Record<GroupAction, string>
const statusLabel: Record<string, string> = { scheduled: 'Agendada', running: 'Executando', done: 'Concluída', failed: 'Falhou', cancelled: 'Cancelada' }

export function GroupActionsPanel({ groups, channels, senderChannelId, canSchedule }: {
  groups: Group[]; channels: Channel[]; senderChannelId: string; canSchedule: boolean
}) {
  const [rows, setRows] = useState<ActionRow[]>([])
  const [step, setStep] = useState(1)
  const [groupJid, setGroupJid] = useState('')
  const [action, setAction] = useState<GroupAction>('subject')
  const [value, setValue] = useState('')
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [scheduledAt, setScheduledAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [inviteBusy, setInviteBusy] = useState(false)
  const [link, setLink] = useState('')
  const [uploading, setUploading] = useState(false)
  const chosenGroup = useMemo(() => groups.find((group) => group.group_jid === groupJid), [groups, groupJid])
  const selectedChannel = channels.find((channel) => channel.id === senderChannelId)
  const availableGroups = groups.filter((group) => group.is_admin)

  const refresh = useCallback(async () => {
    const response = await fetch('/api/whatsapp/groups/actions', { cache: 'no-store' })
    const data = await response.json() as { actions?: ActionRow[]; error?: string }
    if (response.ok) setRows(data.actions ?? [])
    else toast.error(data.error ?? 'Não foi possível carregar as automações.')
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { setGroupJid(''); setLink(''); setStep(1) }, [senderChannelId])

  async function uploadPicture(file: File) {
    if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) { toast.error('Escolha uma imagem de até 5 MB.'); return }
    setUploading(true)
    try {
      const result = await uploadAccountMedia('chat-media', file, 'group-broadcast')
      setValue(result.publicUrl)
      toast.success('Imagem pronta.')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível enviar a imagem.') }
    finally { setUploading(false) }
  }

  async function fetchInvite() {
    if (!senderChannelId || !groupJid) return
    setInviteBusy(true)
    try {
      const params = new URLSearchParams({ invite: '1', group_jid: groupJid, sender_channel_id: senderChannelId })
      const response = await fetch(`/api/whatsapp/groups/actions?${params}`, { cache: 'no-store' })
      const data = await response.json() as { invite_url?: string; error?: string }
      if (!response.ok || !data.invite_url) throw new Error(data.error ?? 'O link não foi retornado pelo WhatsApp.')
      setLink(data.invite_url)
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível obter o convite.') }
    finally { setInviteBusy(false) }
  }

  async function submit() {
    if (!senderChannelId || !chosenGroup || !canSchedule) return
    if (action === 'revoke_invite' && !window.confirm('Renovar o convite invalida imediatamente o link anterior. Continuar?')) return
    setBusy(true)
    try {
      const response = await fetch('/api/whatsapp/groups/actions', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sender_channel_id: senderChannelId, group_jid: groupJid, action, value,
          scheduled_at: when === 'now' ? new Date().toISOString() : new Date(scheduledAt).toISOString() }) })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível programar a ação.')
      toast.success(when === 'now' ? 'Ação colocada na fila para executar agora.' : 'Ação agendada.')
      setStep(1); setValue(''); setAction('subject'); setWhen('now'); setLink('')
      await refresh()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível programar a ação.') }
    finally { setBusy(false) }
  }

  async function cancel(id: string) {
    const response = await fetch(`/api/whatsapp/groups/actions?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    const data = await response.json() as { error?: string }
    if (!response.ok) toast.error(data.error ?? 'Não foi possível cancelar.')
    else { toast.success('Ação cancelada.'); await refresh() }
  }

  return <div className="space-y-5">
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2"><Settings2 className="size-5 text-primary" /><h2 className="text-lg font-semibold">Automação de grupos</h2></div>
      <p className="mt-1 text-sm text-muted-foreground">Altere nome, descrição, foto, permissão de mensagens e convite. As ações agendadas usam o número selecionado acima.</p>
      <div aria-label="Etapas da automação" className="mt-5 grid grid-cols-3 gap-2">{['Grupo', 'Ação', 'Programação'].map((label, index) => <button key={label} type="button"
        disabled={index + 1 > step} onClick={() => setStep(index + 1)}
        className={`flex min-h-11 items-center justify-center gap-2 rounded-lg border px-2 text-xs font-medium sm:text-sm ${step === index + 1 ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
        <span className="flex size-5 items-center justify-center rounded-full bg-muted text-xs">{index + 1 < step ? <Check className="size-3" /> : index + 1}</span>{label}</button>)}</div>
      {step === 1 ? <div className="mt-5 space-y-4">
        {!senderChannelId ? <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">Selecione um número de WhatsApp conectado acima para começar.</p> : null}
        {selectedChannel && selectedChannel.status !== 'connected' ? <p className="text-sm text-amber-500">Este número não aparece como conectado. Confira a conexão antes de programar.</p> : null}
        <label className="block text-sm font-medium">Grupo administrado
          <select value={groupJid} onChange={(event) => { setGroupJid(event.target.value); setLink('') }} disabled={!senderChannelId}
            className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Selecione o grupo</option>
            {availableGroups.map((group) => <option key={group.group_jid} value={group.group_jid}>{group.subject}</option>)}</select></label>
        {senderChannelId && availableGroups.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum grupo administrado por este número foi encontrado. Atualize a lista de grupos.</p> : null}
        {groupJid ? <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
          <Button variant="outline" size="sm" disabled={inviteBusy} onClick={() => void fetchInvite()}>{inviteBusy ? <Loader2 className="size-4 animate-spin" /> : <ClipboardCopy className="size-4" />}Ver link de convite</Button>
          {link ? <><span className="min-w-0 flex-1 break-all text-xs text-muted-foreground">{link}</span><Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(link).then(() => toast.success('Link copiado.'))}>Copiar</Button></> : null}
        </div> : null}
        <div className="flex justify-end"><Button disabled={!senderChannelId || !groupJid} onClick={() => setStep(2)}>Próximo</Button></div>
      </div> : null}
      {step === 2 ? <div className="mt-5 space-y-4"><div className="grid gap-2 sm:grid-cols-2">{actions.map((item) =>
        <button key={item.id} type="button" onClick={() => { setAction(item.id); setValue('') }} className={`rounded-lg border p-3 text-left ${action === item.id ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`}>
          <span className="block text-sm font-medium">{item.label}</span><span className="mt-1 block text-xs text-muted-foreground">{item.detail}</span></button>)}</div>
        {action === 'subject' ? <label className="block text-sm">Novo nome<Input value={value} onChange={(event) => setValue(event.target.value)} maxLength={100} className="mt-1" /></label> : null}
        {action === 'description' ? <label className="block text-sm">Nova descrição<textarea value={value} onChange={(event) => setValue(event.target.value)} maxLength={2048} className="mt-1 min-h-28 w-full rounded-md border border-input bg-background p-3" /></label> : null}
        {action === 'picture' ? <label className="block text-sm"><span className="flex items-center gap-2"><ImagePlus className="size-4" />Imagem do grupo</span><Input type="file" accept="image/*" className="mt-1" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadPicture(file) }} />{value ? <span className="mt-1 block text-xs text-primary">Imagem pronta para uso.</span> : null}</label> : null}
        {action === 'revoke_invite' ? <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">O link atual deixará de funcionar assim que esta ação for executada.</p> : null}
        <div className="flex justify-between"><Button variant="outline" onClick={() => setStep(1)}>Voltar</Button><Button disabled={uploading || (action === 'subject' && value.trim().length < 2) || (action === 'picture' && !value)} onClick={() => setStep(3)}>Próximo</Button></div>
      </div> : null}
      {step === 3 ? <div className="mt-5 space-y-4"><div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
        <p><strong>Número:</strong> {selectedChannel?.label}{selectedChannel?.phone ? ` · ${selectedChannel.phone}` : ''}</p>
        <p><strong>Grupo:</strong> {chosenGroup?.subject}</p><p><strong>Ação:</strong> {actionLabel[action]}</p>
        {value && action !== 'picture' ? <p className="whitespace-pre-wrap break-words"><strong>Conteúdo:</strong> {value}</p> : null}</div>
        <div className="grid gap-2 sm:grid-cols-2">{([['now', 'Executar assim que possível'], ['later', 'Agendar data e hora']] as const).map(([id, label]) =>
          <label key={id} className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${when === id ? 'border-primary' : 'border-border'}`}><input type="radio" checked={when === id} onChange={() => setWhen(id)} />{label}</label>)}</div>
        {when === 'later' ? <label className="block text-sm"><CalendarClock className="mr-1 inline size-4" />Data e hora<Input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} className="mt-1" /></label> : null}
        <div className="flex justify-between"><Button variant="outline" onClick={() => setStep(2)}>Voltar</Button><Button disabled={busy || (when === 'later' && (!scheduledAt || Date.parse(scheduledAt) <= Date.now()))} onClick={() => void submit()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{when === 'now' ? 'Executar' : 'Agendar ação'}</Button></div>
      </div> : null}
      {!canSchedule ? <p className="mt-4 text-sm text-muted-foreground">Somente administradores podem programar alterações.</p> : null}
    </section>
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border p-4"><h2 className="font-semibold">Histórico e próximas ações</h2><Button variant="ghost" size="sm" onClick={() => void refresh()}><RefreshCw className="size-4" />Atualizar</Button></div>
      {rows.length === 0 ? <p className="p-5 text-sm text-muted-foreground">Nenhuma automação de grupo programada.</p> : <div className="divide-y divide-border">{rows.map((row) => <div key={row.id} className="flex flex-wrap items-start gap-3 p-4 text-sm">
        <div className="min-w-0 flex-1"><strong className="block break-words">{actionLabel[row.action]} · {row.group_subject}</strong>
          <span className="text-xs text-muted-foreground">{new Date(row.scheduled_at).toLocaleString('pt-BR')} · {channels.find((item) => item.id === row.sender_channel_id)?.label ?? 'Número conectado'}</span>
          {row.error_message ? <p className="mt-1 text-xs text-destructive">{row.error_message}</p> : null}
          {row.result ? <p className="mt-1 break-all text-xs text-primary">{row.result}</p> : null}</div>
        <span className="rounded-full bg-muted px-2 py-1 text-xs">{statusLabel[row.status] ?? row.status}</span>
        {row.status === 'scheduled' && canSchedule ? <Button variant="ghost" size="sm" aria-label="Cancelar ação" onClick={() => void cancel(row.id)}><X className="size-4" /></Button> : null}
      </div>)}</div>}
    </section>
  </div>
}
