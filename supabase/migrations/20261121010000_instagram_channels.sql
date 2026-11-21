-- Instagram profiles, conversations, and messages. Access is server-only.
CREATE TABLE IF NOT EXISTS public.instagram_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  instagram_id text NOT NULL UNIQUE,
  username text NOT NULL,
  access_token_encrypted text NOT NULL,
  token_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.instagram_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.instagram_channels(id) ON DELETE CASCADE,
  instagram_user_id text NOT NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(channel_id, instagram_user_id)
);
CREATE TABLE IF NOT EXISTS public.instagram_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.instagram_conversations(id) ON DELETE CASCADE,
  external_id text NOT NULL UNIQUE,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS instagram_conversations_account_idx ON public.instagram_conversations(account_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS instagram_messages_conversation_idx ON public.instagram_messages(conversation_id, created_at);
ALTER TABLE public.instagram_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_messages ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public.instagram_oauth_sessions (
  state_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL
);
ALTER TABLE public.instagram_oauth_sessions ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
