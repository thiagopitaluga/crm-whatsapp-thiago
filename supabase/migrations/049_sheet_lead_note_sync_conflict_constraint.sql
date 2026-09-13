-- PostgREST's upsert requires a named/full unique constraint as the
-- conflict target. NULL source fields keep manually authored notes distinct.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contact_notes_account_source_unique'
      AND conrelid = 'public.contact_notes'::regclass
  ) THEN
    ALTER TABLE public.contact_notes
      ADD CONSTRAINT contact_notes_account_source_unique
      UNIQUE (account_id, source_type, source_external_id);
  END IF;
END $$;
