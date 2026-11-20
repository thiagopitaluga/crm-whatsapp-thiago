BEGIN;
CREATE OR REPLACE FUNCTION public.queue_stage_entry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE config jsonb; rule jsonb; target record;
BEGIN
 SELECT settings INTO config FROM pipeline_stages WHERE id=NEW.to_stage_id;
 FOR target IN SELECT s.id,s.settings FROM pipeline_stages s JOIN pipeline_stages c ON c.id=NEW.to_stage_id WHERE s.pipeline_id=NEW.pipeline_id AND s.position>c.position AND s.settings->'ai'->>'enabled'='true' AND s.settings->'ai'->>'condition'='silent' LOOP
  INSERT INTO stage_jobs(account_id,deal_id,stage_id,source_id,kind,payload,run_at) VALUES(NEW.account_id,NEW.deal_id,NEW.to_stage_id,NEW.id,'ai',jsonb_build_object('silentTarget',target.id),now()+make_interval(days=>(target.settings->'ai'->>'days')::int));
 END LOOP;
 IF config IS NULL THEN RETURN NEW; END IF;
 FOR rule IN SELECT value FROM jsonb_array_elements(COALESCE(config->'rules','[]'::jsonb)) LOOP
  IF rule->>'enabled'='true' AND rule->>'event' IN ('entered','no_reply','inactive') THEN
   INSERT INTO stage_jobs(account_id,deal_id,stage_id,source_id,kind,payload,run_at) VALUES(NEW.account_id,NEW.deal_id,NEW.to_stage_id,NEW.id,'rule',rule,now()+CASE WHEN rule->>'event'='no_reply' THEN make_interval(hours=>(rule->>'hours')::int) WHEN rule->>'event'='inactive' THEN make_interval(days=>(rule->>'hours')::int) ELSE interval '0' END);
  END IF;
 END LOOP;
 IF COALESCE(config->'email'->>'recipients','')<>'' THEN INSERT INTO stage_jobs(account_id,deal_id,stage_id,source_id,kind,payload) VALUES(NEW.account_id,NEW.deal_id,NEW.to_stage_id,NEW.id,'email',config->'email'); END IF;
 IF COALESCE(config->>'metaEvent','')<>'' THEN INSERT INTO stage_jobs(account_id,deal_id,stage_id,source_id,kind,payload) VALUES(NEW.account_id,NEW.deal_id,NEW.to_stage_id,NEW.id,'meta',jsonb_build_object('event',config->>'metaEvent')); END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.queue_stage_message_rules() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE deal_row record; rule jsonb;
BEGIN
 IF NEW.sender_type<>'customer' OR COALESCE(NEW.content_text,'')='' THEN RETURN NEW; END IF;
 FOR deal_row IN SELECT d.*,s.settings FROM conversations c JOIN deals d ON d.contact_id=c.contact_id AND d.account_id=c.account_id JOIN pipeline_stages s ON s.id=d.stage_id WHERE c.id=NEW.conversation_id AND d.status='open' LOOP
  FOR rule IN SELECT value FROM jsonb_array_elements(COALESCE(deal_row.settings->'rules','[]'::jsonb)) LOOP
   IF rule->>'enabled'='true' AND rule->>'event' IN ('keyword','ai_check') AND (rule->>'event'='ai_check' OR position(lower(rule->>'condition') in lower(NEW.content_text))>0) THEN
    INSERT INTO stage_jobs(account_id,deal_id,stage_id,source_id,kind,payload) VALUES(deal_row.account_id,deal_row.id,deal_row.stage_id,NEW.id,'rule',rule) ON CONFLICT DO NOTHING;
   END IF;
  END LOOP;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.queue_stage_message_rules() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER queue_stage_message_rules AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.queue_stage_message_rules();
CREATE OR REPLACE FUNCTION public.queue_stage_tag_rules() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE deal_row record; rule jsonb;
BEGIN
 FOR deal_row IN SELECT d.*,s.settings FROM deals d JOIN pipeline_stages s ON s.id=d.stage_id WHERE d.contact_id=NEW.contact_id AND d.status='open' LOOP
  FOR rule IN SELECT value FROM jsonb_array_elements(COALESCE(deal_row.settings->'rules','[]'::jsonb)) LOOP
   IF rule->>'enabled'='true' AND rule->>'event'='tag_added' AND rule->>'condition'=NEW.tag_id::text THEN
    INSERT INTO stage_jobs(account_id,deal_id,stage_id,source_id,kind,payload) VALUES(deal_row.account_id,deal_row.id,deal_row.stage_id,NEW.id,'rule',rule) ON CONFLICT DO NOTHING;
   END IF;
  END LOOP;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.queue_stage_tag_rules() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER queue_stage_tag_rules AFTER INSERT ON public.contact_tags FOR EACH ROW EXECUTE FUNCTION public.queue_stage_tag_rules();
COMMIT;
