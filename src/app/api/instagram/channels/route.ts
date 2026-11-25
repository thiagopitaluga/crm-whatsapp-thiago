import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function GET() {
  try {
    const ctx = await requireRole('viewer');
    const { data, error } = await supabaseAdmin()
      .from('instagram_channels')
      .select(
        'id,instagram_id,username,token_expires_at,created_at,lead_pipeline_id,lead_stage_id'
      )
      .eq('account_id', ctx.accountId)
      .order('created_at');
    if (error) throw error;
    const pipelines = await supabaseAdmin()
      .from('pipelines')
      .select('id,name,pipeline_stages(id,name,position)')
      .eq('account_id', ctx.accountId)
      .order('name');
    if (pipelines.error) throw pipelines.error;
    return NextResponse.json(
      {
        channels: data ?? [],
        pipelines: pipelines.data ?? [],
        canManage: ctx.role === 'owner' || ctx.role === 'admin',
        configured: Boolean(
          process.env.INSTAGRAM_APP_ID &&
          process.env.INSTAGRAM_APP_SECRET &&
          process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN &&
          process.env.ENCRYPTION_KEY
        ),
        automationEnabled: process.env.INSTAGRAM_AUTOMATION_ENABLED === 'true',
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin');
    if (request.headers.get('origin') !== new URL(request.url).origin)
      return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
    const body = await request.json();
    const valid = (id: unknown) =>
      typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id);
    if (
      !valid(body.id) ||
      (!(body.pipelineId === null && body.stageId === null) &&
        (!valid(body.pipelineId) || !valid(body.stageId)))
    )
      return NextResponse.json(
        { error: 'Escolha o funil e a etapa de entrada.' },
        { status: 400 }
      );
    const db = supabaseAdmin();
    if (body.pipelineId) {
      const pipeline = await db
        .from('pipelines')
        .select('id')
        .eq('id', body.pipelineId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      const stage = await db
        .from('pipeline_stages')
        .select('id')
        .eq('id', body.stageId)
        .eq('pipeline_id', body.pipelineId)
        .maybeSingle();
      if (pipeline.error || stage.error) throw pipeline.error || stage.error;
      if (!pipeline.data || !stage.data)
        return NextResponse.json(
          { error: 'O funil e a etapa devem pertencer a esta empresa.' },
          { status: 400 }
        );
    }
    const saved = await db
      .from('instagram_channels')
      .update({
        lead_pipeline_id: body.pipelineId,
        lead_stage_id: body.stageId,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', ctx.accountId)
      .eq('id', body.id)
      .select('id')
      .maybeSingle();
    if (saved.error) throw saved.error;
    if (!saved.data)
      return NextResponse.json(
        { error: 'Perfil não encontrado.' },
        { status: 404 }
      );
    return NextResponse.json({ saved: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
