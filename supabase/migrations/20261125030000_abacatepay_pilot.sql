-- Sandbox records are kept outside the commercial subscription and revenue tables.
CREATE TABLE public.billing_abacatepay_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.billing_plans(id),
  product_id text NOT NULL,
  checkout_id text UNIQUE,
  subscription_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'trialing', 'active', 'past_due', 'canceled', 'expired')),
  period_end date,
  event_at timestamptz NOT NULL DEFAULT '-infinity',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.billing_abacatepay_tests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_abacatepay_tests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_abacatepay_tests TO service_role;
