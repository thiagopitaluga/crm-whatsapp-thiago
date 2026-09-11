-- ============================================================
-- 044_multi_account_memberships
--
-- A login can now belong to many CRM accounts. `profiles.account_id`
-- remains as the user's *active* account for backward compatibility
-- with the existing client and API queries; the source of truth for
-- access is `account_memberships`.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.account_memberships (
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role account_role_enum NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_account_memberships_user
  ON public.account_memberships(user_id, account_id);

ALTER TABLE public.account_memberships ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON public.account_memberships;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.account_memberships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Every existing active profile is already a valid membership.
INSERT INTO public.account_memberships (account_id, user_id, role)
SELECT account_id, user_id, account_role
FROM public.profiles
WHERE account_id IS NOT NULL AND account_role IS NOT NULL
ON CONFLICT (account_id, user_id) DO UPDATE SET role = EXCLUDED.role;

-- Account ownership is a role within a membership, not a one-account
-- invariant. A person may own one company and collaborate in another.
DROP INDEX IF EXISTS public.idx_accounts_one_per_owner;

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
    FROM public.account_memberships m
    WHERE m.user_id = auth.uid()
      AND m.account_id = target_account_id
      AND CASE m.role
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

CREATE OR REPLACE FUNCTION public.shares_account_with(
  target_user_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() = target_user_id OR EXISTS (
    SELECT 1
    FROM public.account_memberships mine
    JOIN public.account_memberships theirs
      ON theirs.account_id = mine.account_id
    WHERE mine.user_id = auth.uid()
      AND theirs.user_id = target_user_id
  );
$$;

ALTER FUNCTION public.is_account_member(UUID, account_role_enum) OWNER TO postgres;
ALTER FUNCTION public.shares_account_with(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.is_account_member(UUID, account_role_enum) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.shares_account_with(UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS account_memberships_select ON public.account_memberships;
CREATE POLICY account_memberships_select ON public.account_memberships
  FOR SELECT USING (user_id = auth.uid() OR public.is_account_member(account_id));

-- Profile reads must use all memberships, not only whichever account is
-- currently active in the target user's profile.
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles FOR SELECT
  USING (public.shares_account_with(user_id));

-- Switches are exclusively through this guarded RPC so a caller can
-- never point their active profile at an account they do not belong to.
CREATE OR REPLACE FUNCTION public.set_active_account(
  p_account_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_role
  FROM public.account_memberships
  WHERE account_id = p_account_id AND user_id = auth.uid();

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this account' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET account_id = p_account_id, account_role = v_role
  WHERE user_id = auth.uid();
END;
$$;

ALTER FUNCTION public.set_active_account(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_active_account(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_active_account(UUID) TO authenticated;

-- A new signup always starts with a personal account *and* an owner
-- membership. Later invitations add memberships without removing it.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  INSERT INTO public.account_memberships (account_id, user_id, role)
  VALUES (v_account_id, NEW.id, 'owner');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- Redeeming an invitation now grants another membership and makes it
-- active. It deliberately retains the recipient's existing accounts.
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv public.account_invitations%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM public.account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed' USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.account_memberships
    WHERE account_id = v_inv.account_id AND user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'You are already a member of this account' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.account_memberships (account_id, user_id, role)
  VALUES (v_inv.account_id, v_caller_id, v_inv.role);

  UPDATE public.profiles
  SET account_id = v_inv.account_id, account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE public.account_invitations
  SET accepted_at = NOW(), accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  RETURN v_inv.account_id;
END;
$$;

-- Member management now changes only the membership for the active
-- account; a user can continue belonging to their other companies.
CREATE OR REPLACE FUNCTION public.set_member_role(
  p_user_id UUID,
  p_new_role account_role_enum
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT account_id INTO v_account_id FROM public.profiles WHERE user_id = auth.uid();
  IF v_account_id IS NULL OR NOT public.is_account_member(v_account_id, 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher' USING ERRCODE = '42501';
  END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'Cannot change your own role' USING ERRCODE = '22023'; END IF;
  SELECT role INTO v_target_role FROM public.account_memberships WHERE account_id = v_account_id AND user_id = p_user_id;
  IF v_target_role IS NULL THEN RAISE EXCEPTION 'Target user is not a member of your account' USING ERRCODE = '42501'; END IF;
  IF v_target_role = 'owner' OR p_new_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to change an owner role' USING ERRCODE = '22023';
  END IF;
  UPDATE public.account_memberships SET role = p_new_role WHERE account_id = v_account_id AND user_id = p_user_id;
  UPDATE public.profiles SET account_role = p_new_role WHERE user_id = p_user_id AND account_id = v_account_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_account_member(
  p_user_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_target_role account_role_enum;
  v_next_account_id UUID;
  v_next_role account_role_enum;
  v_name TEXT;
  v_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT account_id INTO v_account_id FROM public.profiles WHERE user_id = auth.uid();
  IF v_account_id IS NULL OR NOT public.is_account_member(v_account_id, 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher' USING ERRCODE = '42501';
  END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'Cannot remove yourself; leave the account from another account switcher' USING ERRCODE = '22023'; END IF;
  SELECT role INTO v_target_role FROM public.account_memberships WHERE account_id = v_account_id AND user_id = p_user_id;
  IF v_target_role IS NULL THEN RAISE EXCEPTION 'Target user is not a member of your account' USING ERRCODE = '42501'; END IF;
  IF v_target_role = 'owner' THEN RAISE EXCEPTION 'Cannot remove the account owner; transfer ownership first' USING ERRCODE = '22023'; END IF;

  DELETE FROM public.account_memberships WHERE account_id = v_account_id AND user_id = p_user_id;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id = p_user_id AND account_id = v_account_id) THEN
    SELECT account_id, role INTO v_next_account_id, v_next_role
    FROM public.account_memberships WHERE user_id = p_user_id ORDER BY created_at ASC LIMIT 1;
    IF v_next_account_id IS NULL THEN
      SELECT full_name, email INTO v_name, v_email FROM public.profiles WHERE user_id = p_user_id;
      INSERT INTO public.accounts (name, owner_user_id)
      VALUES (COALESCE(NULLIF(v_name, ''), v_email, 'My account'), p_user_id)
      RETURNING id INTO v_next_account_id;
      v_next_role := 'owner';
      INSERT INTO public.account_memberships (account_id, user_id, role)
      VALUES (v_next_account_id, p_user_id, v_next_role);
    END IF;
    UPDATE public.profiles SET account_id = v_next_account_id, account_role = v_next_role WHERE user_id = p_user_id;
  END IF;

  RETURN v_next_account_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_account_ownership(
  p_new_owner_user_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT account_id INTO v_account_id FROM public.profiles WHERE user_id = auth.uid();
  IF v_account_id IS NULL OR NOT public.is_account_member(v_account_id, 'owner') THEN
    RAISE EXCEPTION 'Only the account owner can transfer ownership' USING ERRCODE = '42501';
  END IF;
  IF p_new_owner_user_id = auth.uid() THEN RAISE EXCEPTION 'You are already the owner' USING ERRCODE = '22023'; END IF;
  SELECT role INTO v_target_role FROM public.account_memberships WHERE account_id = v_account_id AND user_id = p_new_owner_user_id;
  IF v_target_role IS NULL THEN RAISE EXCEPTION 'Target user is not a member of your account' USING ERRCODE = '42501'; END IF;

  UPDATE public.account_memberships SET role = 'admin' WHERE account_id = v_account_id AND user_id = auth.uid();
  UPDATE public.account_memberships SET role = 'owner' WHERE account_id = v_account_id AND user_id = p_new_owner_user_id;
  UPDATE public.profiles SET account_role = 'admin' WHERE user_id = auth.uid() AND account_id = v_account_id;
  UPDATE public.profiles SET account_role = 'owner' WHERE user_id = p_new_owner_user_id AND account_id = v_account_id;
  UPDATE public.accounts SET owner_user_id = p_new_owner_user_id WHERE id = v_account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
ALTER FUNCTION public.set_member_role(UUID, account_role_enum) OWNER TO postgres;
ALTER FUNCTION public.remove_account_member(UUID) OWNER TO postgres;
ALTER FUNCTION public.transfer_account_ownership(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_member_role(UUID, account_role_enum) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_account_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transfer_account_ownership(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_role(UUID, account_role_enum) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_account_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_account_ownership(UUID) TO authenticated;
