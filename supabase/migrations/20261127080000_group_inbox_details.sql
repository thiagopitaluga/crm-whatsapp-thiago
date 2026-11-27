ALTER TABLE public.whatsapp_groups
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_message_preview text,
  ADD COLUMN IF NOT EXISTS last_message_from_me boolean;

ALTER TABLE public.group_messages
  ADD COLUMN IF NOT EXISTS media_url text;

UPDATE public.whatsapp_groups AS g
SET last_message_at = m.created_at,
    last_message_preview = left(coalesce(nullif(m.content_text, ''), '[' || m.message_type || ']'), 300),
    last_message_from_me = m.from_me
FROM (
  SELECT DISTINCT ON (account_id, group_jid)
    account_id, group_jid, created_at, content_text, message_type, from_me
  FROM public.group_messages
  ORDER BY account_id, group_jid, created_at DESC, id DESC
) AS m
WHERE g.account_id = m.account_id AND g.group_jid = m.group_jid
  AND (g.last_message_at IS NULL OR g.last_message_at <= m.created_at);

CREATE OR REPLACE FUNCTION public.update_group_inbox_preview()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.whatsapp_groups AS g
  SET last_message_at = NEW.created_at,
      last_message_preview = left(coalesce(nullif(NEW.content_text, ''), '[' || NEW.message_type || ']'), 300),
      last_message_from_me = NEW.from_me
  WHERE g.account_id = NEW.account_id
    AND g.group_jid = NEW.group_jid
    AND (g.last_message_at IS NULL OR g.last_message_at <= NEW.created_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS group_message_inbox_preview ON public.group_messages;
CREATE TRIGGER group_message_inbox_preview
  AFTER INSERT ON public.group_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_group_inbox_preview();

CREATE INDEX IF NOT EXISTS whatsapp_groups_account_archived_recent_idx
  ON public.whatsapp_groups(account_id, archived_at, last_message_at DESC);
