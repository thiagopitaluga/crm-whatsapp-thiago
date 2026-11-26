import { createHash } from 'node:crypto';

export type WhatsAppConversion = {
  wabaId: string;
  datasetId: string;
  channelKey: string;
};

/** An observed ad click is required. Never infer attribution from message text. */
export function buildWhatsAppConversion(input: {
  config: WhatsAppConversion;
  channelKey: string | null;
  clickId: string | null;
  eventName: string;
  eventId: string;
  occurredAt: string;
  value: number;
  currency: string;
}) {
  if (!input.clickId?.trim() || input.channelKey !== input.config.channelKey)
    return null;
  const eventTime = Math.floor(new Date(input.occurredAt).getTime() / 1000);
  if (!Number.isFinite(eventTime))
    throw new Error('Data da conversão inválida.');
  if (
    input.eventName === 'Purchase' &&
    (!Number.isFinite(input.value) || input.value <= 0)
  )
    throw new Error(
      'Informe um valor positivo no negócio antes de enviar Purchase.'
    );
  return {
    event_name: input.eventName,
    event_time: eventTime,
    event_id: input.eventId,
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: {
      whatsapp_business_account_id: input.config.wabaId,
      ctwa_clid: input.clickId.trim(),
    },
    custom_data: { currency: input.currency || 'BRL', value: input.value },
  };
}

export function hashedMetaContact(
  email?: string | null,
  phone?: string | null
) {
  const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');
  const data: Record<string, string[]> = {};
  if (email?.trim()) data.em = [hash(email.trim().toLowerCase())];
  const digits = phone?.replace(/\D/g, '');
  if (digits) data.ph = [hash(digits)];
  return data;
}
