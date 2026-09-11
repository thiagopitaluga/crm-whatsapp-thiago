-- ============================================================
-- 042_google_calendar_task_foundation
--
-- Storage foundation for a future per-account Google Calendar OAuth
-- connection. OAuth tokens are deliberately service-role-only: browser
-- clients never receive or query these columns directly.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.google_calendar_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  calendar_id TEXT,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'connected', 'error')),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.google_calendar_connections ENABLE ROW LEVEL SECURITY;
-- No client policies: a future authenticated server route will expose only
-- safe connection status, never token material.

DROP TRIGGER IF EXISTS set_updated_at ON public.google_calendar_connections;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.google_calendar_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS google_calendar_event_id TEXT,
  ADD COLUMN IF NOT EXISTS google_calendar_sync_status TEXT NOT NULL DEFAULT 'not_connected'
    CHECK (google_calendar_sync_status IN ('not_connected', 'pending', 'synced', 'error')),
  ADD COLUMN IF NOT EXISTS google_calendar_last_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tasks_google_calendar_event_id
  ON public.tasks(google_calendar_event_id)
  WHERE google_calendar_event_id IS NOT NULL;
