-- Global administration foundation. All access is restricted to the
-- service_role; the application performs the superadmin identity check before
-- calling these objects.

CREATE TABLE IF NOT EXISTS public.platform_admin_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_admin_audit_created
  ON public.platform_admin_audit_log(created_at DESC);

ALTER TABLE public.platform_admin_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_admin_audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.platform_admin_audit_log TO service_role;

CREATE OR REPLACE FUNCTION public.platform_admin_overview_metrics()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'public_tables_bytes', COALESCE((
      SELECT SUM(pg_total_relation_size(c.oid))
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'm')
    ), 0),
    'storage_bytes', COALESCE((
      SELECT SUM(
        CASE
          WHEN (o.metadata ->> 'size') ~ '^[0-9]+$'
            THEN (o.metadata ->> 'size')::bigint
          ELSE 0
        END
      )
      FROM storage.objects o
    ), 0),
    'contacts', (SELECT COUNT(*) FROM public.contacts),
    'conversations', (SELECT COUNT(*) FROM public.conversations),
    'messages', (SELECT COUNT(*) FROM public.messages),
    'deals', (SELECT COUNT(*) FROM public.deals),
    'accounts_total', (SELECT COUNT(*) FROM public.accounts),
    'accounts_active', (
      SELECT COUNT(*) FROM public.accounts a
      WHERE EXISTS (
        SELECT 1 FROM public.account_memberships m WHERE m.account_id = a.id
      )
    ),
    'accounts', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'name', a.name,
          'owner_user_id', a.owner_user_id,
          'created_at', a.created_at,
          'members', (SELECT COUNT(*) FROM public.account_memberships m WHERE m.account_id = a.id),
          'contacts', (SELECT COUNT(*) FROM public.contacts x WHERE x.account_id = a.id),
          'conversations', (SELECT COUNT(*) FROM public.conversations x WHERE x.account_id = a.id),
          'messages', (
            SELECT COUNT(*)
            FROM public.messages msg
            JOIN public.conversations conv ON conv.id = msg.conversation_id
            WHERE conv.account_id = a.id
          ),
          'deals', (SELECT COUNT(*) FROM public.deals x WHERE x.account_id = a.id)
        ) ORDER BY LOWER(a.name), a.created_at
      )
      FROM public.accounts a
    ), '[]'::jsonb)
  );
$$;

ALTER FUNCTION public.platform_admin_overview_metrics() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.platform_admin_overview_metrics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_overview_metrics() TO service_role;

