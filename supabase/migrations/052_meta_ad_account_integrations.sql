-- An advertising account may feed exactly one CRM tenant.  This prevents a
-- Meta campaign connection from accidentally exposing acquisition data to a
-- different OrganiZAP account.

CREATE TABLE IF NOT EXISTS public.meta_ad_account_integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'meta' CHECK (provider = 'meta'),
  -- Meta's immutable ad-account id, without assuming an `act_` prefix.
  meta_ad_account_id TEXT NOT NULL
    CHECK (meta_ad_account_id ~ '^[0-9]{5,32}$'),
  meta_business_id TEXT
    CHECK (meta_business_id IS NULL OR meta_business_id ~ '^[0-9]{5,32}$'),
  access_scope TEXT NOT NULL DEFAULT 'read' CHECK (access_scope = 'read'),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT meta_ad_account_integrations_one_crm_per_ad_account
    UNIQUE (provider, meta_ad_account_id),
  CONSTRAINT meta_ad_account_integrations_one_entry_per_account
    UNIQUE (account_id, provider, meta_ad_account_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_ad_account_integrations_account
  ON public.meta_ad_account_integrations(account_id, is_active);

ALTER TABLE public.meta_ad_account_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_ad_account_integrations_select
  ON public.meta_ad_account_integrations;
CREATE POLICY meta_ad_account_integrations_select
  ON public.meta_ad_account_integrations FOR SELECT
  USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS meta_ad_account_integrations_insert
  ON public.meta_ad_account_integrations;
CREATE POLICY meta_ad_account_integrations_insert
  ON public.meta_ad_account_integrations FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS meta_ad_account_integrations_update
  ON public.meta_ad_account_integrations;
CREATE POLICY meta_ad_account_integrations_update
  ON public.meta_ad_account_integrations FOR UPDATE
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS meta_ad_account_integrations_delete
  ON public.meta_ad_account_integrations;
CREATE POLICY meta_ad_account_integrations_delete
  ON public.meta_ad_account_integrations FOR DELETE
  USING (public.is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON public.meta_ad_account_integrations;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.meta_ad_account_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.meta_ad_account_integrations IS
  'Tenant-scoped Meta ad-account connections. An ad account belongs to exactly one CRM tenant.';
