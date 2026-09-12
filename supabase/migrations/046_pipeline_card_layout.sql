-- Per-pipeline Kanban card preferences.  The settings are account-safe
-- because they live on `pipelines`, whose existing RLS policies already
-- require an active member of the pipeline's account.
ALTER TABLE public.pipelines
  ADD COLUMN IF NOT EXISTS card_layout JSONB NOT NULL DEFAULT jsonb_build_object(
    'show_value', true,
    'show_created_at', true,
    'show_last_message', true,
    'custom_field_ids', jsonb_build_array()
  );

ALTER TABLE public.pipelines
  ADD CONSTRAINT pipelines_card_layout_is_object
  CHECK (jsonb_typeof(card_layout) = 'object') NOT VALID;

ALTER TABLE public.pipelines
  VALIDATE CONSTRAINT pipelines_card_layout_is_object;
