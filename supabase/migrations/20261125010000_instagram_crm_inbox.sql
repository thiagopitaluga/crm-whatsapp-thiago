BEGIN;
ALTER TABLE public.instagram_channels
 ADD COLUMN IF NOT EXISTS lead_pipeline_id uuid REFERENCES public.pipelines(id) ON DELETE SET NULL,
 ADD COLUMN IF NOT EXISTS lead_stage_id uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL;
ALTER TABLE public.instagram_conversations
 ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL,
 ADD COLUMN IF NOT EXISTS assigned_agent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 ADD COLUMN IF NOT EXISTS read_at timestamptz,
 ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Row locking makes contact/lead creation idempotent across webhook and UI reads.
CREATE OR REPLACE FUNCTION public.instagram_ensure_lead(p_account uuid, p_conversation uuid, p_route boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c record; ch record; owner_id uuid; contact uuid; deal uuid; label text;
BEGIN
 SELECT * INTO c FROM instagram_conversations WHERE id=p_conversation AND account_id=p_account FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO ch FROM instagram_channels WHERE id=c.channel_id AND account_id=p_account;
 SELECT owner_user_id INTO owner_id FROM accounts WHERE id=p_account;
 label := coalesce(nullif(c.profile_data->>'name',''),nullif(c.profile_data->>'displayName',''),nullif(c.profile_data->>'username',''),'Contato Instagram');
 contact := c.contact_id;
 IF contact IS NULL THEN
  INSERT INTO contacts(account_id,user_id,phone,name,avatar_url) VALUES(p_account,owner_id,'',label,coalesce(c.profile_data->>'profile_pic',c.profile_data->>'profilePictureUrl')) RETURNING id INTO contact;
  UPDATE instagram_conversations SET contact_id=contact WHERE id=c.id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM contacts WHERE id=contact AND account_id=p_account) THEN RAISE EXCEPTION 'Contato fora da conta'; END IF;
 IF p_route AND c.deal_id IS NULL AND ch.lead_pipeline_id IS NOT NULL AND ch.lead_stage_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM pipelines p JOIN pipeline_stages s ON s.pipeline_id=p.id WHERE p.id=ch.lead_pipeline_id AND p.account_id=p_account AND s.id=ch.lead_stage_id) THEN
  SELECT id INTO deal FROM deals WHERE account_id=p_account AND contact_id=contact AND pipeline_id=ch.lead_pipeline_id AND status='open' ORDER BY created_at LIMIT 1;
  IF deal IS NULL THEN
   INSERT INTO deals(account_id,user_id,contact_id,pipeline_id,stage_id,title,value,currency,status)
   VALUES(p_account,owner_id,contact,ch.lead_pipeline_id,ch.lead_stage_id,label,0,'BRL','open') RETURNING id INTO deal;
  END IF;
  UPDATE instagram_conversations SET deal_id=deal WHERE id=c.id;
 END IF;
 RETURN contact;
END $$;
REVOKE ALL ON FUNCTION public.instagram_ensure_lead(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_ensure_lead(uuid,uuid,boolean) TO service_role;
CREATE INDEX IF NOT EXISTS instagram_messages_inbox_idx ON public.instagram_messages(conversation_id,created_at DESC);
CREATE OR REPLACE FUNCTION public.instagram_inbox_rows(p_account uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(row ORDER BY last_message_at DESC),'[]'::jsonb) FROM (
  SELECT to_jsonb(c)||jsonb_build_object('contact',to_jsonb(ct),'channel_username',ch.username,'last_message_text',m.body,'unread_count',u.total,'tags',coalesce(c.tags,'[]'::jsonb)||(SELECT coalesce(jsonb_agg(t.name),'[]'::jsonb) FROM contact_tags x JOIN tags t ON t.id=x.tag_id WHERE x.contact_id=ct.id)) AS row,c.last_message_at
  FROM instagram_conversations c JOIN instagram_channels ch ON ch.id=c.channel_id
  LEFT JOIN contacts ct ON ct.id=c.contact_id AND ct.account_id=c.account_id
  LEFT JOIN LATERAL(SELECT body FROM instagram_messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1)m ON true
  LEFT JOIN LATERAL(SELECT count(*) AS total FROM instagram_messages WHERE conversation_id=c.id AND direction='inbound' AND created_at>coalesce(c.read_at,'-infinity'::timestamptz))u ON true
  WHERE c.account_id=p_account ORDER BY c.last_message_at DESC LIMIT 200
 )items;
$$;
REVOKE ALL ON FUNCTION public.instagram_inbox_rows(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_inbox_rows(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
