import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { MAX_BROADCAST_GROUPS } from '@/lib/whatsapp/group-broadcast-input'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const [settings, audiences, templates] = await Promise.all([
      supabase.from('group_delivery_settings').select('daily_group_cap, min_interval_ms, pause_on_error').eq('account_id', accountId).maybeSingle(),
      supabase.from('group_audiences').select('id, name, group_jids').eq('account_id', accountId).order('name'),
      supabase.from('group_message_templates').select('id, name, message_text').eq('account_id', accountId).order('name'),
    ])
    if (settings.error || audiences.error || templates.error) throw settings.error ?? audiences.error ?? templates.error
    return NextResponse.json({ settings: settings.data ?? { daily_group_cap: 100, min_interval_ms: 1500, pause_on_error: true },
      audiences: audiences.data ?? [], templates: templates.data ?? [] })
  } catch (error) { return toErrorResponse(error) }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const action = body?.action
    if (action === 'group') {
      const jid = typeof body?.group_jid === 'string' ? body.group_jid : ''
      const folder = typeof body?.folder === 'string' ? body.folder.trim().slice(0, 80) : ''
      const labels = Array.isArray(body?.labels) ? body.labels.filter((label): label is string => typeof label === 'string').map((label) => label.trim().slice(0, 40)).filter(Boolean).slice(0, 10) : []
      if (!/^[^\s@]+@g\.us$/.test(jid)) return NextResponse.json({ error: 'Grupo inválido.' }, { status: 400 })
      const { data, error } = await supabase.from('whatsapp_groups').update({ folder, labels })
        .eq('account_id', accountId).eq('group_jid', jid).select('id').maybeSingle()
      if (error) throw error
      if (!data) return NextResponse.json({ error: 'Grupo não encontrado.' }, { status: 404 })
    } else if (action === 'settings') {
      const cap = Number(body?.daily_group_cap)
      const interval = Number(body?.min_interval_ms)
      if (!Number.isInteger(cap) || cap < 1 || cap > 300 || !Number.isInteger(interval) || interval < 1250 || interval > 10000) {
        return NextResponse.json({ error: 'Limite ou intervalo inválido.' }, { status: 400 })
      }
      const { error } = await supabase.from('group_delivery_settings').upsert({ account_id: accountId,
        daily_group_cap: cap, min_interval_ms: interval, pause_on_error: body?.pause_on_error !== false,
        updated_at: new Date().toISOString() }, { onConflict: 'account_id' })
      if (error) throw error
    } else if (action === 'audience') {
      const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 120) : ''
      const jids = Array.isArray(body?.group_jids) ? [...new Set(body.group_jids.filter((jid): jid is string => typeof jid === 'string' && /^[^\s@]+@g\.us$/.test(jid)))] : []
      if (!name || !jids.length || jids.length > MAX_BROADCAST_GROUPS) return NextResponse.json({ error: 'Nome ou seleção inválidos.' }, { status: 400 })
      const { error } = await supabase.from('group_audiences').upsert({ account_id: accountId, name, group_jids: jids }, { onConflict: 'account_id,name' })
      if (error) throw error
    } else if (action === 'template') {
      const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 120) : ''
      const message = typeof body?.message_text === 'string' ? body.message_text.trim().slice(0, 4096) : ''
      if (!name || !message) return NextResponse.json({ error: 'Nome e texto são obrigatórios.' }, { status: 400 })
      const { error } = await supabase.from('group_message_templates').upsert({ account_id: accountId, name, message_text: message }, { onConflict: 'account_id,name' })
      if (error) throw error
    } else return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
    return NextResponse.json({ saved: true })
  } catch (error) { return toErrorResponse(error) }
}

