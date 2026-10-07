-- Record every Kanban stage change, regardless of whether it came from the
-- board, deal editor, bulk actions, automation, or the AI agent. Existing
-- deals are not backfilled: their earlier movements cannot be reconstructed.
CREATE TABLE IF NOT EXISTS public.deal_stage_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL,
  pipeline_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'moved')),
  from_stage_id UUID,
  from_stage_name TEXT,
  to_stage_id UUID NOT NULL,
  to_stage_name TEXT NOT NULL,
  deal_title TEXT NOT NULL,
  changed_by UUID,
  changed_by_name TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Keep historical IDs and names even when a card, stage, or user is deleted.
CREATE INDEX IF NOT EXISTS deal_stage_events_period_idx
  ON public.deal_stage_events(account_id, pipeline_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS deal_stage_events_destination_idx
  ON public.deal_stage_events(account_id, pipeline_id, to_stage_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS deal_stage_events_deal_idx
  ON public.deal_stage_events(account_id, deal_id, occurred_at DESC);

ALTER TABLE public.deal_stage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY deal_stage_events_read ON public.deal_stage_events
  FOR SELECT TO authenticated USING (
    public.is_account_member(account_id, 'admin')
    OR EXISTS (
      SELECT 1 FROM public.deals visible_deal
      WHERE visible_deal.id = deal_stage_events.deal_id
        AND visible_deal.account_id = deal_stage_events.account_id
    )
  );
REVOKE ALL ON public.deal_stage_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.deal_stage_events TO authenticated;
GRANT ALL ON public.deal_stage_events TO service_role;

CREATE OR REPLACE FUNCTION public.record_deal_stage_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  previous_stage_name TEXT;
  next_stage_name TEXT;
  actor_name TEXT;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.stage_id IS NOT DISTINCT FROM NEW.stage_id
     AND OLD.pipeline_id IS NOT DISTINCT FROM NEW.pipeline_id THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT name INTO previous_stage_name
    FROM public.pipeline_stages WHERE id = OLD.stage_id;
  END IF;
  SELECT name INTO next_stage_name
  FROM public.pipeline_stages
  WHERE id = NEW.stage_id AND pipeline_id = NEW.pipeline_id;
  IF next_stage_name IS NULL THEN
    RAISE EXCEPTION 'Cannot record movement to an unknown stage';
  END IF;
  IF auth.uid() IS NOT NULL THEN
    SELECT COALESCE(NULLIF(full_name, ''), email) INTO actor_name
    FROM public.profiles WHERE user_id = auth.uid();
  END IF;

  INSERT INTO public.deal_stage_events (
    account_id, deal_id, pipeline_id, event_type,
    from_stage_id, from_stage_name, to_stage_id, to_stage_name,
    deal_title, changed_by, changed_by_name
  ) VALUES (
    NEW.account_id, NEW.id, NEW.pipeline_id,
    CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'moved' END,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage_id ELSE NULL END,
    previous_stage_name, NEW.stage_id, next_stage_name,
    NEW.title, auth.uid(), actor_name
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_deal_stage_event() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS deals_stage_event_insert ON public.deals;
CREATE TRIGGER deals_stage_event_insert
  AFTER INSERT ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.record_deal_stage_event();
DROP TRIGGER IF EXISTS deals_stage_event_update ON public.deals;
CREATE TRIGGER deals_stage_event_update
  AFTER UPDATE OF stage_id, pipeline_id ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.record_deal_stage_event();

-- Aggregate on the database side instead of downloading every event to the
-- browser. Creation is intentionally excluded from movement counts.
CREATE OR REPLACE FUNCTION public.get_pipeline_stage_movements(
  p_pipeline_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ
)
RETURNS TABLE (
  to_stage_id UUID,
  to_stage_name TEXT,
  movement_count BIGINT,
  unique_deal_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT e.to_stage_id, MAX(e.to_stage_name) AS to_stage_name,
         COUNT(*) AS movement_count,
         COUNT(DISTINCT e.deal_id) AS unique_deal_count
  FROM public.deal_stage_events e
  WHERE e.pipeline_id = p_pipeline_id
    AND e.event_type = 'moved'
    AND e.occurred_at >= p_from
    AND e.occurred_at < p_to
  GROUP BY e.to_stage_id;
$$;

REVOKE ALL ON FUNCTION public.get_pipeline_stage_movements(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pipeline_stage_movements(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';

