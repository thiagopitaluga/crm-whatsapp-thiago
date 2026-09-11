-- ============================================================
-- 041_lead_tasks
--
-- Account-scoped tasks scheduled from Kanban lead cards. A task always
-- belongs to a lead/contact and may be assigned to a teammate.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (char_length(trim(title)) > 0),
  description TEXT,
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_account_due_at
  ON public.tasks(account_id, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_contact_id
  ON public.tasks(contact_id);
CREATE INDEX IF NOT EXISTS idx_tasks_deal_id
  ON public.tasks(deal_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to
  ON public.tasks(assigned_to);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_select ON public.tasks;
DROP POLICY IF EXISTS tasks_insert ON public.tasks;
DROP POLICY IF EXISTS tasks_update ON public.tasks;
DROP POLICY IF EXISTS tasks_delete ON public.tasks;

CREATE POLICY tasks_select ON public.tasks
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY tasks_delete ON public.tasks
  FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON public.tasks;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
