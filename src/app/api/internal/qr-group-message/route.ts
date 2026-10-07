import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { isValidQrConnectorSecret } from '@/lib/whatsapp/qr-connector'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (!isValidQrConnectorSecret(request.headers.get('x-connector-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const accountId = typeof body?.account_id === 'string' ? body.account_id : ''
  const groupJid = typeof body?.group_jid === 'string' ? body.group_jid : ''
  const messageId = typeof body?.message_id === 'string' ? body.message_id : ''
  if (!/^[0-9a-f-]{36}$/i.test(accountId) || !/^[^\s@]+@g\.us$/.test(groupJid) || !messageId || messageId.length > 255) {
    return NextResponse.json({ error: 'Invalid group message' }, { status: 400 })
  }
  const admin = supabaseAdmin()
  const { data: known } = await admin.from('whatsapp_groups').select('id')
    .eq('account_id', accountId).eq('group_jid', groupJid).maybeSingle()
  if (!known) return NextResponse.json({ error: 'Unknown group' }, { status: 404 })
  const content = typeof body?.content_text === 'string' ? body.content_text.slice(0, 4096) : ''
  const timestamp = typeof body?.created_at === 'string' && !Number.isNaN(Date.parse(body.created_at))
    ? body.created_at : new Date().toISOString()
  const { error } = await admin.from('group_messages').upsert({
    account_id: accountId, group_jid: groupJid, message_id: messageId,
    participant_jid: typeof body?.participant_jid === 'string' ? body.participant_jid.slice(0, 100) : null,
    participant_name: typeof body?.participant_name === 'string' ? body.participant_name.slice(0, 200) : null,
    from_me: body?.from_me === true,
    message_type: typeof body?.message_type === 'string' ? body.message_type.slice(0, 30) : 'text',
    content_text: content,
    created_at: timestamp,
  }, { onConflict: 'account_id,group_jid,message_id', ignoreDuplicates: true })
  if (error) return NextResponse.json({ error: 'Could not save group message' }, { status: 500 })
  await admin.from('whatsapp_groups').update({ last_message_at: timestamp })
    .eq('account_id', accountId).eq('group_jid', groupJid)
  return NextResponse.json({ stored: true })
}

