-- Read-only Meta Ads workspace. No credential is stored here and no Meta API
-- request is enabled by this migration. Every row remains CRM-account scoped.
ALTER TABLE public.meta_ad_account_integrations
  ADD COLUMN IF NOT EXISTS meta_page_ids TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ads_read_granted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS leads_retrieval_granted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ads_last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS leads_last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sync_error TEXT;

CREATE TABLE IF NOT EXISTS public.meta_ads_entities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  meta_ad_account_id TEXT NOT NULL CHECK (meta_ad_account_id ~ '^[0-9]{5,32}$'),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('campaign', 'adset', 'ad')),
  meta_entity_id TEXT NOT NULL CHECK (meta_entity_id ~ '^[0-9]{5,32}$'),
  name TEXT NOT NULL,
  campaign_id TEXT,
  adset_id TEXT,
  effective_status TEXT,
  objective TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, meta_ad_account_id, entity_type, meta_entity_id)
);
CREATE INDEX IF NOT EXISTS meta_ads_entities_lookup_idx
  ON public.meta_ads_entities(account_id, entity_type, meta_entity_id);

CREATE TABLE IF NOT EXISTS public.meta_ads_daily_insights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  meta_ad_account_id TEXT NOT NULL CHECK (meta_ad_account_id ~ '^[0-9]{5,32}$'),
  report_date DATE NOT NULL,
  ad_id TEXT NOT NULL CHECK (ad_id ~ '^[0-9]{5,32}$'),
  ad_name TEXT NOT NULL DEFAULT '',
  adset_id TEXT,
  adset_name TEXT NOT NULL DEFAULT '',
  campaign_id TEXT,
  campaign_name TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency ~ '^[A-Z]{3}$'),
  spend NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (spend >= 0),
  impressions BIGINT NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  reach BIGINT NOT NULL DEFAULT 0 CHECK (reach >= 0),
  clicks BIGINT NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  link_clicks BIGINT NOT NULL DEFAULT 0 CHECK (link_clicks >= 0),
  reported_leads BIGINT NOT NULL DEFAULT 0 CHECK (reported_leads >= 0),
  actions JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(actions) = 'array'),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, meta_ad_account_id, report_date, ad_id)
);
CREATE INDEX IF NOT EXISTS meta_ads_daily_insights_range_idx
  ON public.meta_ads_daily_insights(account_id, report_date DESC);
CREATE INDEX IF NOT EXISTS meta_ads_daily_insights_campaign_idx
  ON public.meta_ads_daily_insights(account_id, campaign_id, report_date DESC);

-- Receipts make future webhook deliveries and lead backfills idempotent. Their
-- fields are private form answers, so authenticated users get only tenant-scoped
-- reads while only the server service role may insert or update them.
CREATE TABLE IF NOT EXISTS public.meta_lead_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  meta_lead_id TEXT NOT NULL CHECK (meta_lead_id ~ '^[0-9]{5,32}$'),
  meta_ad_account_id TEXT,
  page_id TEXT,
  form_id TEXT,
  campaign_id TEXT,
  adset_id TEXT,
  ad_id TEXT,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  submitted_at TIMESTAMPTZ,
  fields JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(fields) = 'object'),
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'imported', 'failed')),
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_at TIMESTAMPTZ,
  UNIQUE (account_id, meta_lead_id)
);
CREATE INDEX IF NOT EXISTS meta_lead_receipts_range_idx
  ON public.meta_lead_receipts(account_id, submitted_at DESC);

ALTER TABLE public.meta_ads_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ads_daily_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_lead_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY meta_ads_entities_read ON public.meta_ads_entities
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY meta_ads_daily_insights_read ON public.meta_ads_daily_insights
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY meta_lead_receipts_read ON public.meta_lead_receipts
  FOR SELECT TO authenticated USING (
    public.is_account_member(account_id, 'admin')
    OR EXISTS (
      SELECT 1 FROM public.contacts visible_contact
      WHERE visible_contact.id = meta_lead_receipts.contact_id
        AND visible_contact.account_id = meta_lead_receipts.account_id
    )
  );

GRANT SELECT ON public.meta_ads_entities, public.meta_ads_daily_insights,
  public.meta_lead_receipts TO authenticated;
GRANT ALL ON public.meta_ads_entities, public.meta_ads_daily_insights,
  public.meta_lead_receipts TO service_role;

NOTIFY pgrst, 'reload schema';

