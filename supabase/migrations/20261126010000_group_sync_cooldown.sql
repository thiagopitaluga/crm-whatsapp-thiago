CREATE TABLE public.whatsapp_group_sync_state (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.whatsapp_group_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_group_sync_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.whatsapp_group_sync_state TO service_role;

CREATE FUNCTION public.claim_whatsapp_group_sync(p_account_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE claimed uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT coalesce(public.is_account_member(p_account_id,'agent'),false) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.whatsapp_group_sync_state(account_id) VALUES(p_account_id)
  ON CONFLICT(account_id) DO UPDATE SET attempted_at=now()
    WHERE whatsapp_group_sync_state.attempted_at < now()-interval '10 minutes'
  RETURNING account_id INTO claimed;
  RETURN claimed IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.claim_whatsapp_group_sync(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_group_sync(uuid) TO authenticated,service_role;
