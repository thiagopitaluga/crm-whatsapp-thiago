-- Store resolved Meta Marketing hierarchy separately from the signed raw
-- WhatsApp referral.  These fields are populated only by the server-side
-- resolver after it verifies the tenant's explicit ad-account integration.

ALTER TABLE public.conversation_attributions
  ADD COLUMN IF NOT EXISTS meta_ad_account_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_campaign_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_campaign_name TEXT,
  ADD COLUMN IF NOT EXISTS meta_adset_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_adset_name TEXT,
  ADD COLUMN IF NOT EXISTS meta_ad_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_ad_name TEXT,
  ADD COLUMN IF NOT EXISTS meta_marketing_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS meta_marketing_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(meta_marketing_metadata) = 'object');

CREATE INDEX IF NOT EXISTS idx_conversation_attributions_account_meta_campaign
  ON public.conversation_attributions(account_id, meta_campaign_id)
  WHERE meta_campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_attributions_account_meta_ad
  ON public.conversation_attributions(account_id, meta_ad_id)
  WHERE meta_ad_id IS NOT NULL;

COMMENT ON COLUMN public.conversation_attributions.meta_marketing_metadata IS
  'Server-resolved Meta Marketing API context; raw CTWA referral stays in referral_metadata.';
