ALTER TABLE public.group_broadcasts
  ADD COLUMN IF NOT EXISTS sender_channel_id uuid REFERENCES public.whatsapp_channels(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.whatsapp_group_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  sender_channel_id uuid REFERENCES public.whatsapp_channels(id) ON DELETE SET NULL,
  group_jid text NOT NULL CHECK (group_jid LIKE '%@g.us'),
  group_subject text NOT NULL,
  action text NOT NULL CHECK (action IN ('subject','description','picture','announcement','not_announcement','invite','revoke_invite')),
  value text,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','running','done','failed','cancelled')),
  result text,
  error_message text,
  executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_group_actions_due_idx
  ON public.whatsapp_group_actions(status, scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS whatsapp_group_actions_account_idx
  ON public.whatsapp_group_actions(account_id, created_at DESC);
ALTER TABLE public.whatsapp_group_actions ENABLE ROW LEVEL SECURITY;
