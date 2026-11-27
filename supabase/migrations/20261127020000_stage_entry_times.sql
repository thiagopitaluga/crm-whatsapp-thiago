CREATE OR REPLACE FUNCTION public.get_pipeline_stage_entry_times(p_pipeline_id uuid)
RETURNS TABLE(deal_id uuid, occurred_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT DISTINCT ON (e.deal_id) e.deal_id, e.occurred_at
  FROM public.deal_stage_events e
  WHERE e.pipeline_id = p_pipeline_id
  ORDER BY e.deal_id, e.occurred_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_pipeline_stage_entry_times(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pipeline_stage_entry_times(uuid) TO authenticated, service_role;
