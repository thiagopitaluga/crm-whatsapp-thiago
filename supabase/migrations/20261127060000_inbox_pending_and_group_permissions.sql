BEGIN;
ALTER TABLE public.whatsapp_groups ADD COLUMN IF NOT EXISTS announcement boolean;

-- Count inbound messages after the last successful reply, including read messages.
CREATE OR REPLACE FUNCTION public.inbox_unanswered_counts(p_account uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT jsonb_build_object(
 'whatsapp', (
   SELECT count(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id
   WHERE c.account_id=p_account AND m.sender_type='customer'
   AND m.created_at > coalesce((SELECT max(o.created_at) FROM messages o
     WHERE o.conversation_id=c.id AND o.sender_type IN ('agent','bot')
     AND o.status IN ('sent','delivered','read')), '-infinity'::timestamptz)
 ),
 'instagram', (
   SELECT count(*) FROM instagram_messages m
   WHERE m.account_id=p_account AND m.direction='inbound'
   AND m.created_at > coalesce((SELECT max(o.created_at) FROM instagram_messages o
     WHERE o.conversation_id=m.conversation_id AND o.account_id=p_account
     AND o.direction='outbound'), '-infinity'::timestamptz)
 )
);
$$;
REVOKE ALL ON FUNCTION public.inbox_unanswered_counts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inbox_unanswered_counts(uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
