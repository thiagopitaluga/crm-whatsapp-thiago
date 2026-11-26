CREATE OR REPLACE FUNCTION public.billing_check_resource_limit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_key text; v_limit jsonb; v_count bigint; v_access jsonb; v_existing boolean; v_identity text;
BEGIN
  IF TG_OP='UPDATE' AND NEW.account_id=OLD.account_id THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.account_id::text,17));
  v_identity:=CASE TG_TABLE_NAME WHEN 'account_memberships' THEN 'user_id' WHEN 'whatsapp_channels' THEN 'channel_key' WHEN 'instagram_channels' THEN 'instagram_id' ELSE 'id' END;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE account_id=$1 AND %I::text=$2)',TG_TABLE_NAME,v_identity)
    INTO v_existing USING NEW.account_id,to_jsonb(NEW)->>v_identity;
  IF v_existing THEN RETURN NEW; END IF;
  SELECT jsonb_build_object(
    'features',coalesce(p.entitlements->'features','{}'::jsonb)||coalesce(a.features,'{}'::jsonb),
    'limits',coalesce(p.entitlements->'limits','{}'::jsonb)||coalesce(a.limits,'{}'::jsonb))
  INTO v_access
  FROM (SELECT NEW.account_id id) x
  LEFT JOIN public.billing_subscriptions s ON s.account_id=x.id
  LEFT JOIN public.billing_plans p ON p.id=s.plan_id
  LEFT JOIN public.billing_account_access a ON a.account_id=x.id;
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
