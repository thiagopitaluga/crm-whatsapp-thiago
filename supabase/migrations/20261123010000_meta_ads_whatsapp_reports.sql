BEGIN;

CREATE TABLE IF NOT EXISTS public.meta_ads_whatsapp_report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.meta_ad_account_integrations(id) ON DELETE CASCADE,
  sender_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  sender_channel_id uuid NOT NULL REFERENCES public.whatsapp_channels(id) ON DELETE RESTRICT,
  target_group_jid text NOT NULL CHECK (target_group_jid ~ '^[^[:space:]@]{1,80}@g\.us$'),
  target_group_name text NOT NULL DEFAULT '',
  recipient_name text NOT NULL DEFAULT 'Cliente' CHECK (char_length(recipient_name) BETWEEN 1 AND 80),
  frequency text NOT NULL CHECK (frequency IN ('weekly', 'monthly')),
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  send_hour smallint NOT NULL DEFAULT 8 CHECK (send_hour BETWEEN 0 AND 23),
  starts_at timestamptz NOT NULL DEFAULT now(),
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, integration_id, frequency, target_group_jid)
);

CREATE INDEX IF NOT EXISTS meta_ads_whatsapp_report_schedules_due_idx
  ON public.meta_ads_whatsapp_report_schedules(enabled, starts_at, frequency);

CREATE TABLE IF NOT EXISTS public.meta_ads_whatsapp_report_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.meta_ads_whatsapp_report_schedules(id) ON DELETE CASCADE,
  period_key text NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  comparison_from date NOT NULL,
  comparison_to date NOT NULL,
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed', 'uncertain')),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  message_text text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metrics) = 'object'),
  whatsapp_message_id text,
  error_message text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, period_key)
);

CREATE INDEX IF NOT EXISTS meta_ads_whatsapp_report_deliveries_schedule_idx
  ON public.meta_ads_whatsapp_report_deliveries(schedule_id, created_at DESC);

ALTER TABLE public.meta_ads_whatsapp_report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ads_whatsapp_report_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_ads_whatsapp_report_schedules,
  public.meta_ads_whatsapp_report_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.meta_ads_whatsapp_report_schedules,
  public.meta_ads_whatsapp_report_deliveries TO service_role;

COMMENT ON TABLE public.meta_ads_whatsapp_report_schedules IS
  'Server-managed weekly and monthly Meta Ads reports delivered to WhatsApp groups.';
COMMENT ON TABLE public.meta_ads_whatsapp_report_deliveries IS
  'Idempotent delivery ledger. Uncertain sends are never retried automatically.';

NOTIFY pgrst, 'reload schema';
COMMIT;
