import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';

const TRIGGER_TYPES = new Set(['new_message', 'keyword', 'no_response', 'stage_changed', 'tag_added', 'custom_instruction', 'order_paid', 'order_shipped']);
const ACTION_TYPES = new Set(['send_message', 'send_media', 'add_tag', 'remove_tag', 'notify_user', 'notify_whatsapp', 'assign_conversation', 'webhook', 'move_stage']);
const FILTER_FIELDS = new Set(['origin', 'campaign', 'channel', 'message', 'stage', 'tag', 'contact_name', 'contact_email', 'contact_phone']);
const FILTER_OPERATORS = new Set(['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'exists', 'not_exists']);

function validFilters(filters: unknown): boolean {
  return Array.isArray(filters) && filters.length <= 20 && filters.every((filter) =>
    filter && typeof filter === 'object' &&
    typeof filter.field === 'string' && FILTER_FIELDS.has(filter.field) &&
    typeof filter.operator === 'string' && FILTER_OPERATORS.has(filter.operator) &&
    (filter.value === undefined || (typeof filter.value === 'string' && filter.value.length <= 500))
  );
}

type Context = { params: Promise<{ agentId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { agentId } = await params;
    const { data, error } = await supabase
      .from('ai_agent_triggers')
      .select('*')
      .eq('account_id', accountId)
      .eq('agent_id', agentId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return NextResponse.json({ triggers: data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const { agentId } = await params;
    const body = await request.json().catch(() => ({}));
    if (typeof body.name !== 'string' || !body.name.trim()) return NextResponse.json({ error: 'Dê um nome ao gatilho.' }, { status: 400 });
    if (!TRIGGER_TYPES.has(body.trigger_type)) return NextResponse.json({ error: 'Escolha um evento de disparo.' }, { status: 400 });
    if (!ACTION_TYPES.has(body.action_type)) return NextResponse.json({ error: 'Escolha uma ação.' }, { status: 400 });
    if (body.trigger_type === 'custom_instruction' && (typeof body.trigger_config?.instruction !== 'string' || !body.trigger_config.instruction.trim())) return NextResponse.json({ error: 'Escreva a instrução customizada que a IA deve avaliar.' }, { status: 400 });
    if (!validFilters(body.filters)) return NextResponse.json({ error: 'Configure até 20 filtros válidos.' }, { status: 400 });
    const { data: agent, error: agentError } = await supabase.from('ai_agents').select('id').eq('account_id', accountId).eq('id', agentId).maybeSingle();
    if (agentError) throw agentError;
    if (!agent) return NextResponse.json({ error: 'Agente não encontrado.' }, { status: 404 });
    const { data, error } = await supabase.from('ai_agent_triggers').insert({
      account_id: accountId,
      agent_id: agentId,
      created_by: userId,
      name: body.name.trim().slice(0, 120),
      trigger_type: body.trigger_type,
      trigger_config: body.trigger_config ?? {},
      filters: body.filters,
      action_type: body.action_type,
      action_config: body.action_config ?? {},
      is_active: body.is_active === true,
    }).select('*').single();
    if (error) throw error;
    return NextResponse.json({ trigger: data }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { agentId } = await params;
    const body = await request.json().catch(() => ({}));
    const triggerId = typeof body.id === 'string' ? body.id : '';
    if (!triggerId) return NextResponse.json({ error: 'Gatilho não informado.' }, { status: 400 });
    const update: Record<string, unknown> = {};
    if (typeof body.is_active === 'boolean') update.is_active = body.is_active;
    if (typeof body.name === 'string') update.name = body.name.trim().slice(0, 120);
    if (typeof body.trigger_type === 'string' && TRIGGER_TYPES.has(body.trigger_type)) update.trigger_type = body.trigger_type;
    if (body.trigger_config && typeof body.trigger_config === 'object') update.trigger_config = body.trigger_config;
    if (typeof body.filters !== 'undefined') {
      if (!validFilters(body.filters)) return NextResponse.json({ error: 'Configure até 20 filtros válidos.' }, { status: 400 });
      update.filters = body.filters;
    }
    if (typeof body.action_type === 'string' && ACTION_TYPES.has(body.action_type)) update.action_type = body.action_type;
    if (body.action_config && typeof body.action_config === 'object') update.action_config = body.action_config;
    const { data, error } = await supabase.from('ai_agent_triggers').update(update).eq('id', triggerId).eq('agent_id', agentId).eq('account_id', accountId).select('*').single();
    if (error) throw error;
    return NextResponse.json({ trigger: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { agentId } = await params;
    const triggerId = new URL(request.url).searchParams.get('id');
    if (!triggerId) return NextResponse.json({ error: 'Gatilho não informado.' }, { status: 400 });
    const { error } = await supabase.from('ai_agent_triggers').delete().eq('id', triggerId).eq('agent_id', agentId).eq('account_id', accountId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
