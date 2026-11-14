-- Permit multiple WhatsApp Cloud API numbers per account and persist
-- distinct Evolution instances so inbound and outbound traffic can route
-- through the connection that owns the conversation.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.whatsapp_config'::regclass
      AND conname = 'whatsapp_config_account_id_key'
  ) THEN
    ALTER TABLE public.whatsapp_config DROP CONSTRAINT whatsapp_config_account_id_key;
  ELSE
    DROP INDEX IF EXISTS public.whatsapp_config_account_id_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_config_account_phone_uidx
  ON public.whatsapp_config (account_id, phone_number_id);

CREATE TABLE IF NOT EXISTS public.whatsapp_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('cloud', 'evolution')),
  channel_key text NOT NULL,
  label text NOT NULL DEFAULT 'WhatsApp',
  phone_number_id text,
  evolution_instance_name text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_channels_provider_data_check CHECK (
    (provider = 'cloud' AND phone_number_id IS NOT NULL AND evolution_instance_name IS NULL)
    OR (provider = 'evolution' AND evolution_instance_name IS NOT NULL AND phone_number_id IS NULL)
  ),
  CONSTRAINT whatsapp_channels_account_key_unique UNIQUE (account_id, channel_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_channels_cloud_phone_uidx
  ON public.whatsapp_channels (phone_number_id) WHERE provider = 'cloud';
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_channels_evolution_instance_uidx
  ON public.whatsapp_channels (evolution_instance_name) WHERE provider = 'evolution';
CREATE INDEX IF NOT EXISTS whatsapp_channels_account_idx
  ON public.whatsapp_channels (account_id, provider);

ALTER TABLE public.whatsapp_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whatsapp_channels_select ON public.whatsapp_channels;
DROP POLICY IF EXISTS whatsapp_channels_insert ON public.whatsapp_channels;
DROP POLICY IF EXISTS whatsapp_channels_update ON public.whatsapp_channels;
DROP POLICY IF EXISTS whatsapp_channels_delete ON public.whatsapp_channels;
CREATE POLICY whatsapp_channels_select ON public.whatsapp_channels
  FOR SELECT USING (public.is_account_member(account_id));
CREATE POLICY whatsapp_channels_insert ON public.whatsapp_channels
  FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY whatsapp_channels_update ON public.whatsapp_channels
  FOR UPDATE USING (public.is_account_member(account_id, 'admin'));
CREATE POLICY whatsapp_channels_delete ON public.whatsapp_channels
  FOR DELETE USING (public.is_account_member(account_id, 'admin'));

INSERT INTO public.whatsapp_channels (
  account_id, provider, channel_key, label, phone_number_id, created_by
)
SELECT wc.account_id, 'cloud', 'whatsapp_cloud', 'WhatsApp Cloud API', wc.phone_number_id, wc.user_id
FROM public.whatsapp_config wc
ON CONFLICT (account_id, channel_key) DO UPDATE
SET phone_number_id = EXCLUDED.phone_number_id;

INSERT INTO public.whatsapp_channels (
  account_id, provider, channel_key, label, evolution_instance_name
)
SELECT a.id, 'evolution', 'whatsapp_evolution', 'WhatsApp Evolution',
  'organizap' || replace(a.id::text, '-', '')
FROM public.accounts a
ON CONFLICT (account_id, channel_key) DO NOTHING;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS whatsapp_channel_key text;
COMMENT ON COLUMN public.conversations.whatsapp_channel_key IS
  'WhatsApp connection key used by this thread for inbound and outbound routing.';
