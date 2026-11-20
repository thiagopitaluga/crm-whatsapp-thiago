-- Keep form leads in a pipeline selected for this CRM account.
ALTER TABLE public.meta_ad_account_integrations
  ADD COLUMN IF NOT EXISTS meta_leads_pipeline_id UUID
  REFERENCES public.pipelines(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
