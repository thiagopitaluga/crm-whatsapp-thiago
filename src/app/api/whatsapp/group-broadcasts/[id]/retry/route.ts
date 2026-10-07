import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

export const runtime = 'nodejs'

/** Copy only confirmed failures. Uncertain deliveries must be checked manually. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const { id } = await context.params
    const { data: source, error } = await supabase.from('group_broadcasts')
      .select('id, name, message_text, content_kind, media_url, media_name, poll_options, status')
      .eq('id', id).eq('account_id', accountId).single()
    if (error || !source || !['failed', 'partial'].includes(source.status)) {
      return NextResponse.json({ error: 'Somente disparos concluídos com falha podem ser reenviados.' }, { status: 409 })
    }
    const { data: targets, error: targetsError } = await supabase.from('group_broadcast_targets')
      .select('group_jid, group_subject').eq('broadcast_id', id).eq('status', 'failed')
    if (targetsError) throw targetsError
    if (!targets?.length) return NextResponse.json({ error: 'Nenhuma entrega com falha confirmada.' }, { status: 409 })
    const { data: broadcast, error: insertError } = await supabase.from('group_broadcasts').insert({
      account_id: accountId, created_by: userId, name: `Reenvio: ${source.name}`.slice(0, 120),
      message_text: source.message_text, content_kind: source.content_kind,
      media_url: source.media_url, media_name: source.media_name, poll_options: source.poll_options,
      scheduled_at: new Date().toISOString(), status: 'scheduled', total_groups: targets.length,
      retry_of: id,
    }).select('id').single()
    if (insertError || !broadcast) {
      if (insertError?.code === '23505') return NextResponse.json({ error: 'Este disparo já foi reenviado.' }, { status: 409 })
      throw insertError ?? new Error('Não foi possível criar o reenvio.')
    }
    const { error: copyError } = await supabase.from('group_broadcast_targets').insert(
      targets.map((target) => ({ ...target, account_id: accountId, broadcast_id: broadcast.id })),
    )
    if (copyError) {
      await supabase.from('group_broadcasts').delete().eq('id', broadcast.id)
      throw copyError
    }
    return NextResponse.json({ broadcast_id: broadcast.id }, { status: 201 })
  } catch (error) { return toErrorResponse(error) }
}

