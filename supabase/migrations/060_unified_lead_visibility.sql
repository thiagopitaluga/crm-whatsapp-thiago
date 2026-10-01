-- The contact is the source of truth for a lead's owner. Existing Kanban
-- assignments made before migration 059 may only exist on open deals.
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS agents_can_view_unassigned_contacts BOOLEAN NOT NULL DEFAULT FALSE;

WITH latest_assigned_deal AS (
  SELECT DISTINCT ON (deal.contact_id)
    deal.contact_id, deal.assigned_to
  FROM public.deals deal
  JOIN public.contacts contact
    ON contact.id = deal.contact_id
   AND contact.account_id = deal.account_id
  JOIN public.profiles profile ON profile.id = deal.assigned_to
  JOIN public.account_memberships membership
    ON membership.user_id = profile.user_id
   AND membership.account_id = deal.account_id
  WHERE deal.status = 'open'
    AND deal.assigned_to IS NOT NULL
    AND contact.assigned_to IS NULL
  ORDER BY deal.contact_id, deal.updated_at DESC NULLS LAST, deal.id DESC
)
UPDATE public.contacts contact
SET assigned_to = source.assigned_to
FROM latest_assigned_deal source
WHERE contact.id = source.contact_id
  AND contact.assigned_to IS NULL;

-- Bring every open card into line with its contact. The contact assignment
-- is kept when the two old fields disagree.
UPDATE public.deals deal
SET assigned_to = contact.assigned_to
FROM public.contacts contact
WHERE deal.contact_id = contact.id
  AND deal.account_id = contact.account_id
  AND deal.status = 'open'
  AND deal.assigned_to IS DISTINCT FROM contact.assigned_to;

CREATE OR REPLACE FUNCTION public.sync_open_deals_from_contact_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.deals deal
  SET assigned_to = NEW.assigned_to
  WHERE deal.contact_id = NEW.id
    AND deal.account_id = NEW.account_id
    AND deal.status = 'open'
    AND deal.assigned_to IS DISTINCT FROM NEW.assigned_to;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.sync_open_deals_from_contact_owner() OWNER TO postgres;
DROP TRIGGER IF EXISTS contacts_sync_open_deal_owners ON public.contacts;
CREATE TRIGGER contacts_sync_open_deal_owners
  AFTER UPDATE OF assigned_to ON public.contacts
  FOR EACH ROW
  WHEN (OLD.assigned_to IS DISTINCT FROM NEW.assigned_to)
  EXECUTE FUNCTION public.sync_open_deals_from_contact_owner();

CREATE OR REPLACE FUNCTION public.sync_contact_owner_from_open_deal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_owner UUID;
BEGIN
  IF NEW.contact_id IS NULL OR NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  SELECT contact.assigned_to INTO v_contact_owner
  FROM public.contacts contact
  WHERE contact.id = NEW.contact_id
    AND contact.account_id = NEW.account_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.assigned_to IS NULL
     AND v_contact_owner IS NOT NULL THEN
    UPDATE public.deals SET assigned_to = v_contact_owner WHERE id = NEW.id;
  ELSIF TG_OP = 'UPDATE'
    AND NEW.contact_id IS DISTINCT FROM OLD.contact_id
    AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
    UPDATE public.deals SET assigned_to = v_contact_owner WHERE id = NEW.id;
  ELSIF NEW.assigned_to IS DISTINCT FROM v_contact_owner THEN
    UPDATE public.contacts
    SET assigned_to = NEW.assigned_to
    WHERE id = NEW.contact_id;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.sync_contact_owner_from_open_deal() OWNER TO postgres;
DROP TRIGGER IF EXISTS deals_sync_contact_owner ON public.deals;
CREATE TRIGGER deals_sync_contact_owner
  AFTER INSERT OR UPDATE OF assigned_to, contact_id ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_contact_owner_from_open_deal();

