import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { aiChannelsOverlap, DEFAULT_AI_AGENT_SETTINGS } from '@/lib/ai/agent-settings';

const isAllowedChannel = (value: unknown): value is string => typeof value === 'string' && /^(whatsapp_cloud|whatsapp_evolution)(:[a-zA-Z0-9-]{1,80})?$/.test(value);

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { data, error } = await supabase
      .from('ai_agents')
      .select('id, name, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, settings, channel_keys, is_default, created_at, updated_at')
      .eq('account_id', accountId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return NextResponse.json({ agents: data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    if (!name) return NextResponse.json({ error: 'Informe o nome do agente.' }, { status: 400 });

    const { data: source } = await supabase
      .from('ai_agents')
      .select('settings, system_prompt, auto_reply_max_per_conversation')
      .eq('account_id', accountId)
      .eq('is_default', true)
      .maybeSingle();
    const { count, error: countError } = await supabase
      .from('ai_agents')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId);
    if (countError) throw countError;
    const { data, error } = await supabase
      .from('ai_agents')
      .insert({
        account_id: accountId,
        created_by: userId,
        name,
        settings: source?.settings ?? DEFAULT_AI_AGENT_SETTINGS,
        system_prompt: source?.system_prompt ?? null,
        auto_reply_max_per_conversation: source?.auto_reply_max_per_conversation ?? 3,
        is_default: (count ?? 0) === 0,
        is_active: false,
        auto_reply_enabled: false,
        channel_keys: [],
      })
      .select('id, name, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, settings, channel_keys, is_default, created_at, updated_at')
      .single();
    if (error) throw error;
    return NextResponse.json({ agent: data }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const body = await request.json().catch(() => ({}));
    const agentId = typeof body.agent_id === 'string' ? body.agent_id : '';
    if (!agentId) return NextResponse.json({ error: 'agent_id obrigatório.' }, { status: 400 });
    const update: Record<string, unknown> = {};
    if (typeof body.name === 'string') {
      const name = body.name.trim().slice(0, 80);
      if (!name) return NextResponse.json({ error: 'O nome do agente não pode ficar vazio.' }, { status: 400 });
      update.name = name;
    }
    if (typeof body.is_active === 'boolean') update.is_active = body.is_active;
    if (typeof body.channel_keys !== 'undefined') {
      if (!Array.isArray(body.channel_keys) || body.channel_keys.some((v: unknown) => !isAllowedChannel(v)))
        return NextResponse.json({ error: 'Canal inválido.' }, { status: 400 });
      const channels = [...new Set(body.channel_keys as string[])];
      const { data: others, error: lookupError } = await supabase
        .from('ai_agents')
        .select('id, name, channel_keys')
        .eq('account_id', accountId)
        .neq('id', agentId);
      if (lookupError) throw lookupError;
      const conflict = (others ?? []).find((agent) => channels.some((channel) => (agent.channel_keys ?? []).some((peerChannel: string) => aiChannelsOverlap(channel, peerChannel))));
      if (conflict) return NextResponse.json({ error: `${conflict.name} já está conectado a esse WhatsApp. Desconecte-o antes de atribuir o canal.` }, { status: 409 });
      update.channel_keys = channels;
    }
    if (body.is_default === true) {
      await supabase.from('ai_agents').update({ is_default: false }).eq('account_id', accountId);
      update.is_default = true;
    }
    if (Object.keys(update).length === 0) return NextResponse.json({ error: 'Nenhuma alteração informada.' }, { status: 400 });
    const { data, error } = await supabase
      .from('ai_agents')
      .update(update)
      .eq('id', agentId)
      .eq('account_id', accountId)
      .select('id, name, is_active, auto_reply_enabled, channel_keys, is_default')
      .single();
    if (error) throw error;
    return NextResponse.json({ agent: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
