-- Keep attachment retention explicit and bounded. 365 days is a sensible
-- default for CRM history; each account can increase, shorten, or disable it
-- by setting media_retention_days to NULL.
ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS media_retention_days smallint DEFAULT 365
  CHECK (media_retention_days IS NULL OR media_retention_days BETWEEN 30 AND 3650);

COMMENT ON COLUMN public.whatsapp_config.media_retention_days IS
  'Days to retain persisted chat media. NULL disables automatic deletion.';

CREATE OR REPLACE FUNCTION public.purge_expired_chat_media()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  deleted_count integer := 0;
BEGIN
  -- A message URL is cleared before its Storage object is removed. This makes
  -- the operation idempotent and prevents the UI from requesting expired data.
  WITH expired AS (
    SELECT m.id,
           regexp_replace(
             m.media_url,
             '^.*/storage/v1/object/public/chat-media/',
             ''
           ) AS object_name
      FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id
      JOIN public.whatsapp_config wc ON wc.account_id = c.account_id
     WHERE wc.media_retention_days IS NOT NULL
       AND m.content_type IN ('image', 'audio', 'video', 'document')
       AND m.media_url ~ '/storage/v1/object/public/chat-media/'
       AND m.created_at < now() - make_interval(days => wc.media_retention_days)
     FOR UPDATE OF m SKIP LOCKED
  ), cleared AS (
    UPDATE public.messages m
       SET media_url = NULL,
           updated_at = now()
      FROM expired e
     WHERE m.id = e.id
     RETURNING e.object_name
  ), removed AS (
    DELETE FROM storage.objects o
     USING cleared c
     WHERE o.bucket_id = 'chat-media'
       AND o.name = c.object_name
     RETURNING o.id
  )
  SELECT count(*) INTO deleted_count FROM removed;

  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_chat_media() FROM PUBLIC;

-- Run once per day, outside Brazil's normal business hours. Replacing the
-- job makes the migration repeatable across environments.
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-expired-chat-media') THEN
    PERFORM cron.unschedule(jobid)
      FROM cron.job
     WHERE jobname = 'purge-expired-chat-media';
  END IF;
  PERFORM cron.schedule(
    'purge-expired-chat-media',
    '17 03 * * *',
    'SELECT public.purge_expired_chat_media()'
  );
END;
$$;
