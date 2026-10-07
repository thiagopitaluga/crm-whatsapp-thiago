-- Preserve each Meta form response separately from the contact's editable CRM
-- profile. Retries from the sheet update the same submission, not a new card.
CREATE TABLE IF NOT EXISTS public.lead_form_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_external_id TEXT NOT NULL,
  submitted_at TIMESTAMPTZ,
  fields JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(fields) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_form_submissions_source_unique
    UNIQUE (account_id, source_type, source_external_id)
);

CREATE INDEX IF NOT EXISTS lead_form_submissions_contact_idx
  ON public.lead_form_submissions (account_id, contact_id, submitted_at DESC);

-- Preserve a count of Sheets leads imported before form responses were
-- stored separately. Original answers cannot be reconstructed.
INSERT INTO public.lead_form_submissions (
  account_id, contact_id, source_type, source_external_id, submitted_at, fields
)
SELECT DISTINCT ON (deal.account_id, deal.source_type, deal.source_external_id)
  deal.account_id, deal.contact_id, deal.source_type, deal.source_external_id,
  deal.created_at, jsonb_build_object('name', COALESCE(contact.name, ''))
FROM public.deals deal
JOIN public.contacts contact ON contact.id = deal.contact_id
  AND contact.account_id = deal.account_id
WHERE deal.source_type = 'google_sheets'
  AND deal.source_external_id IS NOT NULL
ORDER BY deal.account_id, deal.source_type, deal.source_external_id, deal.created_at
ON CONFLICT (account_id, source_type, source_external_id) DO NOTHING;

ALTER TABLE public.lead_form_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_form_submissions_select
  ON public.lead_form_submissions;
CREATE POLICY lead_form_submissions_select
  ON public.lead_form_submissions FOR SELECT TO authenticated
  USING (
    public.is_account_member(account_id, 'admin')
    OR EXISTS (
      SELECT 1 FROM public.contacts visible_contact
      WHERE visible_contact.id = lead_form_submissions.contact_id
        AND visible_contact.account_id = lead_form_submissions.account_id
    )
  );

-- Only the server's account-scoped ingest API writes these source records.
GRANT SELECT ON public.lead_form_submissions TO authenticated;
GRANT ALL ON public.lead_form_submissions TO service_role;

DROP TRIGGER IF EXISTS set_updated_at ON public.lead_form_submissions;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.lead_form_submissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

NOTIFY pgrst, 'reload schema';

