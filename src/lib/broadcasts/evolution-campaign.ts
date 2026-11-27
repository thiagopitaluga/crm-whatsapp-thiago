export type CampaignMessage = {
  text: string;
  mediaUrl?: string;
  mediaKind?: 'image' | 'video' | 'document';
  mediaName?: string;
};
export type CampaignAudience = {
  mode: 'contacts' | 'segment' | 'csv';
  contactIds: string[];
  segment: {
    pipelineId: string;
    stageIds: string[];
    tagIds: string[];
    assigneeId: string;
    createdFrom: string;
    createdTo: string;
  };
  csvContacts: { phone: string; name: string }[];
};
export type CampaignAction = {
  pipelineId: string;
  stageId: string;
  tagId: string;
  assigneeId: string;
};
export type CampaignDelivery = {
  senderIds: string[];
  dailyLimit: number;
  windowStart: string;
  windowEnd: string;
  slots: { start: string; end: string; limit: number }[];
  weekdays: number[];
  minDelaySeconds: number;
  maxDelaySeconds: number;
  batchSize: number;
  batchPauseMinutes: number;
  sendNow: boolean;
  scheduledAt: string;
  timeZone: string;
};
export type CampaignInput = {
  name: string;
  messages: CampaignMessage[];
  audience: CampaignAudience;
  delivery: CampaignDelivery;
  onSent: CampaignAction;
  onReply: CampaignAction;
  consentConfirmed: boolean;
};

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const brazilPhone = (value: string) => {
  const digits = value.replace(/\D/g, '');
  const normalized = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  return /^\d{10,15}$/.test(normalized) ? normalized : '';
};
export function validateSpintax(text: string): string | null {
  const groups = text.match(/\{[^{}]*\|[^{}]*\}/g) ?? [];
  for (const group of groups) {
    const choices = group.slice(1, -1).split('|');
    if (choices.length < 2 || choices.length > 20 || choices.some((choice) => !choice.trim()))
      return 'Cada grupo de spintax precisa ter de 2 a 20 opções preenchidas.';
  }
  const remainder = text.replace(/\{(?:name|first_name|phone)\}/gi, '')
    .replace(/\{[^{}]*\|[^{}]*\}/g, '');
  return /[{}]/.test(remainder) ? 'Revise as chaves do spintax ou das variáveis.' : null;
}
const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const ids = (value: unknown) => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string => typeof item === 'string' && uuidPattern.test(item)))]
  : [];
const boundedInt = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
};

