ALTER TABLE public.pipeline_stages ADD COLUMN IF NOT EXISTS settings JSONB;

CREATE TABLE public.stage_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
  source_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('rule','email','meta','ai')),
  payload JSONB NOT NULL,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','skipped')),
  error TEXT
);
CREATE UNIQUE INDEX stage_jobs_source_unique ON public.stage_jobs
  (source_id,deal_id,kind,(COALESCE(payload->>'id',payload->>'silentTarget','')));
ALTER TABLE public.stage_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY stage_jobs_read ON public.stage_jobs FOR SELECT TO authenticated
  USING (public.is_account_member(account_id, 'admin'));
REVOKE ALL ON public.stage_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.stage_jobs TO authenticated;
GRANT ALL ON public.stage_jobs TO service_role;
CREATE INDEX stage_jobs_due ON public.stage_jobs(run_at) WHERE status = 'pending';

-- Queue in the same transaction as the movement. Covers drag, bulk edits,
-- integrations and AI alike; never perform network calls in a DB trigger.
CREATE FUNCTION public.queue_stage_entry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE config JSONB; rule JSONB; target RECORD;
BEGIN
  SELECT settings INTO config FROM public.pipeline_stages WHERE id = NEW.to_stage_id;
  FOR target IN SELECT s.id,s.settings FROM public.pipeline_stages s
    JOIN public.pipeline_stages current_stage ON current_stage.id = NEW.to_stage_id
    WHERE s.pipeline_id = NEW.pipeline_id AND s.position > current_stage.position
      AND s.settings->'ai'->>'enabled' = 'true' AND s.settings->'ai'->>'condition' = 'silent'
  LOOP
    INSERT INTO public.stage_jobs(account_id,deal_id,stage_id,source_id,kind,payload,run_at)
    VALUES(NEW.account_id,NEW.deal_id,NEW.to_stage_id,NEW.id,'ai',jsonb_build_object('silentTarget',target.id),
      now() + make_interval(days => (target.settings->'ai'->>'days')::int));
  END LOOP;
  IF config IS NULL THEN RETURN NEW; END IF;
  FOR rule IN SELECT value FROM jsonb_array_elements(COALESCE(config->'rules', '[]'::jsonb)) LOOP
    IF rule->>'enabled' = 'true' THEN
      INSERT INTO public.stage_jobs(account_id,deal_id,stage_id,source_id,kind,payload,run_at)
      VALUES(NEW.account_id,NEW.deal_id,NEW.to_stage_id,NEW.id,'rule',rule,
        now() + CASE WHEN rule->>'event' = 'no_reply' THEN make_interval(hours => (rule->>'hours')::int) ELSE interval '0' END);
    END IF;
  END LOOP;
  IF COALESCE(config->'email'->>'recipients','') <> '' THEN
    INSERT INTO public.stage_jobs(account_id,deal_id,stage_id,source_id,kind,payload)
    VALUES(NEW.account_id,NEW.deal_id,NEW.to_stage_id,NEW.id,'email',config->'email');
  END IF;
  IF COALESCE(config->>'metaEvent','') <> '' THEN
    INSERT INTO public.stage_jobs(account_id,deal_id,stage_id,source_id,kind,payload)
    VALUES(NEW.account_id,NEW.deal_id,NEW.to_stage_id,NEW.id,'meta',jsonb_build_object('event',config->>'metaEvent'));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.queue_stage_entry() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER queue_stage_entry AFTER INSERT ON public.deal_stage_events FOR EACH ROW EXECUTE FUNCTION public.queue_stage_entry();

-- Both QR and Cloud API write inbound messages here.
CREATE FUNCTION public.queue_stage_ai() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.sender_type <> 'customer' OR COALESCE(NEW.content_text,'') = '' THEN RETURN NEW; END IF;
  INSERT INTO public.stage_jobs(account_id,deal_id,stage_id,source_id,kind,payload)
  SELECT d.account_id,d.id,d.stage_id,NEW.id,'ai',jsonb_build_object('conversationId',NEW.conversation_id)
  FROM public.conversations c JOIN public.deals d ON d.contact_id = c.contact_id AND d.account_id = c.account_id
  WHERE c.id = NEW.conversation_id AND d.status = 'open'
    AND EXISTS (SELECT 1 FROM public.pipeline_stages s WHERE s.pipeline_id = d.pipeline_id AND s.settings->'ai'->>'enabled' = 'true');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.queue_stage_ai() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER queue_stage_ai AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.queue_stage_ai();

CREATE TABLE public.stage_integrations (
 account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
 pixel_id TEXT NOT NULL,
 access_token_encrypted TEXT NOT NULL
);
ALTER TABLE public.stage_integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stage_integrations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.stage_integrations TO service_role;
NOTIFY pgrst, 'reload schema';

CREATE FUNCTION public.guard_stage_settings() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE tenant UUID;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.settings IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.settings IS NOT DISTINCT FROM OLD.settings THEN RETURN NEW; END IF;
  IF auth.uid() IS NOT NULL THEN
    SELECT account_id INTO tenant FROM public.pipelines WHERE id = NEW.pipeline_id;
    IF NOT public.is_account_member(tenant,'admin') THEN RAISE EXCEPTION 'Admin required'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_stage_settings() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_stage_settings BEFORE INSERT OR UPDATE ON public.pipeline_stages FOR EACH ROW EXECUTE FUNCTION public.guard_stage_settings();
