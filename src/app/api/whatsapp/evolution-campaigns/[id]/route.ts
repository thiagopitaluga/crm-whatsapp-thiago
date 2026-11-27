import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { uuidPattern } from '@/lib/broadcasts/evolution-campaign';

type Context = { params: Promise<{ id: string }> };
export const runtime = 'nodejs';

export async function GET(_request: Request, context: Context) {
  try {
    const { accountId } = await requireRole('agent');
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return NextResponse.json({ error: 'ID inválido.' }, { status: 400 });
    const db = supabaseAdmin();
    const { data: campaign, error } = await db.from('evolution_campaigns').select('*')
      .eq('account_id', accountId).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!campaign) return NextResponse.json({ error: 'Disparo não encontrado.' }, { status: 404 });
    const { data: recipients, error: recipientError } = await db.from('evolution_campaign_recipients')
      .select('id,phone,contact_name,status,sent_at,replied_at,error_message,sender_channel_id,message_variant_index')
      .eq('account_id', accountId).eq('campaign_id', id).order('sequence_no').limit(5000);
    if (recipientError) throw recipientError;
    return NextResponse.json({ campaign, recipients: recipients ?? [] }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return toErrorResponse(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { accountId } = await requireRole('admin');
    const { id } = await context.params;
    const input = await request.json().catch(() => null) as { status?: string } | null;
    if (!uuidPattern.test(id) || !['paused','scheduled'].includes(input?.status ?? ''))
      return NextResponse.json({ error: 'Operação inválida.' }, { status: 400 });
    const db = supabaseAdmin();
    const { data: campaign } = await db.from('evolution_campaigns').select('id,status')
      .eq('account_id', accountId).eq('id', id).maybeSingle();
    if (!campaign || !['paused','scheduled','sending'].includes(campaign.status))
      return NextResponse.json({ error: 'Disparo não pode ser alterado.' }, { status: 409 });
    const next = input?.status === 'paused' ? 'paused' : 'scheduled';
    if (next === 'scheduled' && campaign.status !== 'paused')
      return NextResponse.json({ error: 'O disparo já está ativo.' }, { status: 409 });
    const { error } = await db.from('evolution_campaigns').update({
      status: next, next_run_at: next === 'scheduled' ? new Date().toISOString() : undefined,
      locked_at: next === 'paused' ? null : undefined,
      last_error: next === 'scheduled' ? null : undefined,
    }).eq('account_id', accountId).eq('id', id);
    if (error) throw error;
    return NextResponse.json({ status: next });
  } catch (error) { return toErrorResponse(error); }
}
