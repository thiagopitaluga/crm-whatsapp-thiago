BEGIN;
ALTER TABLE public.stage_integrations
  ADD COLUMN IF NOT EXISTS whatsapp_conversion jsonb;
ALTER TABLE public.stage_integrations
  ADD CONSTRAINT stage_integrations_whatsapp_conversion_check CHECK (
    whatsapp_conversion IS NULL OR (
      jsonb_typeof(whatsapp_conversion) = 'object'
      AND coalesce(whatsapp_conversion->>'wabaId', '') ~ '^[0-9]{5,30}$'
      AND coalesce(whatsapp_conversion->>'datasetId', '') ~ '^[0-9]{5,30}$'
      AND length(coalesce(whatsapp_conversion->>'channelKey', '')) BETWEEN 1 AND 200
    )
  );
COMMIT;
