-- ============================================================
-- 050_campaign_attribution_clicks.sql
--
-- Public campaign links deliberately expose only an opaque slug. The
-- redirect route resolves that slug with the service role, stores the
-- click attribution, and redirects to WhatsApp without returning any CRM
-- account data to the visitor.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.campaign_tracking_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- Lowercase URL-safe handle, e.g. "morgana-lotes". It is public by
  -- design, but does not reveal a UUID, account name, or any CRM data.
  slug TEXT NOT NULL UNIQUE,
  whatsapp_number TEXT NOT NULL,
  default_message TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT campaign_tracking_links_slug_format
    -- PostgreSQL uses POSIX regular expressions, so this deliberately
    -- avoids PCRE-only non-capturing groups.
    CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$'),
  CONSTRAINT campaign_tracking_links_whatsapp_number_format
    CHECK (whatsapp_number ~ '^[1-9][0-9]{6,14}$')
);

CREATE INDEX IF NOT EXISTS idx_campaign_tracking_links_account
  ON public.campaign_tracking_links(account_id, created_at DESC);

ALTER TABLE public.campaign_tracking_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaign_tracking_links_select ON public.campaign_tracking_links;
CREATE POLICY campaign_tracking_links_select ON public.campaign_tracking_links
  FOR SELECT
  USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS campaign_tracking_links_insert ON public.campaign_tracking_links;
CREATE POLICY campaign_tracking_links_insert ON public.campaign_tracking_links
  FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS campaign_tracking_links_update ON public.campaign_tracking_links;
CREATE POLICY campaign_tracking_links_update ON public.campaign_tracking_links
  FOR UPDATE
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS campaign_tracking_links_delete ON public.campaign_tracking_links;
CREATE POLICY campaign_tracking_links_delete ON public.campaign_tracking_links
  FOR DELETE
  USING (public.is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON public.campaign_tracking_links;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.campaign_tracking_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.campaign_attribution_clicks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  tracking_link_id UUID NOT NULL REFERENCES public.campaign_tracking_links(id) ON DELETE CASCADE,
  -- Random 144-bit URL-safe token. This is the only identifier passed to
  -- WhatsApp and is intentionally not derived from click or account data.
  token TEXT NOT NULL UNIQUE,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  gclid TEXT,
  fbclid TEXT,
  msclkid TEXT,
  landing_url TEXT,
  referrer TEXT,
  user_agent TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  resolved_at TIMESTAMPTZ,
  resolved_contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  resolved_conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  CONSTRAINT campaign_attribution_clicks_token_format
    CHECK (token ~ '^[A-Za-z0-9_-]{24}$'),
  CONSTRAINT campaign_attribution_clicks_expiry_after_capture
    CHECK (expires_at > captured_at)
);

CREATE INDEX IF NOT EXISTS idx_campaign_attribution_clicks_account_captured
  ON public.campaign_attribution_clicks(account_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_attribution_clicks_token_active
  ON public.campaign_attribution_clicks(token, expires_at);
CREATE INDEX IF NOT EXISTS idx_campaign_attribution_clicks_contact
  ON public.campaign_attribution_clicks(account_id, resolved_contact_id)
  WHERE resolved_contact_id IS NOT NULL;

ALTER TABLE public.campaign_attribution_clicks ENABLE ROW LEVEL SECURITY;

-- Clicks are written exclusively by the public redirect's service-role
-- backend. Members can read only attribution belonging to their active
-- CRM account; no browser client can insert or alter attribution history.
DROP POLICY IF EXISTS campaign_attribution_clicks_select ON public.campaign_attribution_clicks;
CREATE POLICY campaign_attribution_clicks_select ON public.campaign_attribution_clicks
  FOR SELECT
  USING (public.is_account_member(account_id));

COMMENT ON TABLE public.campaign_tracking_links IS
  'Public, account-scoped WhatsApp click entry points for campaign attribution.';
COMMENT ON TABLE public.campaign_attribution_clicks IS
  'First-party click attribution captured before redirecting a visitor to WhatsApp.';
