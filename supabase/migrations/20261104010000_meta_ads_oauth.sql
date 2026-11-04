-- Meta Ads OAuth tokens are available only to the server service role.
ALTER TABLE public.meta_ad_account_integrations
  ADD COLUMN IF NOT EXISTS meta_ad_account_name TEXT;

CREATE TABLE public.meta_ads_credentials (
  integration_id UUID PRIMARY KEY REFERENCES public.meta_ad_account_integrations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  access_token_encrypted TEXT NOT NULL,
  meta_user_id TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  sync_lock_until TIMESTAMPTZ NOT NULL DEFAULT '-infinity',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.meta_ads_oauth_sessions (
  state_hash TEXT PRIMARY KEY CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('authorizing', 'pending')),
  access_token_encrypted TEXT,
  meta_user_id TEXT,
  token_expires_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (phase <> 'pending' OR (access_token_encrypted IS NOT NULL AND meta_user_id IS NOT NULL AND token_expires_at IS NOT NULL))
);
CREATE INDEX meta_ads_oauth_sessions_expiry ON public.meta_ads_oauth_sessions(expires_at);
ALTER TABLE public.meta_ads_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ads_oauth_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_ads_credentials, public.meta_ads_oauth_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.meta_ads_credentials, public.meta_ads_oauth_sessions TO service_role;

-- Connect the tenant mapping and encrypted credential in one transaction.
-- The existing global UNIQUE constraint rejects an ad account used by another tenant.
CREATE FUNCTION public.connect_meta_ads_account(
  p_account_id UUID, p_user_id UUID, p_ad_account_id TEXT,
  p_name TEXT, p_token TEXT, p_meta_user_id TEXT, p_expires_at TIMESTAMPTZ
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_integration_id UUID;
BEGIN
  INSERT INTO public.meta_ad_account_integrations
    (account_id, provider, meta_ad_account_id, meta_ad_account_name, created_by, is_active, ads_read_granted)
  VALUES (p_account_id, 'meta', p_ad_account_id, p_name, p_user_id, TRUE, TRUE)
  ON CONFLICT (account_id, provider, meta_ad_account_id) DO UPDATE
    SET is_active = TRUE, ads_read_granted = TRUE, meta_ad_account_name = EXCLUDED.meta_ad_account_name,
        sync_error = NULL
  RETURNING id INTO v_integration_id;
  INSERT INTO public.meta_ads_credentials
    (integration_id, account_id, access_token_encrypted, meta_user_id, token_expires_at)
  VALUES (v_integration_id, p_account_id, p_token, p_meta_user_id, p_expires_at)
  ON CONFLICT (integration_id) DO UPDATE SET
    access_token_encrypted = EXCLUDED.access_token_encrypted,
    meta_user_id = EXCLUDED.meta_user_id, token_expires_at = EXCLUDED.token_expires_at,
    updated_at = NOW();
END;
$$;
REVOKE ALL ON FUNCTION public.connect_meta_ads_account(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.connect_meta_ads_account(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
NOTIFY pgrst, 'reload schema';
