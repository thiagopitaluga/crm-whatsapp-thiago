-- ============================================================
-- 057_advertising_attribution_foundation.sql
--
-- Provider-neutral, account-scoped foundation for advertising attribution.
-- Existing campaign links, Meta CTWA referrals and their webhook path remain
-- untouched. These tables let each CRM connect its own Meta/Google account
-- later without leaking advertising data between CRM tenants.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.advertising_integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('meta', 'google_ads')),
  external_account_id TEXT NOT NULL,
  manager_account_id TEXT,
  display_name TEXT,
  access_scope TEXT NOT NULL DEFAULT 'read' CHECK (access_scope = 'read'),
  connection_status TEXT NOT NULL DEFAULT 'not_connected'
    CHECK (connection_status IN ('not_connected', 'connected', 'error')),
  -- This is a key/name to a server-side secret, never the secret itself.
  credential_ref TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT advertising_integrations_unique_provider_account
    UNIQUE (provider, external_account_id),
  CONSTRAINT advertising_integrations_unique_tenant_provider_account
    UNIQUE (account_id, provider, external_account_id)
);

CREATE INDEX IF NOT EXISTS idx_advertising_integrations_tenant
  ON public.advertising_integrations(account_id, provider, is_active);

ALTER TABLE public.advertising_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS advertising_integrations_select ON public.advertising_integrations;
CREATE POLICY advertising_integrations_select ON public.advertising_integrations
  FOR SELECT USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS advertising_integrations_insert ON public.advertising_integrations;
CREATE POLICY advertising_integrations_insert ON public.advertising_integrations
  FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS advertising_integrations_update ON public.advertising_integrations;
CREATE POLICY advertising_integrations_update ON public.advertising_integrations
  FOR UPDATE USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS advertising_integrations_delete ON public.advertising_integrations;
CREATE POLICY advertising_integrations_delete ON public.advertising_integrations
  FOR DELETE USING (public.is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON public.advertising_integrations;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.advertising_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- A contact can receive several acquisition touches. This preserves first /
-- last touch history instead of flattening tracking onto custom fields.
CREATE TABLE IF NOT EXISTS public.attribution_touchpoints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  tracking_click_id UUID REFERENCES public.campaign_attribution_clicks(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('meta', 'google_ads', 'website', 'direct', 'other')),
  method TEXT NOT NULL CHECK (method IN ('ctwa_referral', 'tracking_link', 'landing_page', 'import', 'manual')),
  source_platform TEXT,
  source_channel TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  gclid TEXT,
  fbclid TEXT,
  msclkid TEXT,
  ctwa_clid TEXT,
  ad_account_id TEXT,
  campaign_id TEXT,
  campaign_name TEXT,
  ad_group_id TEXT,
  ad_group_name TEXT,
  ad_id TEXT,
  ad_name TEXT,
  placement TEXT,
  network TEXT,
  landing_url TEXT,
  referrer TEXT,
  confidence TEXT NOT NULL DEFAULT 'observed'
    CHECK (confidence IN ('observed', 'matched', 'modeled', 'manual')),
  raw_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(raw_metadata) = 'object'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attribution_touchpoints_unique_tracking_click
    UNIQUE (tracking_click_id),
  CONSTRAINT attribution_touchpoints_unique_ctwa_conversation
    UNIQUE (account_id, conversation_id, provider, method)
);

CREATE INDEX IF NOT EXISTS idx_attribution_touchpoints_contact
  ON public.attribution_touchpoints(account_id, contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_attribution_touchpoints_campaign
  ON public.attribution_touchpoints(account_id, provider, campaign_id)
  WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attribution_touchpoints_gclid
  ON public.attribution_touchpoints(account_id, gclid)
  WHERE gclid IS NOT NULL;

ALTER TABLE public.attribution_touchpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attribution_touchpoints_select ON public.attribution_touchpoints;
CREATE POLICY attribution_touchpoints_select ON public.attribution_touchpoints
  FOR SELECT USING (public.is_account_member(account_id));
-- Inbound webhooks use service role. These policies permit future internal
-- admin import tooling without opening browser writes to regular members.
DROP POLICY IF EXISTS attribution_touchpoints_insert ON public.attribution_touchpoints;
CREATE POLICY attribution_touchpoints_insert ON public.attribution_touchpoints
  FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS attribution_touchpoints_update ON public.attribution_touchpoints;
CREATE POLICY attribution_touchpoints_update ON public.attribution_touchpoints
  FOR UPDATE USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

-- Daily read-only snapshots are populated only after an Ads provider is
-- connected. They keep the reporting UI fast and avoid live API calls while
-- an agent is using the CRM.
CREATE TABLE IF NOT EXISTS public.advertising_insight_daily (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES public.advertising_integrations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('meta', 'google_ads')),
  insight_date DATE NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('account', 'campaign', 'ad_group', 'ad', 'placement')),
  external_entity_id TEXT NOT NULL,
  external_entity_name TEXT,
  parent_entity_id TEXT,
  parent_entity_name TEXT,
  currency TEXT,
  spend NUMERIC(18, 6) NOT NULL DEFAULT 0,
  impressions BIGINT NOT NULL DEFAULT 0,
  reach BIGINT,
  clicks BIGINT NOT NULL DEFAULT 0,
  ctr NUMERIC(12, 6),
  cpc NUMERIC(18, 6),
  cpm NUMERIC(18, 6),
  frequency NUMERIC(12, 6),
  conversions JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(conversions) = 'object'),
  raw_metrics JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(raw_metrics) = 'object'),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT advertising_insight_daily_unique_snapshot
    UNIQUE (integration_id, insight_date, level, external_entity_id, parent_entity_id)
);

CREATE INDEX IF NOT EXISTS idx_advertising_insight_daily_tenant_date
  ON public.advertising_insight_daily(account_id, provider, insight_date DESC);

ALTER TABLE public.advertising_insight_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS advertising_insight_daily_select ON public.advertising_insight_daily;
CREATE POLICY advertising_insight_daily_select ON public.advertising_insight_daily
  FOR SELECT USING (public.is_account_member(account_id));

DROP TRIGGER IF EXISTS set_updated_at ON public.advertising_insight_daily;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.advertising_insight_daily
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.advertising_integrations IS
  'Tenant-scoped read-only Meta Ads and Google Ads account connections; secrets remain server-side.';
COMMENT ON TABLE public.attribution_touchpoints IS
  'Normalized first/last/multi-touch acquisition history for CRM contacts.';
COMMENT ON TABLE public.advertising_insight_daily IS
  'Read-only daily advertising metrics, cached after a provider sync.';
