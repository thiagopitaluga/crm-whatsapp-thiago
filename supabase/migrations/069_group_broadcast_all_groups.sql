-- Allow the group center's "select all" action to include every group in an
-- account, while the worker still sends in small batches under the daily cap.
CREATE OR REPLACE FUNCTION public.update_scheduled_group_broadcast_v2(
  p_account_id uuid, p_broadcast_id uuid, p_name text, p_message_text text,
  p_scheduled_at timestamptz, p_groups jsonb, p_content_kind text,
  p_media_url text, p_media_name text, p_poll_options jsonb, p_recurrence text
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'Insufficient role' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 120
    OR p_message_text IS NULL OR length(btrim(p_message_text)) > 4096
    OR p_scheduled_at IS NULL OR p_scheduled_at < now() + interval '1 minute'
    OR p_groups IS NULL OR jsonb_typeof(p_groups) <> 'array'
    OR jsonb_array_length(p_groups) NOT BETWEEN 1 AND 300
    OR p_content_kind NOT IN ('text', 'image', 'video', 'audio', 'document', 'poll')
    OR p_recurrence NOT IN ('none', 'daily', 'weekly', 'monthly')
    OR p_poll_options IS NULL OR jsonb_typeof(p_poll_options) <> 'array' THEN
    RAISE EXCEPTION 'Invalid scheduled group broadcast' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_groups) AS item
    WHERE item->>'group_jid' !~ '^[^@[:space:]]+@g[.]us$'
      OR length(coalesce(item->>'group_subject', '')) NOT BETWEEN 1 AND 255
  ) THEN RAISE EXCEPTION 'Invalid target group' USING ERRCODE = '22023'; END IF;

  SELECT id INTO v_id FROM public.group_broadcasts
  WHERE id = p_broadcast_id AND account_id = p_account_id AND status = 'scheduled'
  FOR UPDATE;
  IF v_id IS NULL THEN RETURN false; END IF;

  UPDATE public.group_broadcasts SET
    name = btrim(p_name), message_text = btrim(p_message_text),
    scheduled_at = p_scheduled_at, total_groups = jsonb_array_length(p_groups),
    content_kind = p_content_kind, media_url = p_media_url, media_name = p_media_name,
    poll_options = p_poll_options, recurrence = p_recurrence,
    series_id = CASE WHEN p_recurrence = 'none' THEN NULL ELSE coalesce(series_id, gen_random_uuid()) END
  WHERE id = v_id;
  DELETE FROM public.group_broadcast_targets WHERE broadcast_id = v_id;
  INSERT INTO public.group_broadcast_targets(broadcast_id, account_id, group_jid, group_subject)
    SELECT v_id, p_account_id, item->>'group_jid', item->>'group_subject'
    FROM jsonb_array_elements(p_groups) AS item;
  RETURN true;
END;
$$;

