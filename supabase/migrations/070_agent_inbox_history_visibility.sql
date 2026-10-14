-- Account owners and administrators may turn off the entire Inbox for
-- attendants. Hiding only message rows would still expose their text through
-- conversations.last_message_text and Realtime conversation updates.
-- Keep the existing experience for every account until an admin opts out.
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS agents_can_view_inbox_messages boolean NOT NULL DEFAULT true;

DROP POLICY IF EXISTS conversations_select ON public.conversations;
CREATE POLICY conversations_select ON public.conversations FOR SELECT
  USING (
    public.is_account_member(account_id, 'admin')
    OR (
      EXISTS (
        SELECT 1 FROM public.contacts contact
        WHERE contact.id = conversations.contact_id
          AND contact.account_id = conversations.account_id
          AND public.can_view_lead(contact.account_id, contact.assigned_to)
      )
      AND (
        NOT public.is_account_member(account_id, 'agent')
        OR EXISTS (
          SELECT 1 FROM public.accounts account
          WHERE account.id = conversations.account_id
            AND account.agents_can_view_inbox_messages
        )
      )
    )
  );

-- messages_modify was a permissive FOR ALL policy, which also applies to
-- SELECT. Split it into write-only policies so reads depend on the visible
-- parent conversation. This also protects direct Supabase and Realtime reads.
DROP POLICY IF EXISTS messages_modify ON public.messages;
DROP POLICY IF EXISTS messages_select ON public.messages;
DROP POLICY IF EXISTS messages_insert ON public.messages;
DROP POLICY IF EXISTS messages_update ON public.messages;
DROP POLICY IF EXISTS messages_delete ON public.messages;
CREATE POLICY messages_select ON public.messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations conversation
      WHERE conversation.id = messages.conversation_id
        AND public.is_account_member(conversation.account_id)
    )
  );
CREATE POLICY messages_insert ON public.messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations conversation
      WHERE conversation.id = messages.conversation_id
        AND public.is_account_member(conversation.account_id, 'agent')
    )
  );
CREATE POLICY messages_update ON public.messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations conversation
      WHERE conversation.id = messages.conversation_id
        AND public.is_account_member(conversation.account_id, 'agent')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations conversation
      WHERE conversation.id = messages.conversation_id
        AND public.is_account_member(conversation.account_id, 'agent')
    )
  );
CREATE POLICY messages_delete ON public.messages FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations conversation
      WHERE conversation.id = messages.conversation_id
        AND public.is_account_member(conversation.account_id, 'agent')
    )
  );
