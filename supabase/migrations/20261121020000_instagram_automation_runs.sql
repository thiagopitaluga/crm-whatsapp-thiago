-- Each incoming event can schedule an automation only once.
ALTER TABLE public.instagram_automations ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT false;
ALTER TABLE public.instagram_automations ADD COLUMN IF NOT EXISTS channel_id uuid REFERENCES public.instagram_channels(id) ON DELETE CASCADE;
CREATE TABLE IF NOT EXISTS public.instagram_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES public.instagram_automations(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.instagram_channels(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.instagram_conversations(id) ON DELETE CASCADE,
  event_type text NOT NULL DEFAULT 'message' CHECK (event_type IN ('message', 'comment')),
  inbound_external_id text NOT NULL,
  recipient_id text NOT NULL,
  reply_text text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'uncertain')),
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(channel_id, inbound_external_id)
);
CREATE INDEX IF NOT EXISTS instagram_runs_pending_idx ON public.instagram_automation_runs(status, created_at);
ALTER TABLE public.instagram_automation_runs ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
