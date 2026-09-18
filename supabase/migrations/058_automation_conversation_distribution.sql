-- ============================================================
-- 058_automation_conversation_distribution
--
-- Keeps the next recipient for each automation and exposes an atomic
-- recipient selector. The function owns both advancing the cursor and
-- assigning the conversation, so simultaneous inbound messages cannot pick
-- the same person by accident.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.automation_round_robin_state (
  automation_id UUID PRIMARY KEY REFERENCES public.automations(id) ON DELETE CASCADE,
  next_position INTEGER NOT NULL DEFAULT 0 CHECK (next_position >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.automation_round_robin_state ENABLE ROW LEVEL SECURITY;

-- The state is an internal implementation detail. Browser clients configure
-- the automation itself; only the automation engine's service-role client
-- may advance a distribution.
REVOKE ALL ON TABLE public.automation_round_robin_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.automation_round_robin_state TO service_role;

CREATE OR REPLACE FUNCTION public.assign_conversation_round_robin(
  p_automation_id UUID,
  p_account_id UUID,
  p_conversation_id UUID,
  p_contact_id UUID,
  p_member_ids UUID[] DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_member_ids UUID[];
  v_member_count INTEGER;
  v_position INTEGER;
  v_assigned_user_id UUID;
BEGIN
  -- Never let an automation in one CRM distribute a conversation in another.
  IF NOT EXISTS (
    SELECT 1 FROM public.automations
    WHERE id = p_automation_id AND account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Automation does not belong to this account' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversations
    WHERE id = p_conversation_id
      AND account_id = p_account_id
      AND contact_id = p_contact_id
  ) THEN
    RAISE EXCEPTION 'Conversation does not belong to this account/contact' USING ERRCODE = '42501';
  END IF;

  -- Eligible recipients are real members of this CRM, excluding read-only
  -- viewers. An empty configured list means "all eligible team members".
  SELECT array_agg(m.user_id ORDER BY COALESCE(p.full_name, p.email, ''), m.user_id)
    INTO v_member_ids
  FROM public.account_memberships m
  LEFT JOIN public.profiles p ON p.user_id = m.user_id
  WHERE m.account_id = p_account_id
    AND m.role IN ('owner', 'admin', 'agent')
    AND (
      p_member_ids IS NULL
      OR cardinality(p_member_ids) = 0
      OR m.user_id = ANY(p_member_ids)
    );

  v_member_count := COALESCE(cardinality(v_member_ids), 0);
  IF v_member_count = 0 THEN
    RAISE EXCEPTION 'No eligible recipients configured for this distribution';
  END IF;

  -- UPSERT obtains a row lock. Concurrent calls therefore receive the state
  -- written by the preceding call, then advance it exactly once.
  INSERT INTO public.automation_round_robin_state (automation_id, next_position)
  VALUES (p_automation_id, 0)
  ON CONFLICT (automation_id) DO UPDATE
    SET updated_at = NOW()
  RETURNING next_position INTO v_position;

  v_position := MOD(v_position, v_member_count);
  v_assigned_user_id := v_member_ids[v_position + 1];

  UPDATE public.automation_round_robin_state
  SET next_position = MOD(v_position + 1, v_member_count),
      updated_at = NOW()
  WHERE automation_id = p_automation_id;

  UPDATE public.conversations
  SET assigned_agent_id = v_assigned_user_id,
      updated_at = NOW()
  WHERE id = p_conversation_id
    AND account_id = p_account_id
    AND contact_id = p_contact_id;

  RETURN v_assigned_user_id;
END;
$function$;

ALTER FUNCTION public.assign_conversation_round_robin(UUID, UUID, UUID, UUID, UUID[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.assign_conversation_round_robin(UUID, UUID, UUID, UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_conversation_round_robin(UUID, UUID, UUID, UUID, UUID[]) TO service_role;

COMMENT ON TABLE public.automation_round_robin_state IS
  'Per-automation cursor for atomic, fair conversation distribution.';
COMMENT ON FUNCTION public.assign_conversation_round_robin(UUID, UUID, UUID, UUID, UUID[]) IS
  'Atomically selects the next eligible account member and assigns one conversation.';
