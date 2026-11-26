ALTER TABLE public.billing_plans ADD COLUMN code text UNIQUE, ADD COLUMN entitlements jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE public.billing_account_access (
account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
complimentary boolean NOT NULL DEFAULT false,
features jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(features)='object'),
limits jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(limits)='object'),
updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.billing_account_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_account_access FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_account_access TO authenticated,service_role;
CREATE POLICY account_access_read ON public.billing_account_access FOR SELECT TO authenticated USING(public.is_account_member(account_id,'admin'));
INSERT INTO public.billing_plans(name,interval,amount_cents,code,entitlements) VALUES
('Essencial','monthly',5700,'essential','{"limits":{"users":2,"whatsapp":1,"instagram":0,"funnels":3},"features":{"instagram":false,"groupAutomation":false}}'),
('Pro','monthly',9700,'pro','{"limits":{"users":5,"whatsapp":2,"instagram":2,"funnels":7},"features":{"instagram":true,"groupAutomation":true}}'),
('Ilimitado','monthly',19700,'unlimited','{"limits":{"users":null,"whatsapp":null,"instagram":null,"funnels":null},"features":{"instagram":true,"groupAutomation":true}}')
ON CONFLICT(lower(name),interval,amount_cents) DO UPDATE SET code=excluded.code,entitlements=excluded.entitlements;
CREATE FUNCTION public.billing_save_access(p_actor_user_id uuid,p_actor_email text,p_account_id uuid,p_complimentary boolean,p_features jsonb,p_limits jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
INSERT INTO public.billing_account_access(account_id,complimentary,features,limits)
VALUES(p_account_id,p_complimentary,p_features,p_limits)
ON CONFLICT(account_id) DO UPDATE SET complimentary=excluded.complimentary,features=excluded.features,limits=excluded.limits,updated_at=now();
INSERT INTO public.platform_admin_audit_log(actor_user_id,actor_email,action,target_type,target_id,metadata)
VALUES(p_actor_user_id,p_actor_email,'billing.access_saved','account',p_account_id::text,jsonb_build_object('complimentary',p_complimentary,'features',p_features,'limits',p_limits));
END $$;
REVOKE ALL ON FUNCTION public.billing_save_access(uuid,text,uuid,boolean,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_save_access(uuid,text,uuid,boolean,jsonb,jsonb) TO service_role;
CREATE FUNCTION public.billing_effective_access(p_account_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
SELECT jsonb_build_object('features',coalesce(p.entitlements->'features','{}'::jsonb)||coalesce(a.features,'{}'::jsonb),'limits',coalesce(p.entitlements->'limits','{}'::jsonb)||coalesce(a.limits,'{}'::jsonb),'complimentary',coalesce(a.complimentary,false))
FROM (SELECT p_account_id id) x LEFT JOIN public.billing_subscriptions s ON s.account_id=x.id LEFT JOIN public.billing_plans p ON p.id=s.plan_id LEFT JOIN public.billing_account_access a ON a.account_id=x.id
WHERE auth.role()='service_role' OR public.is_account_member(p_account_id,'viewer');
$$;
REVOKE ALL ON FUNCTION public.billing_effective_access(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.billing_effective_access(uuid) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.billing_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'active', count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.billing_account_access a WHERE a.account_id=s.account_id AND a.complimentary) AND s.status = 'active' AND s.period_end >= (now() AT TIME ZONE 'America/Sao_Paulo')::date),
    'trialing', count(*) FILTER (WHERE s.status = 'trialing' AND s.period_end >= (now() AT TIME ZONE 'America/Sao_Paulo')::date),
    'past_due', count(*) FILTER (WHERE s.status = 'past_due'),
    'monthly_cents', coalesce(round(sum(
      CASE p.interval WHEN 'annual' THEN p.amount_cents::numeric / 12 ELSE p.amount_cents END
    ) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.billing_account_access a WHERE a.account_id=s.account_id AND a.complimentary) AND s.status = 'active' AND s.period_end >= (now() AT TIME ZONE 'America/Sao_Paulo')::date)), 0)
  )
  FROM public.billing_subscriptions s
  JOIN public.billing_plans p ON p.id = s.plan_id;
$$;


CREATE FUNCTION public.billing_check_resource_limit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_key text; v_limit jsonb; v_count bigint; v_access jsonb;
BEGIN
  IF TG_OP='UPDATE' AND NEW.account_id=OLD.account_id THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.account_id::text,17));
  v_access:=public.billing_effective_access(NEW.account_id);
  v_key:=TG_ARGV[0];
  IF v_key='instagram' AND v_access->'features'->>'instagram'='false' THEN
    RAISE EXCEPTION 'Instagram desabilitado para esta empresa.' USING ERRCODE='P0001';
  END IF;
  v_limit:=v_access->'limits'->v_key;
  IF v_limit IS NULL OR v_limit='null'::jsonb THEN RETURN NEW; END IF;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE account_id=$1',TG_TABLE_NAME) INTO v_count USING NEW.account_id;
  IF v_count >= (v_limit#>>'{}')::integer THEN
    RAISE EXCEPTION 'Limite do plano atingido para %. Ajuste o plano ou solicite uma personalização.',v_key USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER billing_user_limit BEFORE INSERT OR UPDATE OF account_id ON public.account_memberships FOR EACH ROW EXECUTE FUNCTION public.billing_check_resource_limit('users');
CREATE TRIGGER billing_whatsapp_limit BEFORE INSERT OR UPDATE OF account_id ON public.whatsapp_channels FOR EACH ROW EXECUTE FUNCTION public.billing_check_resource_limit('whatsapp');
CREATE TRIGGER billing_instagram_limit BEFORE INSERT OR UPDATE OF account_id ON public.instagram_channels FOR EACH ROW EXECUTE FUNCTION public.billing_check_resource_limit('instagram');
CREATE TRIGGER billing_funnel_limit BEFORE INSERT OR UPDATE OF account_id ON public.pipelines FOR EACH ROW EXECUTE FUNCTION public.billing_check_resource_limit('funnels');
