import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  validateInstagramGraph,
  INSTAGRAM_TRIGGERS,
  type VisualGraph,
} from '@/lib/instagram/graph-validation';
const columns =
  'id,name,trigger_type,keywords,reply_text,created_at,updated_at,is_active,channel_id,target_media_id,flow_graph';
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
type AutomationRow = {
  id: string;
  name: string;
  trigger_type: string;
  keywords: string;
  reply_text: string;
  channel_id: string | null;
  target_media_id: string | null;
  flow_graph: VisualGraph | null;
  is_active: boolean;
  updated_at: string;
  [key: string]: unknown;
};
function present(row: AutomationRow, runs = 0) {
  return {
    ...row,
    triggerType: row.trigger_type,
    replyText: row.reply_text,
    targetMediaId: row.target_media_id,
    instagramAccountId: row.channel_id,
    flowGraph: row.flow_graph ? JSON.stringify(row.flow_graph) : undefined,
    status: row.is_active ? 'active' : 'paused',
    runs,
    updatedAt: row.updated_at,
  };
}
export async function GET() {
  try {
    const ctx = await requireRole('viewer');
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('instagram_automations')
      .select(columns)
      .eq('account_id', ctx.accountId)
      .is('archived_at', null)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const counts = await db
      .from('instagram_automation_runs')
      .select('automation_id')
      .eq('account_id', ctx.accountId)
      .eq('status', 'sent')
      .limit(10000);
    return NextResponse.json(
      {
        automations: (data || []).map((r) =>
          present(
            r,
            (counts.data || []).filter((c) => c.automation_id === r.id).length
          )
        ),
        canManage: ['owner', 'admin', 'agent'].includes(ctx.role),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
async function write(request: Request, create: boolean) {
  try {
    const ctx = await requireRole('agent');
    if (request.headers.get('origin') !== new URL(request.url).origin)
      return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
    const raw = await request.text();
    if (raw.length > 250000)
      return NextResponse.json(
        { error: 'Fluxo muito grande.' },
        { status: 413 }
      );
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 });
    const db = supabaseAdmin();
    if (!create && !uuid(body.id))
      return NextResponse.json(
        { error: 'Automação inválida.' },
        { status: 400 }
      );
    let existing: AutomationRow | null = null;
    if (!create) {
      const q = await db
        .from('instagram_automations')
        .select(columns)
        .eq('account_id', ctx.accountId)
        .eq('id', body.id)
        .is('archived_at', null)
        .maybeSingle();
      if (q.error) throw q.error;
      existing = q.data;
      if (!existing)
        return NextResponse.json(
          { error: 'Automação não encontrada.' },
          { status: 404 }
        );
    }
    const toggling = typeof body.active === 'boolean' && !body.name;
    let values: Record<string, unknown>;
    if (toggling) {
      const active = body.active;
      const channelId = body.channelId || existing!.channel_id;
      if (active) {
        if (process.env.INSTAGRAM_AUTOMATION_ENABLED !== 'true')
          return NextResponse.json(
            {
              error:
                'Conecte e valide a integração do Instagram para habilitar a execução.',
            },
            { status: 409 }
          );
        if (!uuid(channelId))
          return NextResponse.json(
            { error: 'Escolha um perfil do Instagram.' },
            { status: 400 }
          );
        if (existing!.flow_graph)
          validateInstagramGraph(existing!.flow_graph, true);
        else if (
          !existing!.reply_text.trim() ||
          existing!.reply_text.length > 1000
        )
          throw new Error('Preencha a mensagem antes de ativar.');
      }
      values = {
        is_active: active,
        ...(active ? { channel_id: channelId } : {}),
        updated_at: new Date().toISOString(),
      };
    } else {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 150)
        throw new Error('Informe um nome de até 150 caracteres.');
      let graph =
        body.flowGraph ?? body.flow_graph ?? existing?.flow_graph ?? null;
      if (typeof graph === 'string') graph = JSON.parse(graph);
      if (graph) validateInstagramGraph(graph);
      const primary = graph?.nodes.find(
        (n: VisualGraph['nodes'][number]) => n.data.kind === 'trigger'
      )?.data.triggers[0];
      const trigger =
        primary?.type ||
        body.trigger_type ||
        body.triggerType ||
        existing?.trigger_type;
      if (!INSTAGRAM_TRIGGERS.includes(trigger))
        throw new Error('Gatilho inválido.');
      const channelId =
        body.instagramAccountId ??
        body.channel_id ??
        existing?.channel_id ??
        null;
      values = {
        name,
        trigger_type: trigger,
        keywords: primary?.keywords || body.keywords || '',
        reply_text:
          body.replyText ?? body.reply_text ?? existing?.reply_text ?? '',
        target_media_id:
          primary?.targetMediaId ||
          body.targetMediaId ||
          body.target_media_id ||
          null,
        channel_id: channelId || null,
        flow_graph: graph,
        is_active: false,
        updated_at: new Date().toISOString(),
      };
      if (
        typeof values.reply_text !== 'string' ||
        values.reply_text.length > 5000 ||
        typeof values.keywords !== 'string' ||
        values.keywords.length > 1000
      )
        throw new Error('Mensagem ou palavras-chave muito longas.');
    }
    if (values.channel_id) {
      if (!uuid(values.channel_id)) throw new Error('Perfil inválido.');
      const q = await db
        .from('instagram_channels')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('id', values.channel_id)
        .maybeSingle();
      if (q.error) throw q.error;
      if (!q.data)
        return NextResponse.json(
          { error: 'Perfil não encontrado nesta empresa.' },
          { status: 404 }
        );
    }
    const query = create
      ? db
          .from('instagram_automations')
          .insert({ ...values, account_id: ctx.accountId })
      : db
          .from('instagram_automations')
          .update(values)
          .eq('account_id', ctx.accountId)
          .eq('id', body.id)
          .is('archived_at', null);
    const saved = await query.select(columns).single();
    if (saved.error) throw saved.error;
    if (!create && values.is_active === false) {
      const cancelled = await db
        .from('instagram_automation_runs')
        .update({
          status: 'failed',
          error_message:
            'Execução cancelada porque o fluxo foi pausado ou alterado.',
          updated_at: new Date().toISOString(),
        })
        .eq('automation_id', body.id)
        .eq('account_id', ctx.accountId)
        .eq('status', 'pending');
      if (cancelled.error) throw cancelled.error;
    }
    return NextResponse.json(
      { automation: present(saved.data) },
      { status: create ? 201 : 200 }
    );
  } catch (e) {
    if (e instanceof Error && !('code' in e) && !('status' in e))
      return NextResponse.json({ error: e.message }, { status: 400 });
    return toErrorResponse(e);
  }
}
export async function POST(r: Request) {
  return write(r, true);
}
export async function PATCH(r: Request) {
  return write(r, false);
}
export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole('agent');
    if (request.headers.get('origin') !== new URL(request.url).origin)
      return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
    const id = new URL(request.url).searchParams.get('id');
    if (!uuid(id))
      return NextResponse.json(
        { error: 'Automação inválida.' },
        { status: 400 }
      );
    const result = await supabaseAdmin()
      .from('instagram_automations')
      .update({ archived_at: new Date().toISOString(), is_active: false })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle();
    if (result.error) throw result.error;
    return NextResponse.json({ removed: !!result.data });
  } catch (e) {
    return toErrorResponse(e);
  }
}
