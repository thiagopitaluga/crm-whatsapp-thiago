-- Instagram automation drafts are isolated by CRM account.
CREATE TABLE IF NOT EXISTS public.instagram_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 150),
  trigger_type text NOT NULL CHECK (trigger_type IN ('message_keyword', 'first_message', 'comment_keyword')),
  keywords text NOT NULL DEFAULT '',
  target_media_id text,
  reply_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS instagram_automations_account_idx ON public.instagram_automations(account_id, created_at DESC);
ALTER TABLE public.instagram_automations ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
