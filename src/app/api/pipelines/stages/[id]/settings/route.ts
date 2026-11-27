import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  defaultStageSettings,
  validateStageSettings,
  type StageSettings,
} from '@/lib/pipelines/stage-settings';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('agent');
    const { id } = await context.params;
    const { data, error } = await supabase
      .from('pipeline_stages')
      .select('settings,pipeline_id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return NextResponse.json(
        { error: 'Etapa não encontrada.' },
        { status: 404 }
      );
    const { data: jobs } = await supabase
      .from('stage_jobs')
      .select('id,kind,status,error,created_at')
      .eq('stage_id', id)
      .order('created_at', { ascending: false })
      .limit(15);
    const [{ data: stages }, { data: pipelines }, { data: users }] =
      await Promise.all([
        supabase
          .from('pipeline_stages')
          .select('id,name,pipeline_id')
          .eq('pipeline_id', data.pipeline_id),
        supabase
          .from('pipelines')
          .select('id,name')
          .eq('account_id', accountId),
        supabase
          .from('profiles')
          .select('user_id,full_name,email')
          .eq('account_id', accountId),
      ]);
    return NextResponse.json({
      settings: {
        ...(data.settings ?? defaultStageSettings()),
        email: defaultStageSettings().email,
      },
      jobs: jobs ?? [],
      choices: {
        stages: stages ?? [],
        pipelines: pipelines ?? [],
        users: users ?? [],
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    const settings =
      body && typeof body === 'object' && !Array.isArray(body)
        ? { ...body, email: defaultStageSettings().email }
        : body;
    const issue = validateStageSettings(settings);
    if (issue) return NextResponse.json({ error: issue }, { status: 400 });
    const s = settings as StageSettings;
    for (const rule of s.rules.filter(
      (r) => r.enabled && ['add_tag', 'remove_tag'].includes(r.action)
    )) {
      const { data } = await supabase
        .from('tags')
        .select('id')
        .eq('id', rule.value)
        .eq('account_id', accountId)
        .maybeSingle();
      if (!data)
        return NextResponse.json(
          { error: 'Selecione uma tag desta conta.' },
          { status: 400 }
        );
    }
    for (const rule of s.rules.filter(
      (r) => r.enabled && r.event === 'tag_added'
    )) {
      const { data: tag } = await supabase
        .from('tags')
        .select('id')
        .eq('id', rule.condition)
        .eq('account_id', accountId)
        .maybeSingle();
      if (!tag)
        return NextResponse.json(
          { error: 'Selecione a tag que dispara o gatilho.' },
          { status: 400 }
        );
    }
    for (const rule of s.rules.filter(
      (r) =>
        r.enabled &&
        ['move_stage', 'move_pipeline', 'notify_user'].includes(r.action)
    )) {
      const query =
        rule.action === 'notify_user'
          ? supabase
              .from('profiles')
              .select('user_id')
              .eq('user_id', rule.value)
              .eq('account_id', accountId)
          : rule.action === 'move_stage'
            ? supabase
                .from('pipeline_stages')
                .select('id')
                .eq('id', rule.value)
                .eq(
                  'pipeline_id',
                  (
                    await supabase
                      .from('pipeline_stages')
                      .select('pipeline_id')
                      .eq('id', id)
                      .single()
                  ).data?.pipeline_id ?? ''
                )
            : supabase
                .from('pipelines')
                .select('id')
                .eq('id', rule.value)
                .eq('account_id', accountId);
      const { data: target } = await query.maybeSingle();
      if (!target)
        return NextResponse.json(
          { error: 'Selecione um destino válido desta conta.' },
          { status: 400 }
        );
    }
    // RLS is authoritative for the stage and its parent pipeline.
    const { data, error } = await supabase
      .from('pipeline_stages')
      .update({ settings: s })
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return NextResponse.json(
        { error: 'Etapa não encontrada.' },
        { status: 404 }
      );
    return NextResponse.json({ saved: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