export function parseCampaignInput(value: unknown): { value: CampaignInput } | { error: string } {
  const body = object(value);
  const name = str(body.name).slice(0, 120);
  const messages = (Array.isArray(body.messages) ? body.messages : []).map((entry) => {
    const row = object(entry);
    const mediaKind = str(row.mediaKind);
    return {
      text: str(row.text).slice(0, 4096),
      mediaUrl: str(row.mediaUrl) || undefined,
      mediaKind: ['image','video','document'].includes(mediaKind) ? mediaKind as CampaignMessage['mediaKind'] : undefined,
      mediaName: str(row.mediaName).slice(0, 255) || undefined,
    } satisfies CampaignMessage;
  });
  if (!name || messages.length < 1 || messages.length > 10 || messages.some((item) =>
    (!item.text && !item.mediaUrl) || (item.mediaUrl && !item.mediaKind) || (!item.mediaUrl && item.mediaKind)))
    return { error: 'Informe um nome e de 1 a 10 mensagens válidas.' };
  const invalidSpintax = messages.findIndex((item) => validateSpintax(item.text));
  if (invalidSpintax >= 0)
    return { error: `Mensagem ${invalidSpintax + 1}: ${validateSpintax(messages[invalidSpintax].text)}` };

  const rawAudience = object(body.audience);
  const mode = str(rawAudience.mode);
  if (!['contacts','segment','csv'].includes(mode)) return { error: 'Escolha o público do disparo.' };
  const rawSegment = object(rawAudience.segment);
  const audience: CampaignAudience = {
    mode: mode as CampaignAudience['mode'],
    contactIds: ids(rawAudience.contactIds).slice(0, 5000),
    segment: {
      pipelineId: str(rawSegment.pipelineId),
      stageIds: ids(rawSegment.stageIds),
      tagIds: ids(rawSegment.tagIds),
      assigneeId: str(rawSegment.assigneeId),
      createdFrom: str(rawSegment.createdFrom),
      createdTo: str(rawSegment.createdTo),
    },
    csvContacts: Array.isArray(rawAudience.csvContacts)
      ? rawAudience.csvContacts.slice(0, 5000).map((row) => ({
          phone: brazilPhone(str(object(row).phone)), name: str(object(row).name).slice(0, 150),
        })) : [],
  };
  if (mode === 'contacts' && !audience.contactIds.length) return { error: 'Selecione pelo menos um contato.' };
  if (mode === 'csv' && (!audience.csvContacts.length || audience.csvContacts.some((row) => !row.phone)))
    return { error: 'A lista precisa conter telefones válidos.' };
  if (mode === 'segment' && !audience.segment.pipelineId && !audience.segment.tagIds.length &&
      !audience.segment.assigneeId && !audience.segment.createdFrom && !audience.segment.createdTo)
    return { error: 'Configure pelo menos um filtro no segmento do CRM.' };
  if (mode === 'segment' && ([audience.segment.pipelineId, audience.segment.assigneeId]
    .some((id) => id && !uuidPattern.test(id)) ||
    [audience.segment.createdFrom, audience.segment.createdTo]
      .some((date) => date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) ||
    (audience.segment.createdFrom && audience.segment.createdTo &&
      audience.segment.createdFrom > audience.segment.createdTo)))
    return { error: 'Revise os filtros do segmento.' };

  const rawDelivery = object(body.delivery);
  const slots = (Array.isArray(rawDelivery.slots) ? rawDelivery.slots : []).slice(0, 8).map((row) => {
    const entry = object(row);
    return { start: str(entry.start), end: str(entry.end), limit: boundedInt(entry.limit, 1, 5000, 1) };
  });
  const delivery: CampaignDelivery = {
    senderIds: ids(rawDelivery.senderIds).slice(0, 20),
    dailyLimit: boundedInt(rawDelivery.dailyLimit, 1, 5000, 100),
    windowStart: str(rawDelivery.windowStart),
    windowEnd: str(rawDelivery.windowEnd),
    slots,
    weekdays: Array.isArray(rawDelivery.weekdays)
      ? [...new Set(rawDelivery.weekdays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))] : [],
    minDelaySeconds: boundedInt(rawDelivery.minDelaySeconds, 30, 3600, 45),
    maxDelaySeconds: boundedInt(rawDelivery.maxDelaySeconds, 30, 7200, 120),
    batchSize: boundedInt(rawDelivery.batchSize, 1, 1000, 30),
    batchPauseMinutes: boundedInt(rawDelivery.batchPauseMinutes, 1, 120, 5),
    sendNow: rawDelivery.sendNow === true,
    scheduledAt: str(rawDelivery.scheduledAt),
    timeZone: 'America/Sao_Paulo',
  };
  if (!delivery.senderIds.length || !validTime(delivery.windowStart) || !validTime(delivery.windowEnd) ||
      delivery.windowStart >= delivery.windowEnd || !delivery.weekdays.length ||
      delivery.maxDelaySeconds < delivery.minDelaySeconds ||
      delivery.slots.some((slot) => !validTime(slot.start) || !validTime(slot.end) || slot.start >= slot.end ||
        slot.start < delivery.windowStart || slot.end > delivery.windowEnd))
    return { error: 'Revise os números, dias, horários e intervalos de envio.' };
  if (!delivery.sendNow && (!delivery.scheduledAt || !Number.isFinite(Date.parse(delivery.scheduledAt)) ||
      Date.parse(delivery.scheduledAt) < Date.now() + 60_000))
    return { error: 'Escolha um agendamento futuro ou marque envio imediato.' };

  function action(value: unknown): CampaignAction {
    const row = object(value);
    return { pipelineId: str(row.pipelineId), stageId: str(row.stageId),
      tagId: str(row.tagId), assigneeId: str(row.assigneeId) };
  }
  const onSent = action(body.onSent);
  const onReply = action(body.onReply);
  if ([...Object.values(onSent), ...Object.values(onReply)].some((id) => id && !uuidPattern.test(id)))
    return { error: 'Ação automática inválida.' };
  if (body.consentConfirmed !== true) return { error: 'Confirme que esses contatos podem receber a mensagem.' };
  return { value: { name, messages, audience, delivery,
    onSent, onReply, consentConfirmed: true } };
}

export function personalizeCampaignMessage(text: string, contact: { phone: string; name: string }, seed: number): string {
  let state = seed >>> 0;
  const pick = (length: number) => { state = (1664525 * state + 1013904223) >>> 0; return state % length; };
  const firstName = contact.name.trim().split(/\s+/)[0] || '';
  return text.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, choices: string) => {
    const items = choices.split('|').map((item) => item.trim()).filter(Boolean);
    return items.length ? items[pick(items.length)] : '';
  }).replace(/\{(name|first_name|phone)\}/gi, (_, key: string) =>
    key.toLowerCase() === 'name' ? contact.name : key.toLowerCase() === 'phone' ? contact.phone : firstName);
}
