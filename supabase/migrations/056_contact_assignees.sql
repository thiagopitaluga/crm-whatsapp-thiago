-- 056_contact_assignees
--
-- A contact's responsible team member is a first-class relationship.
-- It must not reuse contacts.user_id: that column is the immutable audit
-- author used by webhooks and the public API.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS assigned_to UUID
  REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_assigned_to
  ON public.contacts(assigned_to);

-- A profile can belong to more than one account, so the FK alone cannot
-- prove that the chosen profile is a member of the contact's account.
-- Enforce that invariant in the database for every client/API write.
CREATE OR REPLACE FUNCTION public.assert_contact_assignee_in_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_to IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles profile
    JOIN public.account_memberships membership
      ON membership.user_id = profile.user_id
     AND membership.account_id = NEW.account_id
    WHERE profile.id = NEW.assigned_to
  ) THEN
    RAISE EXCEPTION 'Contact assignee must be a member of the contact account'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.assert_contact_assignee_in_account() OWNER TO postgres;

DROP TRIGGER IF EXISTS contacts_assert_assignee_account ON public.contacts;
CREATE TRIGGER contacts_assert_assignee_account
  BEFORE INSERT OR UPDATE OF account_id, assigned_to
  ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_contact_assignee_in_account();