-- All read paths use the same rule. The optional queue is visible to
-- attendants only when an administrator enables it for this account.
CREATE OR REPLACE FUNCTION public.can_view_lead(
  p_account_id UUID,
  p_assignee_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_account_member(p_account_id, 'admin')
    OR (
      public.is_account_member(p_account_id, 'agent')
      AND (
        p_assignee_id = public.current_account_profile_id(p_account_id)
        OR (
          p_assignee_id IS NULL
          AND EXISTS (
            SELECT 1 FROM public.accounts account
            WHERE account.id = p_account_id
              AND account.agents_can_view_unassigned_contacts
          )
        )
      )
    )
    OR (
      public.is_account_member(p_account_id)
      AND p_assignee_id = public.current_account_profile_id(p_account_id)
    );
$$;

ALTER FUNCTION public.can_view_lead(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_view_lead(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_lead(UUID, UUID)
  TO authenticated, service_role;

DROP POLICY IF EXISTS contacts_select ON public.contacts;
CREATE POLICY contacts_select ON public.contacts
  FOR SELECT USING (public.can_view_lead(account_id, assigned_to));

DROP POLICY IF EXISTS deals_select ON public.deals;
CREATE POLICY deals_select ON public.deals
  FOR SELECT USING (
    public.is_account_member(account_id, 'admin')
    OR (
      deals.contact_id IS NULL
      AND public.can_view_lead(account_id, deals.assigned_to)
    )
    OR EXISTS (
      SELECT 1 FROM public.contacts contact
      WHERE contact.id = deals.contact_id
        AND contact.account_id = deals.account_id
        AND public.can_view_lead(contact.account_id, contact.assigned_to)
    )
  );

-- A visible unassigned queue is read-only for attendants until an admin
-- assigns its contacts. Other attendants' leads cannot be edited by ID.
DROP POLICY IF EXISTS contacts_update ON public.contacts;
CREATE POLICY contacts_update ON public.contacts FOR UPDATE
  USING (
    public.is_account_member(account_id, 'admin')
    OR (public.is_account_member(account_id, 'agent')
        AND assigned_to = public.current_account_profile_id(account_id))
  )
  WITH CHECK (
    public.is_account_member(account_id, 'admin')
    OR (public.is_account_member(account_id, 'agent')
        AND assigned_to = public.current_account_profile_id(account_id))
  );

DROP POLICY IF EXISTS contacts_delete ON public.contacts;
CREATE POLICY contacts_delete ON public.contacts FOR DELETE
  USING (
    public.is_account_member(account_id, 'admin')
    OR (public.is_account_member(account_id, 'agent')
        AND assigned_to = public.current_account_profile_id(account_id))
  );

DROP POLICY IF EXISTS deals_insert ON public.deals;
CREATE POLICY deals_insert ON public.deals FOR INSERT
  WITH CHECK (
    public.is_account_member(account_id, 'admin')
    OR (public.is_account_member(account_id, 'agent')
        AND EXISTS (
          SELECT 1 FROM public.contacts contact
          WHERE contact.id = deals.contact_id
            AND contact.account_id = deals.account_id
            AND contact.assigned_to = public.current_account_profile_id(deals.account_id)
        ))
  );

DROP POLICY IF EXISTS deals_update ON public.deals;
CREATE POLICY deals_update ON public.deals FOR UPDATE
  USING (
    public.is_account_member(account_id, 'admin')
    OR (public.is_account_member(account_id, 'agent')
        AND EXISTS (
          SELECT 1 FROM public.contacts contact
          WHERE contact.id = deals.contact_id
            AND contact.account_id = deals.account_id
            AND contact.assigned_to = public.current_account_profile_id(deals.account_id)
        ))
  )
  WITH CHECK (public.is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS deals_delete ON public.deals;
CREATE POLICY deals_delete ON public.deals FOR DELETE
  USING (
    public.is_account_member(account_id, 'admin')
    OR (public.is_account_member(account_id, 'agent')
        AND EXISTS (
          SELECT 1 FROM public.contacts contact
          WHERE contact.id = deals.contact_id
            AND contact.account_id = deals.account_id
            AND contact.assigned_to = public.current_account_profile_id(deals.account_id)
        ))
  );

DROP POLICY IF EXISTS conversations_select ON public.conversations;
CREATE POLICY conversations_select ON public.conversations FOR SELECT
  USING (
    public.is_account_member(account_id, 'admin')
    OR EXISTS (
      SELECT 1 FROM public.contacts contact
      WHERE contact.id = conversations.contact_id
        AND contact.account_id = conversations.account_id
        AND public.can_view_lead(contact.account_id, contact.assigned_to)
    )
  );

DROP POLICY IF EXISTS tasks_select ON public.tasks;
CREATE POLICY tasks_select ON public.tasks FOR SELECT
  USING (
    public.is_account_member(account_id, 'admin')
    OR EXISTS (
      SELECT 1 FROM public.contacts contact
      WHERE contact.id = tasks.contact_id
        AND contact.account_id = tasks.account_id
        AND public.can_view_lead(contact.account_id, contact.assigned_to)
    )
  );
