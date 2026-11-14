-- Multi-agent CRM configuration and per-agent trigger/action rules.
CREATE TABLE IF NOT EXISTS public.ai_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Assistente virtual',
  system_prompt text,
  is_active boolean NOT NULL DEFAULT false,
  auto_reply_enabled boolean NOT NULL DEFAULT false,
  auto_reply_max_per_conversation integer NOT NULL DEFAULT 3
    CHECK (auto_reply_max_per_conversation BETWEEN 1 AND 20),
  handoff_agent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  channel_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_agents_account_idx ON public.ai_agents(account_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ai_agents_one_default_idx
  ON public.ai_agents(account_id) WHERE is_default;
ALTER TABLE public.ai_training_examples
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.ai_agents(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS ai_training_examples_agent_status_created_idx
  ON public.ai_training_examples(account_id, agent_id, status, created_at DESC);

ALTER TABLE public.ai_agents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_agents_select ON public.ai_agents;
CREATE POLICY ai_agents_select ON public.ai_agents FOR SELECT
  USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS ai_agents_insert ON public.ai_agents;
CREATE POLICY ai_agents_insert ON public.ai_agents FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS ai_agents_update ON public.ai_agents;
CREATE POLICY ai_agents_update ON public.ai_agents FOR UPDATE
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS ai_agents_delete ON public.ai_agents;
CREATE POLICY ai_agents_delete ON public.ai_agents FOR DELETE
  USING (public.is_account_member(account_id, 'admin'));

-- Preserve each account's existing single agent as its initial default.
INSERT INTO public.ai_agents (
  account_id, name, system_prompt, is_active, auto_reply_enabled,
  auto_reply_max_per_conversation, handoff_agent_id, settings,
  channel_keys, is_default, created_by
)
SELECT c.account_id,
       COALESCE(NULLIF(c.agent_settings->>'name', ''), 'Assistente virtual'),
       c.system_prompt, c.is_active, c.auto_reply_enabled,
       c.auto_reply_max_per_conversation, c.handoff_agent_id,
       COALESCE(c.agent_settings, '{}'::jsonb),
       ARRAY(SELECT jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(c.agent_settings->'enabledChannels') = 'array'
           THEN c.agent_settings->'enabledChannels' ELSE '[]'::jsonb END
       )),
       true, c.created_by
FROM public.ai_configs c
WHERE NOT EXISTS (SELECT 1 FROM public.ai_agents a WHERE a.account_id = c.account_id);

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS ai_agent_id uuid REFERENCES public.ai_agents(id) ON DELETE SET NULL;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS channel text;

UPDATE public.ai_training_examples e
SET agent_id = COALESCE(c.ai_agent_id, a.id)
FROM public.conversations c
JOIN public.ai_agents a ON a.account_id = c.account_id AND a.is_default
WHERE e.conversation_id = c.id AND e.account_id = c.account_id AND e.agent_id IS NULL;

CREATE TABLE IF NOT EXISTS public.ai_agent_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  name text NOT NULL,
  trigger_type text NOT NULL CHECK (trigger_type IN (
    'new_message', 'keyword', 'no_response', 'stage_changed',
    'tag_added', 'custom_instruction', 'order_paid', 'order_shipped'
  )),
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  filters jsonb NOT NULL DEFAULT '[]'::jsonb,
  action_type text NOT NULL CHECK (action_type IN (
    'send_message', 'send_media', 'add_tag', 'remove_tag',
    'notify_user', 'notify_whatsapp', 'assign_conversation',
    'webhook', 'move_stage'
  )),
  action_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT false,
  execution_count bigint NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_agent_triggers_agent_active_idx
  ON public.ai_agent_triggers(account_id, agent_id, is_active);
ALTER TABLE public.ai_agent_triggers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_agent_triggers_select ON public.ai_agent_triggers;
CREATE POLICY ai_agent_triggers_select ON public.ai_agent_triggers FOR SELECT
  USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS ai_agent_triggers_insert ON public.ai_agent_triggers;
CREATE POLICY ai_agent_triggers_insert ON public.ai_agent_triggers FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS ai_agent_triggers_update ON public.ai_agent_triggers;
CREATE POLICY ai_agent_triggers_update ON public.ai_agent_triggers FOR UPDATE
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS ai_agent_triggers_delete ON public.ai_agent_triggers;
CREATE POLICY ai_agent_triggers_delete ON public.ai_agent_triggers FOR DELETE
  USING (public.is_account_member(account_id, 'admin'));

COMMENT ON TABLE public.ai_agents IS 'Multiple independently configured AI agents per account; provider credentials remain account-scoped in ai_configs.';
COMMENT ON TABLE public.ai_agent_triggers IS 'Agent-specific event conditions, AND filters, and automated actions.';

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS ai_agent_id uuid REFERENCES public.ai_agents(id) ON DELETE SET NULL;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS channel text;

CREATE TABLE IF NOT EXISTS public.ai_agent_trigger_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  trigger_id uuid NOT NULL REFERENCES public.ai_agent_triggers(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  anchor_message_id uuid REFERENCES public.messages(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'cancelled', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_agent_trigger_jobs_due_idx
  ON public.ai_agent_trigger_jobs(run_at) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS ai_agent_stage_trigger_once_per_deal_stage_idx
  ON public.ai_agent_trigger_jobs(
    trigger_id,
    (event_context->>'deal_id'),
    (event_context->>'stage_id')
  ) WHERE event_type = 'stage_changed';
ALTER TABLE public.ai_agent_trigger_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_agent_trigger_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_agent_trigger_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.increment_ai_agent_trigger_execution(p_trigger_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.ai_agent_triggers
  SET execution_count = execution_count + 1, updated_at = now()
  WHERE id = p_trigger_id;
$$;
REVOKE ALL ON FUNCTION public.increment_ai_agent_trigger_execution(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_ai_agent_trigger_execution(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.queue_ai_agent_no_response_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_account uuid;
  v_agent uuid;
  v_contact uuid;
  v_hours integer;
  v_trigger record;
BEGIN
  IF NEW.sender_type NOT IN ('agent', 'bot') THEN RETURN NEW; END IF;
  SELECT account_id, ai_agent_id, contact_id INTO v_account, v_agent, v_contact
  FROM public.conversations WHERE id = NEW.conversation_id;
  IF v_agent IS NULL OR v_contact IS NULL THEN RETURN NEW; END IF;
  FOR v_trigger IN
    SELECT id, trigger_config FROM public.ai_agent_triggers
    WHERE account_id = v_account AND agent_id = v_agent
      AND trigger_type = 'no_response' AND is_active = true
  LOOP
    v_hours := GREATEST(1, LEAST(8760, COALESCE((v_trigger.trigger_config->>'hours')::integer, 24)));
    INSERT INTO public.ai_agent_trigger_jobs (
      account_id, trigger_id, agent_id, contact_id, conversation_id,
      anchor_message_id, event_type, run_at
    ) VALUES (
      v_account, v_trigger.id, v_agent, v_contact, NEW.conversation_id,
      NEW.id, 'no_response', NEW.created_at + make_interval(hours => v_hours)
    );
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS queue_ai_agent_no_response ON public.messages;
CREATE TRIGGER queue_ai_agent_no_response
  AFTER INSERT ON public.messages FOR EACH ROW
  EXECUTE FUNCTION public.queue_ai_agent_no_response_trigger();

CREATE OR REPLACE FUNCTION public.queue_ai_agent_stage_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_agent uuid;
  v_contact uuid;
  v_conversation uuid;
  v_trigger record;
BEGIN
  SELECT d.contact_id, d.conversation_id, c.ai_agent_id
    INTO v_contact, v_conversation, v_agent
  FROM public.deals d
  LEFT JOIN public.conversations c ON c.id = d.conversation_id
  WHERE d.id = NEW.deal_id AND d.account_id = NEW.account_id;
  IF v_agent IS NULL OR v_contact IS NULL THEN RETURN NEW; END IF;
  FOR v_trigger IN
    SELECT id, trigger_config FROM public.ai_agent_triggers
    WHERE account_id = NEW.account_id AND agent_id = v_agent
      AND trigger_type = 'stage_changed' AND is_active = true
      AND (COALESCE(trigger_config->>'stage_id', '') = '' OR trigger_config->>'stage_id' = NEW.to_stage_id::text)
  LOOP
    INSERT INTO public.ai_agent_trigger_jobs (
      account_id, trigger_id, agent_id, contact_id, conversation_id,
      event_type, event_context, run_at
    ) VALUES (
      NEW.account_id, v_trigger.id, v_agent, v_contact, v_conversation,
      'stage_changed', jsonb_build_object('stage_id', NEW.to_stage_id, 'deal_id', NEW.deal_id), now()
    ) ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS queue_ai_agent_stage_changed ON public.deal_stage_events;
CREATE TRIGGER queue_ai_agent_stage_changed
  AFTER INSERT ON public.deal_stage_events FOR EACH ROW
  EXECUTE FUNCTION public.queue_ai_agent_stage_trigger();

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'group_broadcast', 'ai_agent_trigger'));
