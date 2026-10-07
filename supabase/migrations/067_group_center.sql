-- Group broadcast controls, reusable audiences and private group activity.
ALTER TABLE public.whatsapp_groups
  ADD COLUMN IF NOT EXISTS folder TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS labels TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;

ALTER TABLE public.group_broadcasts
  ADD COLUMN IF NOT EXISTS content_kind TEXT NOT NULL DEFAULT 'text'
    CHECK (content_kind IN ('text', 'image', 'video', 'audio', 'document', 'poll')),
  ADD COLUMN IF NOT EXISTS media_url TEXT,
  ADD COLUMN IF NOT EXISTS media_name TEXT,
  ADD COLUMN IF NOT EXISTS poll_options JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(poll_options) = 'array'),
  ADD COLUMN IF NOT EXISTS recurrence TEXT NOT NULL DEFAULT 'none'
    CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly')),
  ADD COLUMN IF NOT EXISTS series_id UUID,
  ADD COLUMN IF NOT EXISTS occurrence_no INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS send_interval_ms INTEGER NOT NULL DEFAULT 1500
    CHECK (send_interval_ms BETWEEN 1250 AND 10000);
ALTER TABLE public.group_broadcasts
  ADD COLUMN IF NOT EXISTS retry_of UUID REFERENCES public.group_broadcasts(id) ON DELETE SET NULL;
ALTER TABLE public.group_broadcasts DROP CONSTRAINT IF EXISTS group_broadcasts_message_text_check;
ALTER TABLE public.group_broadcasts ADD CONSTRAINT group_broadcasts_message_text_check
  CHECK (char_length(message_text) <= 4096 AND (content_kind NOT IN ('text', 'poll') OR char_length(trim(message_text)) > 0));

CREATE UNIQUE INDEX IF NOT EXISTS group_broadcast_series_occurrence_idx
  ON public.group_broadcasts(account_id, series_id, occurrence_no)
  WHERE series_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS group_broadcast_retry_once_idx
  ON public.group_broadcasts(account_id, retry_of) WHERE retry_of IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.group_delivery_settings (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  daily_group_cap INTEGER NOT NULL DEFAULT 100 CHECK (daily_group_cap BETWEEN 1 AND 300),
  min_interval_ms INTEGER NOT NULL DEFAULT 1500 CHECK (min_interval_ms BETWEEN 1250 AND 10000),
  pause_on_error BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.group_broadcast_targets
  DROP CONSTRAINT IF EXISTS group_broadcast_targets_status_check;
ALTER TABLE public.group_broadcast_targets
  ADD CONSTRAINT group_broadcast_targets_status_check
  CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'uncertain'));
ALTER TABLE public.group_broadcast_targets
  ADD COLUMN IF NOT EXISTS attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.group_audiences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  group_jids TEXT[] NOT NULL DEFAULT '{}'::text[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, name)
);

CREATE TABLE IF NOT EXISTS public.group_message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  message_text TEXT NOT NULL CHECK (char_length(trim(message_text)) BETWEEN 1 AND 4096),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, name)
);

CREATE TABLE IF NOT EXISTS public.group_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  group_jid TEXT NOT NULL CHECK (group_jid LIKE '%@g.us'),
  message_id TEXT NOT NULL,
  participant_jid TEXT,
  participant_name TEXT,
  from_me BOOLEAN NOT NULL DEFAULT false,
  message_type TEXT NOT NULL DEFAULT 'text',
  content_text TEXT NOT NULL DEFAULT '',
  reply_to_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, group_jid, message_id)
);
CREATE INDEX IF NOT EXISTS group_messages_recent_idx
  ON public.group_messages(account_id, group_jid, created_at DESC);

