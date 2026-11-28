ALTER TABLE public.evolution_campaign_recipients
  ADD COLUMN IF NOT EXISTS sent_text text;
