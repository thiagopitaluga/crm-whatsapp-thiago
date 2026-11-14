import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function DELETE(_request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { agentId } = await params;
    const { count, error: countError } = await supabase
      .from('ai_agents')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId);
    if (countError) throw countError;
    if ((count ?? 0) <= 1) return NextResponse.json({ error: 'A conta precisa manter ao menos um agente.' }, { status: 409 });
    const { data: target, error: targetError } = await supabase
      .from('ai_agents')
      .select('id, is_default')
      .eq('id', agentId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) return NextResponse.json({ error: 'Agente não encontrado.' }, { status: 404 });
    const { error } = await supabase
      .from('ai_agents')
      .delete()
      .eq('id', agentId)
      .eq('account_id', accountId);
    if (error) throw error;
    if (target.is_default) {
      const { data: next } = await supabase
        .from('ai_agents')
        .select('id')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (next) await supabase.from('ai_agents').update({ is_default: true }).eq('id', next.id);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