CREATE TABLE IF NOT EXISTS public.group_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  group_jid TEXT NOT NULL CHECK (group_jid LIKE '%@g.us'),
  period TEXT NOT NULL CHECK (period IN ('daily', 'weekly')),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  summary TEXT NOT NULL,
  opportunities JSONB NOT NULL DEFAULT '[]'::jsonb,
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  suggested_tasks JSONB NOT NULL DEFAULT '[]'::jsonb,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, group_jid, period, period_start)
);
CREATE INDEX IF NOT EXISTS group_insights_recent_idx
  ON public.group_insights(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.group_action_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  group_jid TEXT NOT NULL CHECK (group_jid LIKE '%@g.us'),
  title TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 200),
  description TEXT,
  due_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
  source_insight_id UUID REFERENCES public.group_insights(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.group_audiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_delivery_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_action_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY group_audiences_read ON public.group_audiences FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
CREATE POLICY group_audiences_write ON public.group_audiences FOR ALL TO authenticated
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY group_delivery_settings_read ON public.group_delivery_settings FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
CREATE POLICY group_delivery_settings_write ON public.group_delivery_settings FOR ALL TO authenticated
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY group_message_templates_read ON public.group_message_templates FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
CREATE POLICY group_message_templates_write ON public.group_message_templates FOR ALL TO authenticated
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY group_messages_read ON public.group_messages FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
CREATE POLICY group_insights_read ON public.group_insights FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
CREATE POLICY group_action_items_read ON public.group_action_items FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
CREATE POLICY group_action_items_write ON public.group_action_items FOR ALL TO authenticated
  USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));

DO $$ BEGIN
  IF to_regclass('public.notifications') IS NOT NULL THEN
    ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
      CHECK (type IN ('conversation_assigned', 'group_broadcast'));
  END IF;
END $$;

-- Atomic edit while the scheduler races to claim the same campaign.
CREATE OR REPLACE FUNCTION public.update_scheduled_group_broadcast_v2(
  p_account_id uuid, p_broadcast_id uuid, p_name text, p_message_text text,
  p_scheduled_at timestamptz, p_groups jsonb, p_content_kind text,
  p_media_url text, p_media_name text, p_poll_options jsonb, p_recurrence text
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'Insufficient role' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 120
    OR p_message_text IS NULL OR length(btrim(p_message_text)) > 4096
    OR p_scheduled_at IS NULL OR p_scheduled_at < now() + interval '1 minute'
    OR p_groups IS NULL OR jsonb_typeof(p_groups) <> 'array'
    OR jsonb_array_length(p_groups) NOT BETWEEN 1 AND 30
    OR p_content_kind NOT IN ('text', 'image', 'video', 'audio', 'document', 'poll')
    OR p_recurrence NOT IN ('none', 'daily', 'weekly', 'monthly')
    OR p_poll_options IS NULL OR jsonb_typeof(p_poll_options) <> 'array' THEN
    RAISE EXCEPTION 'Invalid scheduled group broadcast' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_groups) AS item
    WHERE item->>'group_jid' !~ '^[^@[:space:]]+@g[.]us$'
      OR length(coalesce(item->>'group_subject', '')) NOT BETWEEN 1 AND 255
  ) THEN RAISE EXCEPTION 'Invalid target group' USING ERRCODE = '22023'; END IF;

  SELECT id INTO v_id FROM public.group_broadcasts
  WHERE id = p_broadcast_id AND account_id = p_account_id AND status = 'scheduled'
  FOR UPDATE;
  IF v_id IS NULL THEN RETURN false; END IF;

  UPDATE public.group_broadcasts SET
    name = btrim(p_name), message_text = btrim(p_message_text),
    scheduled_at = p_scheduled_at, total_groups = jsonb_array_length(p_groups),
    content_kind = p_content_kind, media_url = p_media_url, media_name = p_media_name,
    poll_options = p_poll_options, recurrence = p_recurrence
    ,series_id = CASE WHEN p_recurrence = 'none' THEN NULL ELSE coalesce(series_id, gen_random_uuid()) END
  WHERE id = v_id;
  DELETE FROM public.group_broadcast_targets WHERE broadcast_id = v_id;
  INSERT INTO public.group_broadcast_targets(broadcast_id, account_id, group_jid, group_subject)
    SELECT v_id, p_account_id, item->>'group_jid', item->>'group_subject'
    FROM jsonb_array_elements(p_groups) AS item;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.update_scheduled_group_broadcast_v2(
  uuid, uuid, text, text, timestamptz, jsonb, text, text, text, jsonb, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_scheduled_group_broadcast_v2(
  uuid, uuid, text, text, timestamptz, jsonb, text, text, text, jsonb, text
) TO authenticated;

