-- ============================================================
-- 047_external_lead_source_idempotency.sql
--
-- A lead received from an external source (Google Sheets, a form
-- connector, etc.) must create at most one Kanban card per CRM
-- account. The upstream source id is deliberately namespaced by
-- source_type, so different systems can use the same identifier.
-- ============================================================

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS source_external_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS deals_account_external_source_unique
  ON public.deals (account_id, source_type, source_external_id)
  WHERE source_type IS NOT NULL AND source_external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS deals_account_external_source_lookup
  ON public.deals (account_id, source_type, source_external_id)
  WHERE source_type IS NOT NULL AND source_external_id IS NOT NULL;

COMMENT ON COLUMN public.deals.source_type IS
  'External lead source namespace, e.g. google_sheets.';
COMMENT ON COLUMN public.deals.source_external_id IS
  'Stable source-specific id used to make external lead delivery idempotent.';
