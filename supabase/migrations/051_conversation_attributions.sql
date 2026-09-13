-- Persist external conversation acquisition data independently from contacts
-- and messages.  The composite FK makes it impossible to attach an
-- attribution to a conversation/contact from another tenant.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversations_account_conversation_contact_key'
      AND conrelid = 'public.conversations'::regclass
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_account_conversation_contact_key
      UNIQUE (account_id, id, contact_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.conversation_attributions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  contact_id UUID NOT NULL,
  provider TEXT NOT NULL DEFAULT 'meta' CHECK (provider = 'meta'),
  attribution_type TEXT NOT NULL DEFAULT 'click_to_whatsapp'
    CHECK (attribution_type = 'click_to_whatsapp'),
  first_message_id TEXT,
  source_url TEXT,
  source_type TEXT,
  source_id TEXT,
  ctwa_clid TEXT,
  headline TEXT,
  body TEXT,
  media_type TEXT,
  image_url TEXT,
  video_url TEXT,
  thumbnail_url TEXT,
  referral_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(referral_metadata) = 'object'),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT conversation_attributions_conversation_contact_fkey
    FOREIGN KEY (account_id, conversation_id, contact_id)
    REFERENCES public.conversations(account_id, id, contact_id)
    ON DELETE CASCADE,
  CONSTRAINT conversation_attributions_one_provider_per_conversation
    UNIQUE (account_id, conversation_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_conversation_attributions_account_contact
  ON public.conversation_attributions(account_id, contact_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_attributions_account_ctwa_clid
  ON public.conversation_attributions(account_id, ctwa_clid)
  WHERE ctwa_clid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversation_attributions_account_source_id
  ON public.conversation_attributions(account_id, source_id)
  WHERE source_id IS NOT NULL;

ALTER TABLE public.conversation_attributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_attributions_select ON public.conversation_attributions;
DROP POLICY IF EXISTS conversation_attributions_insert ON public.conversation_attributions;
DROP POLICY IF EXISTS conversation_attributions_update ON public.conversation_attributions;
DROP POLICY IF EXISTS conversation_attributions_delete ON public.conversation_attributions;

CREATE POLICY conversation_attributions_select
  ON public.conversation_attributions FOR SELECT
  USING (public.is_account_member(account_id));
CREATE POLICY conversation_attributions_insert
  ON public.conversation_attributions FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY conversation_attributions_update
  ON public.conversation_attributions FOR UPDATE
  USING (public.is_account_member(account_id, 'agent'));
CREATE POLICY conversation_attributions_delete
  ON public.conversation_attributions FOR DELETE
  USING (public.is_account_member(account_id, 'agent'));
