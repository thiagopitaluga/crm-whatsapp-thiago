import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { parseMovementRange } from '@/lib/pipelines/movement-range';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 50;

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const pipelineId = params.get('pipeline_id');
    const destinationId = params.get('to_stage_id');
    const rawVisibleStageIds = params.get('visible_stage_ids');
    const range = parseMovementRange(params);
    const rawPage = params.get('page') ?? '1';
    const page = Number(rawPage);
    if (!pipelineId || !UUID_RE.test(pipelineId) ||
        (destinationId && !UUID_RE.test(destinationId)) || !range ||
        !/^\d+$/.test(rawPage) || !Number.isSafeInteger(page) || page < 1 || page > 1000 ||
        (rawVisibleStageIds !== null && rawVisibleStageIds.length > 4000)) {
      return NextResponse.json(
        { error: 'Informe funil, período válido de até 366 dias e página válida.' },
        { status: 400 },
      );
    }

    const { supabase, accountId } = await requireRole('viewer');
    const { data: pipeline, error: pipelineError } = await supabase
      .from('pipelines')
      .select('id, name')
      .eq('id', pipelineId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (pipelineError) throw pipelineError;
    if (!pipeline)
      return NextResponse.json({ error: 'Funil não encontrado.' }, { status: 404 });

    let eventQuery = supabase
      .from('deal_stage_events')
      .select('id, deal_id, deal_title, event_type, from_stage_id, from_stage_name, to_stage_id, to_stage_name, changed_by_name, occurred_at', { count: 'exact' })
      .eq('account_id', accountId)
      .eq('pipeline_id', pipelineId)
      .gte('occurred_at', range.fromInstant)
      .lt('occurred_at', range.toExclusiveInstant);
    if (destinationId) eventQuery = eventQuery.eq('to_stage_id', destinationId);

    const [stagesResult, summaryResult, eventsResult] = await Promise.all([
      supabase.from('pipeline_stages').select('id, name, position, color')
        .eq('pipeline_id', pipelineId).order('position'),
      supabase.rpc('get_pipeline_stage_movements', {
        p_pipeline_id: pipelineId,
        p_from: range.fromInstant,
        p_to: range.toExclusiveInstant,
      }),
      eventQuery.order('occurred_at', { ascending: false })
        .order('id', { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    ]);
    if (stagesResult.error) throw stagesResult.error;
    if (summaryResult.error) throw summaryResult.error;
    if (eventsResult.error) throw eventsResult.error;

    const stages = stagesResult.data ?? [];
    const requestedIds = rawVisibleStageIds === null ? stages.map((stage) => stage.id) : rawVisibleStageIds.split(',');
    const stageIds = new Set(stages.map((stage) => stage.id));
    if (requestedIds.length > 100 || (stages.length > 0 && requestedIds.length === 0) ||
        new Set(requestedIds).size !== requestedIds.length ||
        requestedIds.some((id) => !UUID_RE.test(id) || !stageIds.has(id))) {
      return NextResponse.json({ error: 'Seleção de etapas inválida.' }, { status: 400 });
    }
    const requestedSet = new Set(requestedIds);
    const visibleStageIds = stages.filter((stage) => requestedSet.has(stage.id)).map((stage) => stage.id);
    const { data: funnel, error: funnelError } = await supabase.rpc('get_pipeline_funnel_conversion', {
      p_pipeline_id: pipelineId,
      p_from: range.fromInstant,
      p_to: range.toExclusiveInstant,
      p_stage_ids: visibleStageIds,
    });
    if (funnelError) throw funnelError;

    return NextResponse.json({
      pipeline,
      range: { from: range.from, to: range.to },
      stages,
      visibleStageIds,
      funnel: funnel ?? [],
      summary: summaryResult.data ?? [],
      events: eventsResult.data ?? [],
      eventCount: eventsResult.count ?? 0,
      page,
      pageSize: PAGE_SIZE,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error);
  }
}

