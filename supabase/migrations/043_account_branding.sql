-- ============================================================
-- 043_account_branding.sql
--
-- Account identity is distinct from a member profile. The owner can
-- name their CRM workspace and upload a public company mark used in the
-- application chrome. Logo writes go through the owner-only API route;
-- the bucket is public solely so signed-in CRM clients can render the
-- logo without a short-lived URL refresh on every page navigation.
-- ============================================================

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

COMMENT ON COLUMN public.accounts.logo_url IS
  'Public URL for the account-owned company logo uploaded by the owner.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'account-logos',
  'account-logos',
  TRUE,
  2097152,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
