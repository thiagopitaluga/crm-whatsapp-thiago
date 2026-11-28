import { serviceEnabled } from '@/lib/billing/server-access'
import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { fetchQrConnector } from '@/lib/whatsapp/qr-connector'
import { executeGroupAction, type GroupAction } from '@/lib/whatsapp/group-actions'

export const runtime = 'nodejs'
export const maxDuration = 60

type Broadcast = {
  id: string; account_id: string; created_by: string; name: string; message_text: string
  content_kind: string; media_url: string | null; media_name: string | null
  poll_options: string[]; recurrence: string; series_id: string | null
  occurrence_no: number; scheduled_at: string; status: string
  sender_channel_id: string | null
}
type Target = { id: string; group_jid: string; group_subject: string }
type Admin = ReturnType<typeof supabaseAdmin>

export async function GET(request: Request) {
  const startedAt = Date.now()
  const expected = process.env.CRON_SECRET ?? process.env.AUTOMATION_CRON_SECRET
  if (!expected) return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? request.headers.get('x-cron-secret') ?? ''
  const left = Buffer.from(supplied); const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = supabaseAdmin()
  await processDueGroupAction(admin)
  const staleBefore = new Date(Date.now() - 90_000).toISOString()
  const { data: stale } = await admin.from('group_broadcasts').select('id')
    .eq('status', 'sending').lt('delivery_locked_at', staleBefore).limit(5)
  for (const row of stale ?? []) {
    // Never silently resend a target that may have been accepted by WhatsApp.
    await admin.from('group_broadcast_targets').update({ status: 'uncertain', error_message: 'Envio interrompido; confira no WhatsApp.' })
      .eq('broadcast_id', row.id).eq('status', 'sending')
    await admin.from('group_broadcasts').update({ delivery_locked_at: null }).eq('id', row.id).eq('status', 'sending')
  }

  const { data: campaigns, error } = await admin.from('group_broadcasts')
    .select('id, account_id, created_by, name, message_text, content_kind, media_url, media_name, poll_options, sender_channel_id, recurrence, series_id, occurrence_no, scheduled_at, status')
    .in('status', ['scheduled', 'sending']).lte('scheduled_at', new Date().toISOString())
    .is('delivery_locked_at', null).order('scheduled_at').limit(1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const campaign = (campaigns ?? [])[0] as Broadcast | undefined
  if (!campaign) return NextResponse.json({ processed: 0 })
  if (!await serviceEnabled(admin, campaign.account_id, 'groupAutomation')) {
    await admin.from('group_broadcasts').update({ status: 'draft', last_error: 'Automação de grupos desabilitada pelo plano ou administrador.' }).eq('id', campaign.id)
    return NextResponse.json({ processed: 0, disabled: true })
  }
  const { data: claimed } = await admin.from('group_broadcasts').update({
    status: 'sending', delivery_locked_at: new Date().toISOString(),
  }).eq('id', campaign.id).eq('status', campaign.status).is('delivery_locked_at', null).select('id').maybeSingle()
  if (!claimed) return NextResponse.json({ processed: 0 })
  let senderInstance: string | undefined
  if (campaign.sender_channel_id) {
    const { data: sender } = await admin.from('whatsapp_channels').select('evolution_instance_name')
      .eq('id', campaign.sender_channel_id).eq('account_id', campaign.account_id).eq('provider', 'evolution').maybeSingle()
    if (!sender) {
      await admin.from('group_broadcast_targets').update({ status: 'failed', error_message: 'Número remetente indisponível.' })
        .eq('broadcast_id', campaign.id).eq('status', 'pending')
      await finalize(admin, campaign, 'Número remetente indisponível.')
      return NextResponse.json({ processed: 1, error: 'sender_unavailable' })
    }
    senderInstance = sender.evolution_instance_name
  }

  const { data: settings } = await admin.from('group_delivery_settings')
    .select('daily_group_cap, min_interval_ms, pause_on_error').eq('account_id', campaign.account_id).maybeSingle()
  const today = new Date(); today.setUTCHours(0, 0, 0, 0)
  const { count: sentToday } = await admin.from('group_broadcast_targets').select('id', { count: 'exact', head: true })
    .eq('account_id', campaign.account_id).eq('status', 'sent').gte('sent_at', today.toISOString())
  let allowance = Math.max(0, (settings?.daily_group_cap ?? 100) - (sentToday ?? 0))
  const { data: pending, error: targetError } = await admin.from('group_broadcast_targets')
    .select('id, group_jid, group_subject').eq('broadcast_id', campaign.id)
    .eq('status', 'pending').order('created_at').limit(12)
  if (targetError) {
    await admin.from('group_broadcasts').update({ delivery_locked_at: null, last_error: targetError.message }).eq('id', campaign.id)
    return NextResponse.json({ error: targetError.message }, { status: 500 })
  }
  if (!pending?.length) { await finalize(admin, campaign); return NextResponse.json({ processed: 1, targets: 0 }) }
  if (allowance === 0) {
    await admin.from('group_broadcasts').update({ status: 'scheduled',
      scheduled_at: new Date(today.getTime() + 86_400_000).toISOString(), delivery_locked_at: null,
      last_error: 'Limite diário atingido; envio adiado.' }).eq('id', campaign.id)
    return NextResponse.json({ processed: 0, paused: 'daily_cap' })
  }
  if (campaign.status === 'scheduled' && Date.now() - Date.parse(campaign.scheduled_at) > 5 * 60_000) {
    await admin.from('group_broadcast_targets').update({ status: 'failed', error_message: 'Horário perdido; reagende.' })
      .eq('broadcast_id', campaign.id).eq('status', 'pending')
    await finalize(admin, campaign, 'Horário perdido; nada foi enviado.')
    return NextResponse.json({ processed: 1, missed: true })
  }

  let processed = 0
  // Reserve time for the provider request and final database updates.
  const interval = Math.max(1250, settings?.min_interval_ms ?? 1500)
  const batchSize = Math.max(1, Math.min(12, Math.floor(35_000 / (interval + 1000))))
  for (const target of (pending as Target[]).slice(0, Math.min(allowance, batchSize))) {
    if (Date.now() - startedAt > 35_000) break
    const { data: locked } = await admin.from('group_broadcast_targets').update({
      status: 'sending', attempted_at: new Date().toISOString(), attempt_count: 1,
    }).eq('id', target.id).eq('status', 'pending').select('id').maybeSingle()
    if (!locked) continue
    let resultStatus: 'sent' | 'failed' | 'uncertain' = 'uncertain'
    let resultError: string | null = 'Resposta não recebida; confirme no WhatsApp antes de repetir.'
    let messageId: string | null = null
    try {
      const response = await fetchQrConnector(campaign.account_id, 'groups/send', {
        method: 'POST', body: JSON.stringify({ text: campaign.message_text, group_ids: [target.group_jid],
          kind: campaign.content_kind, media_url: campaign.media_url, media_name: campaign.media_name,
          poll_options: campaign.poll_options }), signal: AbortSignal.timeout(15_000),
      }, senderInstance ? { instanceName: senderInstance } : {})
      const payload = await response.json().catch(() => null) as { results?: Array<{ status?: string; message_id?: string; error?: string }> } | null
      const result = payload?.results?.[0]
      resultStatus = result?.status === 'sent' ? 'sent' : result?.status === 'failed' || response.status === 409 ? 'failed' : 'uncertain'
      resultError = resultStatus === 'sent' ? null : result?.error ?? `Resposta incerta do conector (${response.status}).`
      messageId = resultStatus === 'sent' ? result?.message_id ?? null : null
    } catch { /* Keep result uncertain: a timeout does not prove non-delivery. */ }
    await admin.from('group_broadcast_targets').update({ status: resultStatus,
      sent_at: resultStatus === 'sent' ? new Date().toISOString() : null,
      message_id: messageId, error_message: resultError,
    }).eq('id', target.id).eq('status', 'sending')
    processed++
    if (resultStatus !== 'sent' && settings?.pause_on_error !== false) {
      await admin.from('group_broadcast_targets').update({ status: 'failed', error_message: 'Não enviado: campanha pausada após erro.' })
        .eq('broadcast_id', campaign.id).eq('status', 'pending')
      break
    }
    allowance--
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
  const { count: remaining } = await admin.from('group_broadcast_targets').select('id', { count: 'exact', head: true })
    .eq('broadcast_id', campaign.id).eq('status', 'pending')
  if (remaining) await admin.from('group_broadcasts').update({ delivery_locked_at: null }).eq('id', campaign.id)
  else await finalize(admin, campaign)
  return NextResponse.json({ processed: 1, targets: processed, remaining: remaining ?? 0 })
}

async function processDueGroupAction(admin: Admin) {
  const { data: stale } = await admin.from('whatsapp_group_actions').select('id')
    .eq('status', 'running').lt('executed_at', new Date(Date.now() - 5 * 60_000).toISOString()).limit(5)
  for (const row of stale ?? []) await admin.from('whatsapp_group_actions').update({
    status: 'failed', error_message: 'Execução interrompida; confira o grupo antes de reagendar.', executed_at: new Date().toISOString(),
  }).eq('id', row.id).eq('status', 'running')
  const { data: due } = await admin.from('whatsapp_group_actions')
    .select('id,account_id,sender_channel_id,group_jid,action,value')
    .eq('status', 'scheduled').lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at').limit(1).maybeSingle()
  if (!due) return
  const { data: claimed } = await admin.from('whatsapp_group_actions').update({ status: 'running', executed_at: new Date().toISOString() })
    .eq('id', due.id).eq('status', 'scheduled').select('id').maybeSingle()
  if (!claimed) return
  try {
    if (!await serviceEnabled(admin, due.account_id, 'groupAutomation')) throw new Error('Automação de grupos desabilitada.')
    const { data: channel } = await admin.from('whatsapp_channels').select('evolution_instance_name')
      .eq('id', due.sender_channel_id).eq('account_id', due.account_id).eq('provider', 'evolution').maybeSingle()
    if (!channel) throw new Error('Número remetente não encontrado.')
    const result = await executeGroupAction(due.account_id, channel.evolution_instance_name, due.group_jid, due.action as GroupAction, due.value)
    await admin.from('whatsapp_group_actions').update({ status: 'done', result, executed_at: new Date().toISOString() }).eq('id', due.id).eq('status', 'running')
  } catch (error) {
    await admin.from('whatsapp_group_actions').update({ status: 'failed',
      error_message: error instanceof Error ? error.message.slice(0, 300) : 'Falha na ação do grupo.', executed_at: new Date().toISOString(),
    }).eq('id', due.id).eq('status', 'running')
  }
}

async function finalize(admin: Admin, campaign: Broadcast, override?: string) {
  const { data: targets } = await admin.from('group_broadcast_targets').select('group_jid, group_subject, status')
    .eq('broadcast_id', campaign.id)
  const sent = (targets ?? []).filter((target) => target.status === 'sent').length
  const failed = (targets ?? []).filter((target) => target.status === 'failed' || target.status === 'uncertain').length
  const uncertain = (targets ?? []).some((target) => target.status === 'uncertain')
  const status = failed === 0 ? 'sent' : sent === 0 ? 'failed' : 'partial'
  await admin.from('group_broadcasts').update({ status, sent_count: sent, failed_count: failed,
    sent_at: new Date().toISOString(), delivery_locked_at: null,
    last_error: override ?? (uncertain ? 'Há entregas incertas; confira no WhatsApp antes de reenviar.' : failed ? 'Alguns grupos não receberam.' : null),
  }).eq('id', campaign.id)
  await admin.from('notifications').insert({ account_id: campaign.account_id, user_id: campaign.created_by,
    type: 'group_broadcast', title: failed ? `Disparo com falhas: ${campaign.name}` : `Disparo concluído: ${campaign.name}`,
    body: `${sent} enviados · ${failed} falharam${uncertain ? ' (inclui entregas incertas)' : ''}.`,
  })
  if (campaign.recurrence === 'none' || !campaign.series_id) return
  const next = new Date(campaign.scheduled_at)
  do {
    if (campaign.recurrence === 'daily') next.setUTCDate(next.getUTCDate() + 1)
    if (campaign.recurrence === 'weekly') next.setUTCDate(next.getUTCDate() + 7)
    if (campaign.recurrence === 'monthly') next.setUTCMonth(next.getUTCMonth() + 1)
  } while (next.getTime() < Date.now() + 60_000)
  const { data: following } = await admin.from('group_broadcasts').insert({
    account_id: campaign.account_id, created_by: campaign.created_by, name: campaign.name,
    message_text: campaign.message_text, content_kind: campaign.content_kind,
    media_url: campaign.media_url, media_name: campaign.media_name, poll_options: campaign.poll_options,
    sender_channel_id: campaign.sender_channel_id,
    recurrence: campaign.recurrence, series_id: campaign.series_id, occurrence_no: campaign.occurrence_no + 1,
    scheduled_at: next.toISOString(), status: 'scheduled', total_groups: targets?.length ?? 0,
  }).select('id').maybeSingle()
  if (following) await admin.from('group_broadcast_targets').insert((targets ?? []).map((target) => ({
    account_id: campaign.account_id, broadcast_id: following.id,
    group_jid: target.group_jid, group_subject: target.group_subject,
  })))
}

