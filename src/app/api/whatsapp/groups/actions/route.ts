import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { serviceEnabled } from '@/lib/billing/server-access'
import { executeGroupAction, parseGroupAction } from '@/lib/whatsapp/group-actions'
import { isAccountGroupMediaUrl } from '@/lib/whatsapp/group-broadcast-input'
import { fetchQrConnector } from '@/lib/whatsapp/qr-connector'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const { accountId, supabase } = await requireRole('agent')
    const params = new URL(request.url).searchParams
    if (params.has('invite')) {
      const groupJid = params.get('group_jid') ?? ''
      const channelId = params.get('sender_channel_id') ?? ''
      if (!/^[^\s@]{1,80}@g\.us$/.test(groupJid)) return NextResponse.json({ error: 'Grupo inválido.' }, { status: 400 })
      const { data: channel } = await supabase.from('whatsapp_channels').select('evolution_instance_name')
        .eq('id', channelId).eq('account_id', accountId).eq('provider', 'evolution').maybeSingle()
      if (!channel) return NextResponse.json({ error: 'Número não encontrado.' }, { status: 404 })
      const link = await executeGroupAction(accountId, channel.evolution_instance_name, groupJid, 'invite', null)
      return NextResponse.json({ invite_url: link }, { headers: { 'cache-control': 'no-store' } })
    }
    const { data, error } = await supabaseAdmin().from('whatsapp_group_actions').select('id,group_jid,group_subject,sender_channel_id,action,value,scheduled_at,status,result,error_message,executed_at,created_at')
      .eq('account_id', accountId).order('scheduled_at', { ascending: false }).limit(100)
    if (error) throw error
    return NextResponse.json({ actions: data ?? [] }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) { return toErrorResponse(error) }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId, supabase } = await requireRole('admin')
    if (process.env.GROUP_BROADCAST_SCHEDULER_ENABLED !== 'true')
      return NextResponse.json({ error: 'O agendador de grupos não está ativo neste ambiente.' }, { status: 503 })
    const parsed = parseGroupAction(await request.json() as Record<string, unknown>)
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const { action, groupJid, senderChannelId, content, scheduledAt } = parsed.value
    if (!await serviceEnabled(supabaseAdmin(), accountId, 'groupAutomation'))
      return NextResponse.json({ error: 'Automação de grupos indisponível para esta conta.' }, { status: 403 })
    if (action === 'picture' && !isAccountGroupMediaUrl(content ?? '', accountId, process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''))
      return NextResponse.json({ error: 'Envie a imagem pela conta atual.' }, { status: 400 })
    const { data: channel } = await supabase.from('whatsapp_channels').select('id,evolution_instance_name').eq('id', senderChannelId)
      .eq('account_id', accountId).eq('provider', 'evolution').maybeSingle()
    if (!channel) return NextResponse.json({ error: 'Número não disponível nesta conta.' }, { status: 400 })
    const groupResponse = await fetchQrConnector(accountId, 'groups', {}, { instanceName: channel.evolution_instance_name })
    if (!groupResponse.ok) return NextResponse.json({ error: 'Não foi possível confirmar os grupos deste número.' }, { status: 502 })
    const groupPayload = await groupResponse.json() as { groups?: Array<{ id?: string; subject?: string; is_admin?: boolean }> }
    const group = groupPayload.groups?.find((item) => item.id === groupJid)
    if (!group || group.is_admin !== true) return NextResponse.json({ error: 'Este número precisa ser administrador do grupo.' }, { status: 403 })
    if (Date.parse(scheduledAt) < Date.now() - 30_000) return NextResponse.json({ error: 'A data já passou.' }, { status: 400 })
    const { data, error } = await supabaseAdmin().from('whatsapp_group_actions').insert({
      account_id: accountId, created_by: userId, sender_channel_id: senderChannelId,
      group_jid: groupJid, group_subject: group.subject ?? 'Grupo', action, value: content, scheduled_at: scheduledAt,
    }).select('id,status,scheduled_at').single()
    if (error) throw error
    return NextResponse.json({ action: data }, { status: 201 })
  } catch (error) { return toErrorResponse(error) }
}

export async function DELETE(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const id = new URL(request.url).searchParams.get('id') ?? ''
    const { data, error } = await supabaseAdmin().from('whatsapp_group_actions').update({ status: 'cancelled' })
      .eq('id', id).eq('account_id', accountId).eq('status', 'scheduled').select('id').maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Ação não encontrada ou já iniciada.' }, { status: 409 })
    return NextResponse.json({ cancelled: true })
  } catch (error) { return toErrorResponse(error) }
}
