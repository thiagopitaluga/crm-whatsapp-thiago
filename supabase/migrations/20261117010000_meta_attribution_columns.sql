-- Existing installations may have attribution rows without the later Meta
-- hierarchy columns. Preserve every row and add only missing fields.
ALTER TABLE public.conversation_attributions
  ADD COLUMN IF NOT EXISTS meta_ad_account_id text,
  ADD COLUMN IF NOT EXISTS meta_campaign_id text,
  ADD COLUMN IF NOT EXISTS meta_campaign_name text,
  ADD COLUMN IF NOT EXISTS meta_adset_id text,
  ADD COLUMN IF NOT EXISTS meta_adset_name text,
  ADD COLUMN IF NOT EXISTS meta_ad_id text,
  ADD COLUMN IF NOT EXISTS meta_ad_name text,
  ADD COLUMN IF NOT EXISTS meta_marketing_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS meta_marketing_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_conversation_attributions_account_meta_campaign
  ON public.conversation_attributions(account_id, meta_campaign_id) WHERE meta_campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversation_attributions_account_meta_ad
  ON public.conversation_attributions(account_id, meta_ad_id) WHERE meta_ad_id IS NOT NULL;
NOTIFY pgrst, 'reload schema';
