-- Keep the inbox bounded per conversation. The newest 200 messages remain
-- available; deleted rows are intentionally not recoverable from the CRM.

CREATE OR REPLACE FUNCTION public.prune_conversation_message_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.messages
  WHERE id IN (
    SELECT id
    FROM public.messages
    WHERE conversation_id = NEW.conversation_id
    ORDER BY created_at DESC, id DESC
    OFFSET 200
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_prune_history_after_insert ON public.messages;

CREATE TRIGGER messages_prune_history_after_insert
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.prune_conversation_message_history();

-- Apply the same 200-message cap to existing conversations once.
WITH ranked_messages AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY conversation_id
      ORDER BY created_at DESC, id DESC
  ) AS position
  FROM public.messages
)
DELETE FROM public.messages AS message
USING ranked_messages
WHERE message.id = ranked_messages.id
  AND ranked_messages.position > 200;
