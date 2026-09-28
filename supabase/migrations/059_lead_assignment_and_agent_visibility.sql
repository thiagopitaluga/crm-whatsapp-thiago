-- 059_lead_assignment_and_agent_visibility
--
-- A lead owner lives on contacts. Open deals mirror that owner so Kanban
-- cards, contacts and assignments never drift apart. The RPCs below make
-- each assignment atomic and validate both the active account and target.

CREATE OR REPLACE FUNCTION public.current_account_profile_id(
  p_account_id UUID
) RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT profile.id
  FROM public.profiles profile
  WHERE profile.user_id = auth.uid()
    AND profile.account_id = p_account_id
  LIMIT 1;
$$;

ALTER FUNCTION public.current_account_profile_id(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.current_account_profile_id(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_account_profile_id(UUID)
  TO authenticated, service_role;

-- A lead created manually by an agent becomes theirs immediately. Service
-- integrations run without auth.uid(), so inbound/unrouted leads remain in
-- the manager queue until an admin assigns them.
CREATE OR REPLACE FUNCTION public.assign_new_contact_to_agent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_to IS NULL
     AND auth.uid() IS NOT NULL
     AND public.is_account_member(NEW.account_id, 'agent')
     AND NOT public.is_account_member(NEW.account_id, 'admin') THEN
    NEW.assigned_to := public.current_account_profile_id(NEW.account_id);
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.assign_new_contact_to_agent() OWNER TO postgres;

DROP TRIGGER IF EXISTS contacts_assign_new_agent_owner ON public.contacts;
CREATE TRIGGER contacts_assign_new_agent_owner
  BEFORE INSERT ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_new_contact_to_agent();

CREATE OR REPLACE FUNCTION public.assign_contact_owner(
  p_contact_id UUID,
  p_assignee_id UUID DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_current_assignee_id UUID;
  v_caller_profile_id UUID;
BEGIN
  SELECT contact.account_id, contact.assigned_to
  INTO v_account_id, v_current_assignee_id
  FROM public.contacts contact
  WHERE contact.id = p_contact_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contact not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_account_member(v_account_id, 'agent') THEN
    RAISE EXCEPTION 'You cannot assign leads in this account'
      USING ERRCODE = '42501';
  END IF;

  v_caller_profile_id := public.current_account_profile_id(v_account_id);

  -- Owners and admins may assign every lead. An agent may only reassign a
  -- lead already assigned to them, preventing lateral access to the queue.
  IF NOT public.is_account_member(v_account_id, 'admin')
     AND v_current_assignee_id IS DISTINCT FROM v_caller_profile_id THEN
    RAISE EXCEPTION 'You can only assign leads currently assigned to you'
      USING ERRCODE = '42501';
  END IF;

  IF p_assignee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.profiles profile
    JOIN public.account_memberships membership
      ON membership.user_id = profile.user_id
     AND membership.account_id = v_account_id
    WHERE profile.id = p_assignee_id
  ) THEN
    RAISE EXCEPTION 'Assignee must be a member of the active account'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.contacts
  SET assigned_to = p_assignee_id
  WHERE id = p_contact_id;

  -- Open deals represent the live Kanban work. Keep their visual owner in
  -- sync with the contact while retaining the assignee history on closed
  -- deals.
  UPDATE public.deals
  SET assigned_to = p_assignee_id
  WHERE account_id = v_account_id
    AND contact_id = p_contact_id
    AND status = 'open';

  RETURN 1;
END;
$$;

ALTER FUNCTION public.assign_contact_owner(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.assign_contact_owner(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_contact_owner(UUID, UUID)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_deal_owner(
  p_deal_id UUID,
  p_assignee_id UUID DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_contact_id UUID;
  v_current_assignee_id UUID;
  v_caller_profile_id UUID;
BEGIN
  SELECT deal.account_id, deal.contact_id, deal.assigned_to
  INTO v_account_id, v_contact_id, v_current_assignee_id
  FROM public.deals deal
  WHERE deal.id = p_deal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deal not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_contact_id IS NOT NULL THEN
    RETURN public.assign_contact_owner(v_contact_id, p_assignee_id);
  END IF;

  IF NOT public.is_account_member(v_account_id, 'agent') THEN
    RAISE EXCEPTION 'You cannot assign leads in this account'
      USING ERRCODE = '42501';
  END IF;

  v_caller_profile_id := public.current_account_profile_id(v_account_id);
  IF NOT public.is_account_member(v_account_id, 'admin')
     AND v_current_assignee_id IS DISTINCT FROM v_caller_profile_id THEN
    RAISE EXCEPTION 'You can only assign leads currently assigned to you'
      USING ERRCODE = '42501';
  END IF;

  IF p_assignee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.profiles profile
    JOIN public.account_memberships membership
      ON membership.user_id = profile.user_id
     AND membership.account_id = v_account_id
    WHERE profile.id = p_assignee_id
  ) THEN
    RAISE EXCEPTION 'Assignee must be a member of the active account'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.deals
  SET assigned_to = p_assignee_id
  WHERE id = p_deal_id;

  RETURN 1;
END;
$$;

ALTER FUNCTION public.assign_deal_owner(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.assign_deal_owner(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_deal_owner(UUID, UUID)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_contacts_owner_bulk(
  p_contact_ids UUID[],
  p_assignee_id UUID DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_caller_profile_id UUID;
  v_requested_count INTEGER;
  v_matched_count INTEGER;
BEGIN
  SELECT profile.account_id INTO v_account_id
  FROM public.profiles profile
  WHERE profile.user_id = auth.uid();

  IF v_account_id IS NULL
     OR NOT public.is_account_member(v_account_id, 'agent') THEN
    RAISE EXCEPTION 'You cannot assign leads in this account'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_requested_count
  FROM (SELECT DISTINCT id FROM unnest(p_contact_ids) AS id) requested;
  IF v_requested_count = 0 THEN
    RAISE EXCEPTION 'Select at least one contact' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_matched_count
  FROM public.contacts contact
  WHERE contact.account_id = v_account_id
    AND contact.id = ANY(p_contact_ids);
  IF v_matched_count <> v_requested_count THEN
    RAISE EXCEPTION 'One or more contacts are unavailable'
      USING ERRCODE = '42501';
  END IF;

  v_caller_profile_id := public.current_account_profile_id(v_account_id);
  IF NOT public.is_account_member(v_account_id, 'admin') AND EXISTS (
    SELECT 1
    FROM public.contacts contact
    WHERE contact.account_id = v_account_id
      AND contact.id = ANY(p_contact_ids)
      AND contact.assigned_to IS DISTINCT FROM v_caller_profile_id
  ) THEN
    RAISE EXCEPTION 'You can only assign leads currently assigned to you'
      USING ERRCODE = '42501';
  END IF;

  IF p_assignee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.profiles profile
    JOIN public.account_memberships membership
      ON membership.user_id = profile.user_id
     AND membership.account_id = v_account_id
    WHERE profile.id = p_assignee_id
  ) THEN
    RAISE EXCEPTION 'Assignee must be a member of the active account'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.contacts
  SET assigned_to = p_assignee_id
  WHERE account_id = v_account_id
    AND id = ANY(p_contact_ids);

  UPDATE public.deals
  SET assigned_to = p_assignee_id
  WHERE account_id = v_account_id
    AND contact_id = ANY(p_contact_ids)
    AND status = 'open';

  RETURN v_matched_count;
END;
$$;

ALTER FUNCTION public.assign_contacts_owner_bulk(UUID[], UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.assign_contacts_owner_bulk(UUID[], UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_contacts_owner_bulk(UUID[], UUID)
  TO authenticated;

-- Agents may only read leads assigned to their active profile. Admins and
-- owners retain the full account view; viewers preserve their read-only
-- account-wide reporting access.
DROP POLICY IF EXISTS contacts_select ON public.contacts;
CREATE POLICY contacts_select ON public.contacts
  FOR SELECT USING (
    public.is_account_member(account_id, 'admin')
    OR (
      public.is_account_member(account_id, 'agent')
      AND assigned_to = public.current_account_profile_id(account_id)
    )
    OR (
      public.is_account_member(account_id)
      AND NOT public.is_account_member(account_id, 'agent')
    )
  );

DROP POLICY IF EXISTS deals_select ON public.deals;
CREATE POLICY deals_select ON public.deals
  FOR SELECT USING (
    public.is_account_member(account_id, 'admin')
    OR (
      public.is_account_member(account_id, 'agent')
      AND EXISTS (
        SELECT 1
        FROM public.contacts contact
        WHERE contact.id = deals.contact_id
          AND contact.account_id = deals.account_id
          AND contact.assigned_to = public.current_account_profile_id(deals.account_id)
      )
    )
    OR (
      public.is_account_member(account_id)
      AND NOT public.is_account_member(account_id, 'agent')
    )
  );

CREATE INDEX IF NOT EXISTS idx_contacts_account_assigned_to
  ON public.contacts(account_id, assigned_to);
