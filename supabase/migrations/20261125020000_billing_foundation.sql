CREATE TABLE public.billing_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 80),
  interval text NOT NULL CHECK (interval IN ('monthly', 'annual')),
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.billing_subscriptions (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.billing_plans(id),
  status text NOT NULL CHECK (status IN ('pending', 'trialing', 'active', 'past_due', 'canceled')),
  period_end date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('trialing', 'active', 'past_due') OR period_end IS NOT NULL)
);

CREATE INDEX billing_subscriptions_plan_idx ON public.billing_subscriptions(plan_id);
CREATE UNIQUE INDEX billing_plans_unique_offer ON public.billing_plans(lower(name), interval, amount_cents);

ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_subscriptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.billing_plans, public.billing_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.billing_plans, public.billing_subscriptions TO authenticated;
GRANT SELECT ON public.billing_plans, public.billing_subscriptions TO service_role;

CREATE POLICY billing_subscriptions_admin_read ON public.billing_subscriptions
  FOR SELECT TO authenticated USING (public.is_account_member(account_id, 'admin'));

CREATE POLICY billing_plans_subscriber_read ON public.billing_plans
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.billing_subscriptions subscription
      WHERE subscription.plan_id = billing_plans.id
    )
  );

CREATE FUNCTION public.billing_create_plan(
  p_actor_user_id uuid,
  p_actor_email text,
  p_name text,
  p_interval text,
  p_amount_cents integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.billing_plans(name, interval, amount_cents)
  VALUES (trim(p_name), p_interval, p_amount_cents) RETURNING id INTO v_id;

  INSERT INTO public.platform_admin_audit_log(actor_user_id, actor_email, action, target_type, target_id, metadata)
  VALUES (p_actor_user_id, p_actor_email, 'billing.plan_created', 'billing_plan', v_id::text,
    jsonb_build_object('name', trim(p_name), 'interval', p_interval, 'amount_cents', p_amount_cents));

  RETURN v_id;
END;
$$;

CREATE FUNCTION public.billing_set_subscription(
  p_actor_user_id uuid,
  p_actor_email text,
  p_account_id uuid,
  p_plan_id uuid,
  p_status text,
  p_period_end date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.billing_subscriptions(account_id, plan_id, status, period_end)
  VALUES (p_account_id, p_plan_id, p_status, p_period_end)
  ON CONFLICT (account_id) DO UPDATE
    SET plan_id = excluded.plan_id, status = excluded.status, period_end = excluded.period_end, updated_at = now();

  INSERT INTO public.platform_admin_audit_log(actor_user_id, actor_email, action, target_type, target_id, metadata)
  VALUES (p_actor_user_id, p_actor_email, 'billing.subscription_saved', 'account', p_account_id::text,
    jsonb_build_object('plan_id', p_plan_id, 'status', p_status, 'period_end', p_period_end));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.billing_create_plan(uuid, text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.billing_set_subscription(uuid, text, uuid, uuid, text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_create_plan(uuid, text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_set_subscription(uuid, text, uuid, uuid, text, date) TO service_role;

CREATE FUNCTION public.billing_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'active', count(*) FILTER (WHERE s.status = 'active' AND s.period_end >= (now() AT TIME ZONE 'America/Sao_Paulo')::date),
    'trialing', count(*) FILTER (WHERE s.status = 'trialing' AND s.period_end >= (now() AT TIME ZONE 'America/Sao_Paulo')::date),
    'past_due', count(*) FILTER (WHERE s.status = 'past_due'),
    'monthly_cents', coalesce(round(sum(
      CASE p.interval WHEN 'annual' THEN p.amount_cents::numeric / 12 ELSE p.amount_cents END
    ) FILTER (WHERE s.status = 'active' AND s.period_end >= (now() AT TIME ZONE 'America/Sao_Paulo')::date)), 0)
  )
  FROM public.billing_subscriptions s
  JOIN public.billing_plans p ON p.id = s.plan_id;
$$;

REVOKE EXECUTE ON FUNCTION public.billing_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_summary() TO service_role;
