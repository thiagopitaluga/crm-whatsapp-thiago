-- ============================================================
-- 045_scope_data_to_active_account
--
-- A person may be a member of several CRM accounts, but they work in
-- one active account at a time (`profiles.account_id`).  044 correctly
-- retained every membership, yet its membership predicate also made
-- every account's operational rows visible at once.  That lets a
-- switched account show another company's contacts, deals and funnels.
--
-- Keep the complete membership set for the account switcher, while
-- requiring the target row to belong to the caller's active account for
-- every operational RLS policy that uses `is_account_member`.
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles active_profile
    JOIN public.account_memberships membership
      ON membership.user_id = active_profile.user_id
      AND membership.account_id = target_account_id
    WHERE active_profile.user_id = auth.uid()
      AND active_profile.account_id = target_account_id
      AND CASE membership.role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >= CASE min_role
             WHEN 'owner'  THEN 4
             WHEN 'admin'  THEN 3
             WHEN 'agent'  THEN 2
             WHEN 'viewer' THEN 1
           END
  );
$$;

ALTER FUNCTION public.is_account_member(UUID, account_role_enum) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_account_member(UUID, account_role_enum) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_account_member(UUID, account_role_enum) TO authenticated, service_role;

-- The account switcher is intentionally the exception: it must list
-- every account the signed-in person belongs to, not only the active
-- one. Operational rows continue to use the active-aware function.
DROP POLICY IF EXISTS accounts_select ON public.accounts;
CREATE POLICY accounts_select ON public.accounts FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.account_memberships membership
      WHERE membership.account_id = accounts.id
        AND membership.user_id = auth.uid()
    )
  );
