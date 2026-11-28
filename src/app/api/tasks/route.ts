import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { deleteCalendarTask, syncCalendarTask } from '@/lib/google-calendar/tasks';

export const runtime = 'nodejs';

type TaskInput = {
  id?: string;
  title?: string;
  description?: string | null;
  contact_id?: string;
  deal_id?: string | null;
  assigned_to?: string | null;
  due_at?: string;
  status?: 'open' | 'completed' | 'cancelled';
};

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

async function writeTask(request: Request, updating: boolean) {
  try {
    const ctx = await requireRole('agent');
    const body = (await request.json()) as TaskInput;
    if (updating && !body.id) return badRequest('Tarefa não informada');
    if (!updating && (!body.title?.trim() || !body.contact_id || !body.due_at)) return badRequest('Preencha título, contato e data');
    if (body.due_at && Number.isNaN(new Date(body.due_at).getTime())) return badRequest('Data inválida');
    if (body.contact_id) {
      const { data } = await ctx.supabase.from('contacts').select('id').eq('id', body.contact_id).eq('account_id', ctx.accountId).maybeSingle();
      if (!data) return badRequest('Contato inválido para esta conta');
    }
    if (body.deal_id) {
      const { data } = await ctx.supabase.from('deals').select('id').eq('id', body.deal_id).eq('account_id', ctx.accountId).maybeSingle();
      if (!data) return badRequest('Negócio inválido para esta conta');
    }
    if (body.assigned_to) {
      const { data } = await ctx.supabase.from('profiles').select('id').eq('id', body.assigned_to).eq('account_id', ctx.accountId).maybeSingle();
      if (!data) return badRequest('Responsável inválido para esta conta');
    }
    const values: Record<string, unknown> = {};
    for (const key of ['title', 'description', 'contact_id', 'deal_id', 'assigned_to', 'due_at', 'status'] as const) {
      if (body[key] !== undefined) values[key] = key === 'title' ? body.title?.trim() : body[key];
    }
    if (body.status !== undefined) values.completed_at = body.status === 'completed' ? new Date().toISOString() : null;
    const query = updating
      ? ctx.supabase.from('tasks').update(values).eq('id', body.id!).eq('account_id', ctx.accountId)
      : ctx.supabase.from('tasks').insert({ ...values, account_id: ctx.accountId, user_id: ctx.userId, status: 'open' });
    const { data: task, error } = await query.select('*').single();
    if (error || !task) return NextResponse.json({ error: 'Não foi possível salvar a tarefa' }, { status: 400 });
    try {
      const calendarSync = await syncCalendarTask(task);
      return NextResponse.json({ task, calendarSync });
    } catch (syncError) {
      console.error('[tasks] calendar sync failed:', syncError);
      return NextResponse.json({ task, calendarSync: 'error' });
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) { return writeTask(request, false); }
export async function PATCH(request: Request) { return writeTask(request, true); }

export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const { id } = (await request.json()) as { id?: string };
    if (!id) return badRequest('Tarefa não informada');
    const { data: task, error } = await ctx.supabase.from('tasks').select('*').eq('id', id).eq('account_id', ctx.accountId).maybeSingle();
    if (error || !task) return NextResponse.json({ error: 'Tarefa não encontrada' }, { status: 404 });
    await deleteCalendarTask(task);
    const result = await ctx.supabase.from('tasks').delete().eq('id', id).eq('account_id', ctx.accountId);
    if (result.error) throw result.error;
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
