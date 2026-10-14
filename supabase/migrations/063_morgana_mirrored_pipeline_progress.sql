-- Mirror progress only between Morgana Fernandes's WhatsApp and Meta Form
-- pipelines. Both pipelines have equivalent stages at positions 0 through 6.
-- Existing divergent cards are left untouched; only future changes propagate.
-- Lead ownership already follows the shared contact through migration 060.

CREATE OR REPLACE FUNCTION public.sync_morgana_mirrored_pipeline_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_pipeline_id uuid;
  v_source_position integer;
  v_source_stage_name text;
  v_target_stage_id uuid;
  v_target_stage_name text;
BEGIN
  IF NEW.account_id <> '9ffbd8f5-c6f7-4f43-a0e7-d0105ceaa08c'::uuid
     OR NEW.contact_id IS NULL
     OR NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id THEN
    RETURN NEW;
  END IF;

  v_target_pipeline_id := CASE NEW.pipeline_id
    WHEN '2457345c-c7ed-4c57-903b-f054b86dc800'::uuid
      THEN '94beadb8-85f5-4943-953d-8c0986921a15'::uuid
    WHEN '94beadb8-85f5-4943-953d-8c0986921a15'::uuid
      THEN '2457345c-c7ed-4c57-903b-f054b86dc800'::uuid
    ELSE NULL
  END;
  IF v_target_pipeline_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT position, name INTO v_source_position, v_source_stage_name
  FROM public.pipeline_stages
  WHERE id = NEW.stage_id AND pipeline_id = NEW.pipeline_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source stage does not belong to its pipeline';
  END IF;

  SELECT id, name INTO v_target_stage_id, v_target_stage_name
  FROM public.pipeline_stages
  WHERE pipeline_id = v_target_pipeline_id
    AND position = v_source_position
  ORDER BY id
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mirrored pipeline has no stage at position %',
      v_source_position;
  END IF;
  IF lower(trim(v_source_stage_name)) <> lower(trim(v_target_stage_name))
     AND NOT (
       v_source_position = 0
       AND lower(trim(v_source_stage_name)) IN ('novo', 'novo lead')
       AND lower(trim(v_target_stage_name)) IN ('novo', 'novo lead')
     ) THEN
    RAISE EXCEPTION 'Mirrored stages at position % no longer match',
      v_source_position;
  END IF;

  -- The distinct check stops the reciprocal trigger from looping. Updating
  -- all cards for this contact also handles any extra duplicate in one funil.
  UPDATE public.deals mirrored
  SET stage_id = v_target_stage_id,
      status = NEW.status
  WHERE mirrored.account_id = NEW.account_id
    AND mirrored.contact_id = NEW.contact_id
    AND mirrored.pipeline_id = v_target_pipeline_id
    AND (
      mirrored.stage_id IS DISTINCT FROM v_target_stage_id
      OR mirrored.status IS DISTINCT FROM NEW.status
    );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_morgana_mirrored_pipeline_progress()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS deals_sync_morgana_mirrored_progress ON public.deals;
CREATE TRIGGER deals_sync_morgana_mirrored_progress
  AFTER UPDATE OF stage_id, status ON public.deals
  FOR EACH ROW
  WHEN (
    OLD.stage_id IS DISTINCT FROM NEW.stage_id
    OR OLD.status IS DISTINCT FROM NEW.status
  )
  EXECUTE FUNCTION public.sync_morgana_mirrored_pipeline_progress();
