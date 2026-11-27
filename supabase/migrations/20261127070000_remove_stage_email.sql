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
 IF COALESCE(config->>'metaEvent','')<>'' THEN INSERT INTO stage_jobs(account_id,deal_id,stage_id,source_id,kind,payload) VALUES(NEW.account_id,NEW.deal_id,NEW.to_stage_id,NEW.id,'meta',jsonb_build_object('event',config->>'metaEvent')); END IF;
 RETURN NEW;
END $$;
UPDATE public.stage_jobs SET status='skipped' WHERE kind='email' AND status='pending';
COMMIT;
