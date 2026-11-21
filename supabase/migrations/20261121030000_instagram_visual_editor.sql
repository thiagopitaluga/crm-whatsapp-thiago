ALTER TABLE public.instagram_automations
  ADD COLUMN IF NOT EXISTS flow_graph jsonb,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.instagram_automations DROP CONSTRAINT IF EXISTS instagram_automations_trigger_type_check;
ALTER TABLE public.instagram_automations ADD CONSTRAINT instagram_automations_trigger_type_check CHECK (trigger_type IN
 ('message_keyword','first_message','comment_keyword','story_reply','story_mention','ad_message','live_comment','share_to_dm','ref_url','conversation_starter','follow_to_dm','default_reply'));
ALTER TABLE public.instagram_automation_runs
 ADD COLUMN IF NOT EXISTS flow_graph jsonb,
 ADD COLUMN IF NOT EXISTS event_context jsonb NOT NULL DEFAULT '{}',
 ADD COLUMN IF NOT EXISTS execution_plan jsonb,
 ADD COLUMN IF NOT EXISTS next_step integer NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS run_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE public.instagram_conversations
 ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]',
 ADD COLUMN IF NOT EXISTS profile_data jsonb NOT NULL DEFAULT '{}',
 ADD COLUMN IF NOT EXISTS first_seen_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN IF NOT EXISTS previous_interaction_at timestamptz,
 ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open';
ALTER TABLE public.instagram_messages ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS instagram_runs_due_idx ON public.instagram_automation_runs(run_at) WHERE status = 'pending';
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
 VALUES ('instagram-flow-media','instagram-flow-media',true,10485760,ARRAY['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
 ON CONFLICT (id) DO NOTHING;
NOTIFY pgrst, 'reload schema';
CREATE OR REPLACE FUNCTION public.instagram_apply_flow_tags(p_account uuid,p_conversation uuid,p_tags text[],p_remove boolean DEFAULT false)
RETURNS void LANGUAGE sql SET search_path = public AS $$
 UPDATE public.instagram_conversations SET tags = (
  SELECT COALESCE(jsonb_agg(DISTINCT tag), '[]'::jsonb) FROM (
   SELECT jsonb_array_elements_text(tags) AS tag
   UNION ALL SELECT unnest(CASE WHEN p_remove THEN ARRAY[]::text[] ELSE p_tags END)
  ) t WHERE NOT p_remove OR NOT (tag = ANY(p_tags))
 ) WHERE id=p_conversation AND account_id=p_account;
$$;
REVOKE ALL ON FUNCTION public.instagram_apply_flow_tags(uuid,uuid,text[],boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_apply_flow_tags(uuid,uuid,text[],boolean) TO service_role;
