-- Structured AI agent profile and reviewable examples learned from human replies.
ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS agent_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.ai_training_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  source_message_id uuid UNIQUE REFERENCES public.messages(id) ON DELETE SET NULL,
  customer_message text NOT NULL,
  agent_reply text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.ai_followup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('whatsapp_cloud', 'whatsapp_evolution')),
  sequence_index integer NOT NULL CHECK (sequence_index BETWEEN 0 AND 4),
  anchor_message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  run_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'sent', 'cancelled', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, conversation_id, sequence_index, anchor_message_id)
);

CREATE INDEX IF NOT EXISTS ai_followup_jobs_due_idx
  ON public.ai_followup_jobs (run_at) WHERE status = 'pending';
ALTER TABLE public.ai_followup_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_followup_jobs_select ON public.ai_followup_jobs;
CREATE POLICY ai_followup_jobs_select ON public.ai_followup_jobs FOR SELECT
  USING (public.is_account_member(account_id, 'admin'));

-- Jobs are scheduled and claimed by the service role cron only.

CREATE INDEX IF NOT EXISTS ai_training_examples_account_status_created_idx
  ON public.ai_training_examples (account_id, status, created_at DESC);

ALTER TABLE public.ai_training_examples ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_training_examples_select ON public.ai_training_examples;
CREATE POLICY ai_training_examples_select ON public.ai_training_examples FOR SELECT
  USING (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS ai_training_examples_update ON public.ai_training_examples;
CREATE POLICY ai_training_examples_update ON public.ai_training_examples FOR UPDATE
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS ai_training_examples_delete ON public.ai_training_examples;
CREATE POLICY ai_training_examples_delete ON public.ai_training_examples FOR DELETE
  USING (public.is_account_member(account_id, 'admin'));

-- Examples are created only by the service role from real human replies.
