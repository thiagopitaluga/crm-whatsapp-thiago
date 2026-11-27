-- Scheduled, account-scoped one-to-one Evolution campaigns. Kept separate
-- from Meta template broadcasts so delivery receipts and quotas do not mix.
CREATE TABLE IF NOT EXISTS public.evolution_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  name text NOT NULL,
  message_variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  audience_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivery_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  on_sent jsonb NOT NULL DEFAULT '{}'::jsonb,
  on_reply jsonb NOT NULL DEFAULT '{}'::jsonb,
  sender_channel_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','scheduled','sending','paused','completed','partial','failed')),
  scheduled_at timestamptz,
  next_run_at timestamptz,
  locked_at timestamptz,
  total_recipients integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evolution_campaigns_id_account_unique UNIQUE (id, account_id)
);

CREATE TABLE IF NOT EXISTS public.evolution_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  account_id uuid NOT NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  phone text NOT NULL,
  contact_name text,
  sequence_no integer NOT NULL,
  message_variant_index integer,
  sender_channel_id uuid REFERENCES public.whatsapp_channels(id) ON DELETE SET NULL,
  provider_message_id text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sending','sent','failed','uncertain')),
  attempted_at timestamptz,
  sent_at timestamptz,
  replied_at timestamptz,
  on_sent_applied_at timestamptz,
  on_reply_applied_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evolution_campaign_recipients_campaign_fk
    FOREIGN KEY (campaign_id, account_id)
    REFERENCES public.evolution_campaigns (id, account_id) ON DELETE CASCADE,
  CONSTRAINT evolution_campaign_recipients_unique_phone UNIQUE (campaign_id, phone),
  CONSTRAINT evolution_campaign_recipients_unique_sequence UNIQUE (campaign_id, sequence_no)
);

CREATE INDEX IF NOT EXISTS evolution_campaigns_due_idx
  ON public.evolution_campaigns (next_run_at)
  WHERE status IN ('scheduled','sending');
CREATE INDEX IF NOT EXISTS evolution_campaign_recipients_pending_idx
  ON public.evolution_campaign_recipients (campaign_id, sequence_no)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS evolution_campaign_recipients_reply_idx
  ON public.evolution_campaign_recipients (account_id, phone, sent_at DESC)
  WHERE status = 'sent' AND replied_at IS NULL;

ALTER TABLE public.evolution_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolution_campaign_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY evolution_campaigns_select ON public.evolution_campaigns
  FOR SELECT USING (public.is_account_member(account_id));
CREATE POLICY evolution_campaign_recipients_select ON public.evolution_campaign_recipients
  FOR SELECT USING (public.is_account_member(account_id));
-- Writes use authenticated API routes after input validation. Service-role
-- workers own status transitions; browser clients cannot forge deliveries.

DROP TRIGGER IF EXISTS evolution_campaigns_updated_at ON public.evolution_campaigns;
CREATE TRIGGER evolution_campaigns_updated_at
  BEFORE UPDATE ON public.evolution_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
