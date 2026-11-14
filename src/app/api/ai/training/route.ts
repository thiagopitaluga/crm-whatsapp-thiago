import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { data, error } = await supabase
      .from('ai_training_examples')
      .select('id, customer_message, agent_reply, status, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return NextResponse.json({ examples: data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const body = await request.json().catch(() => null);
    const id = typeof body?.id === 'string' ? body.id : '';
    const status = body?.status;
    if (!id || !['approved', 'rejected'].includes(status)) {
      return NextResponse.json(
        { error: 'Exemplo ou decisão inválida.' },
        { status: 400 }
      );
    }
    const { data, error } = await supabase
      .from('ai_training_examples')
      .update({
        status,
        reviewed_at: new Date().toISOString(),
        reviewed_by: userId,
      })
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return NextResponse.json(
        { error: 'Exemplo não encontrado.' },
        { status: 404 }
      );
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const id = new URL(request.url).searchParams.get('id');
    if (!id)
      return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });
    const { error } = await supabase
      .from('ai_training_examples')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
