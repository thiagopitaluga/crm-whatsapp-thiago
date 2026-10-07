-- Count distinct cards that reached each visible stage during the period and
-- subsequently reached the next visible stage. Hidden intermediate stages do
-- not interrupt the path. Creation events count as stage entries.
CREATE OR REPLACE FUNCTION public.get_pipeline_funnel_conversion(
  p_pipeline_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_stage_ids UUID[]
)
RETURNS TABLE (
  stage_id UUID,
  next_stage_id UUID,
  reached_count BIGINT,
  progressed_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH visible AS (
    SELECT s.id AS stage_id, v.ordinality,
           LEAD(s.id) OVER (ORDER BY v.ordinality) AS next_stage_id
    FROM UNNEST(p_stage_ids) WITH ORDINALITY AS v(id, ordinality)
    JOIN public.pipeline_stages s
      ON s.id = v.id AND s.pipeline_id = p_pipeline_id
  ),
  first_arrival AS (
    SELECT e.deal_id, e.to_stage_id, MIN(e.occurred_at) AS arrived_at
    FROM public.deal_stage_events e
    JOIN visible v ON v.stage_id = e.to_stage_id
    WHERE e.pipeline_id = p_pipeline_id
      AND e.occurred_at >= p_from AND e.occurred_at < p_to
    GROUP BY e.deal_id, e.to_stage_id
  )
  SELECT v.stage_id, v.next_stage_id,
         COUNT(a.deal_id) AS reached_count,
         COUNT(a.deal_id) FILTER (
           WHERE v.next_stage_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.deal_stage_events next_event
             WHERE next_event.pipeline_id = p_pipeline_id
               AND next_event.deal_id = a.deal_id
               AND next_event.to_stage_id = v.next_stage_id
               AND next_event.occurred_at > a.arrived_at
               AND next_event.occurred_at < p_to
           )
         ) AS progressed_count
  FROM visible v
  LEFT JOIN first_arrival a ON a.to_stage_id = v.stage_id
  GROUP BY v.stage_id, v.next_stage_id, v.ordinality
  ORDER BY v.ordinality;
$$;

REVOKE ALL ON FUNCTION public.get_pipeline_funnel_conversion(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pipeline_funnel_conversion(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID[]) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';

