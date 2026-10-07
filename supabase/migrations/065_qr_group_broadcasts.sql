-- QR-linked WhatsApp group directory and scheduled group broadcasts.
--
-- This is intentionally separate from Meta template broadcasts: groups are
-- reached through the account-owned QR connector, and their messages never
-- create CRM contacts or inbox conversations.

CREATE TABLE IF NOT EXISTS public.whatsapp_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  group_jid TEXT NOT NULL CHECK (group_jid LIKE '%@g.us'),
  subject TEXT NOT NULL,
  participant_count INTEGER NOT NULL DEFAULT 0 CHECK (participant_count >= 0),
  is_admin BOOLEAN NOT NULL DEFAULT false,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, group_jid)
);

CREATE INDEX IF NOT EXISTS whatsapp_groups_account_seen_idx
  ON public.whatsapp_groups(account_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS public.group_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  message_text TEXT NOT NULL CHECK (char_length(trim(message_text)) BETWEEN 1 AND 4096),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'partial', 'failed', 'cancelled')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  total_groups INTEGER NOT NULL DEFAULT 0 CHECK (total_groups >= 0),
  sent_count INTEGER NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  delivery_locked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS group_broadcasts_due_idx
  ON public.group_broadcasts(status, scheduled_at)
  WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS group_broadcasts_account_created_idx
  ON public.group_broadcasts(account_id, created_at DESC);

-- Targets must belong to the same account as their broadcast, even when an
-- administrator manages more than one company.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'group_broadcasts_id_account_unique'
  ) THEN
    ALTER TABLE public.group_broadcasts
      ADD CONSTRAINT group_broadcasts_id_account_unique UNIQUE (id, account_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.group_broadcast_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID NOT NULL REFERENCES public.group_broadcasts(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  group_jid TEXT NOT NULL CHECK (group_jid LIKE '%@g.us'),
  group_subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  message_id TEXT,
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(broadcast_id, group_jid)
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'group_broadcast_targets_broadcast_account_fkey'
  ) THEN
    ALTER TABLE public.group_broadcast_targets
      ADD CONSTRAINT group_broadcast_targets_broadcast_account_fkey
      FOREIGN KEY (broadcast_id, account_id)
      REFERENCES public.group_broadcasts (id, account_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS group_broadcast_targets_broadcast_idx
  ON public.group_broadcast_targets(broadcast_id, status);

ALTER TABLE public.whatsapp_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_broadcast_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_groups_select ON public.whatsapp_groups;
DROP POLICY IF EXISTS whatsapp_groups_write ON public.whatsapp_groups;
CREATE POLICY whatsapp_groups_select ON public.whatsapp_groups FOR SELECT
  TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY whatsapp_groups_write ON public.whatsapp_groups FOR ALL
  TO authenticated
  USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS group_broadcasts_select ON public.group_broadcasts;
DROP POLICY IF EXISTS group_broadcasts_write ON public.group_broadcasts;
CREATE POLICY group_broadcasts_select ON public.group_broadcasts FOR SELECT
  TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY group_broadcasts_write ON public.group_broadcasts FOR ALL
  TO authenticated
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS group_broadcast_targets_select ON public.group_broadcast_targets;
DROP POLICY IF EXISTS group_broadcast_targets_write ON public.group_broadcast_targets;
CREATE POLICY group_broadcast_targets_select ON public.group_broadcast_targets FOR SELECT
  TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY group_broadcast_targets_write ON public.group_broadcast_targets FOR ALL
  TO authenticated
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS whatsapp_groups_set_updated_at ON public.whatsapp_groups;
CREATE TRIGGER whatsapp_groups_set_updated_at BEFORE UPDATE ON public.whatsapp_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS group_broadcasts_set_updated_at ON public.group_broadcasts;
CREATE TRIGGER group_broadcasts_set_updated_at BEFORE UPDATE ON public.group_broadcasts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

