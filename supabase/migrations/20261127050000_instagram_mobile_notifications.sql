BEGIN;

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS action_url text;

CREATE OR REPLACE FUNCTION public.notify_instagram_incoming_mobile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.instagram_conversations%ROWTYPE;
BEGIN
  IF NEW.direction <> 'inbound' THEN RETURN NEW; END IF;
  SELECT * INTO c FROM public.instagram_conversations WHERE id = NEW.conversation_id;
  IF NOT FOUND OR c.account_id <> NEW.account_id THEN RETURN NEW; END IF;

  INSERT INTO public.notifications
    (account_id, user_id, type, contact_id, title, body, source_key, action_url)
  SELECT c.account_id, p.user_id, 'new_message', c.contact_id,
    'Nova mensagem no Instagram', 'Um contato enviou uma mensagem no Direct.',
    NEW.id::text || ':' || p.user_id::text,
    '/inbox?source=instagram&c=' || c.id::text || '&channel=instagram'
  FROM public.notification_preferences p
  WHERE p.account_id = c.account_id
    AND EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.user_id = p.user_id AND pr.account_id = c.account_id
    )
    AND p.settings->>'messages' = 'true'
    AND (p.settings->>'allMessages' = 'true' OR c.assigned_agent_id = p.user_id)
  ON CONFLICT (source_key) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS notify_instagram_incoming_mobile ON public.instagram_messages;
CREATE TRIGGER notify_instagram_incoming_mobile
AFTER INSERT ON public.instagram_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_instagram_incoming_mobile();
REVOKE ALL ON FUNCTION public.notify_instagram_incoming_mobile() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
