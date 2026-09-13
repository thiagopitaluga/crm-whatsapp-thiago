-- Keep a single, editable worksheet-sourced note per imported lead.
-- Manual notes remain untouched because they have no source identifiers.

ALTER TABLE public.contact_notes
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_external_id text;

CREATE UNIQUE INDEX IF NOT EXISTS contact_notes_account_source_unique_idx
  ON public.contact_notes (account_id, source_type, source_external_id)
  WHERE source_type IS NOT NULL AND source_external_id IS NOT NULL;
