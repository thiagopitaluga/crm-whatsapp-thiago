import { validateSpintax, uuidPattern, type CampaignDelivery, type CampaignMessage } from './evolution-campaign';

type Editable = { name: string; messages: string[]; delivery: CampaignDelivery };

export function parseEvolutionEdit(value: unknown, original: {
  message_variants: CampaignMessage[]; delivery_config: CampaignDelivery;
}, now = Date.now()): { value: Editable } | { error: string } {
  if (!value || typeof value !== 'object') return { error: 'Dados de edição inválidos.' };
  const input = value as Record<string, unknown>;
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 120) return { error: 'Informe um nome com até 120 caracteres.' };
  if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > 10 ||
      input.messages.some((text) => typeof text !== 'string' || text.length > 4096))
    return { error: 'Informe de 1 a 10 mensagens com até 4.096 caracteres.' };
  const messages = input.messages as string[];
  if (original.message_variants.some((message) => message.mediaUrl) && messages.length !== original.message_variants.length)
    return { error: 'Campanhas com anexos devem manter a quantidade de mensagens.' };
  if (messages.some((text, index) => (!text.trim() && !original.message_variants[index]?.mediaUrl) || validateSpintax(text)))
    return { error: 'Revise o texto e as opções de spintax das mensagens.' };

  if (!input.delivery || typeof input.delivery !== 'object') return { error: 'Configuração de envio inválida.' };
  const raw = input.delivery as Record<string, unknown>;
  const numeric = (key: string, min: number, max: number) =>
    Number.isInteger(raw[key]) && Number(raw[key]) >= min && Number(raw[key]) <= max;
  const time = (value: unknown): value is string => typeof value === 'string' &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (!numeric('dailyLimit', 1, 5000) || !numeric('minDelaySeconds', 30, 3600) ||
      !numeric('maxDelaySeconds', 30, 7200) || !numeric('batchSize', 1, 1000) ||
      !numeric('batchPauseMinutes', 1, 120) ||
      Number(raw.maxDelaySeconds) < Number(raw.minDelaySeconds))
    return { error: 'Revise limite, intervalo e tamanho do lote.' };
  if (!time(raw.windowStart) || !time(raw.windowEnd) || raw.windowStart >= raw.windowEnd)
    return { error: 'Informe uma janela de envio válida.' };
  if (!Array.isArray(raw.weekdays) || !raw.weekdays.length ||
      raw.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6))
    return { error: 'Selecione pelo menos um dia permitido.' };
  if (!Array.isArray(raw.senderIds) || !raw.senderIds.length ||
      raw.senderIds.some((id) => typeof id !== 'string' || !uuidPattern.test(id)))
    return { error: 'Selecione um número WhatsApp válido.' };
  const endAt = typeof raw.endAt === 'string' ? raw.endAt : '';
  if (endAt && (!Number.isFinite(Date.parse(endAt)) || Date.parse(endAt) <= now))
    return { error: 'O encerramento precisa ser uma data futura.' };
  return { value: {
    name, messages,
    delivery: {
      ...original.delivery_config,
      senderIds: [...new Set(raw.senderIds as string[])],
      dailyLimit: Number(raw.dailyLimit),
      minDelaySeconds: Number(raw.minDelaySeconds),
      maxDelaySeconds: Number(raw.maxDelaySeconds),
      batchSize: Number(raw.batchSize),
      batchPauseMinutes: Number(raw.batchPauseMinutes),
      windowStart: raw.windowStart,
      windowEnd: raw.windowEnd,
      weekdays: [...new Set(raw.weekdays as number[])],
      endAt: endAt ? new Date(endAt).toISOString() : '',
      timeZone: 'America/Sao_Paulo',
    },
  } };
}
