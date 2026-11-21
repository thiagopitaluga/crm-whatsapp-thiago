CREATE TABLE IF NOT EXISTS public.infrastructure_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source TEXT NOT NULL,
  hostname TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  collected_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_infrastructure_snapshots_source_time
  ON public.infrastructure_snapshots(source, collected_at DESC);

ALTER TABLE public.infrastructure_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.infrastructure_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.infrastructure_snapshots TO service_role;

