export const AI_CONDITIONS = {
  appointment: 'Reunião agendada',
  no_show: 'Reunião cancelada ou não comparecimento',
  payment: 'Pagamento informado',
  interest: 'Interesse demonstrado',
  price_objection: 'Objeção de preço',
  silent: 'Sem resposta',
  custom: 'Instrução personalizada',
} as const;
export const META_EVENTS = [
  'Lead',
  'CompleteRegistration',
  'Contact',
  'Schedule',
  'SubmitApplication',
  'InitiateCheckout',
  'AddPaymentInfo',
  'Purchase',
] as const;
export interface StageRule {
  id: string;
  name: string;
  enabled: boolean;
  event: 'entered' | 'no_reply';
  hours: number;
  action: 'message' | 'add_tag';
  value: string;
  transport?: 'cloud' | 'qr';
}
export interface StageSettings {
  ai: {
    enabled: boolean;
    condition: keyof typeof AI_CONDITIONS;
    instruction: string;
    days: number;
  };
  rules: StageRule[];
  email: { recipients: string; subject: string; html: string };
  metaEvent: string;
}
export function defaultStageSettings(): StageSettings {
  return {
    ai: { enabled: false, condition: 'interest', instruction: '', days: 3 },
    rules: [],
    email: { recipients: '', subject: '', html: '' },
    metaEvent: '',
  };
}
export function validateStageSettings(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'Configuração inválida.';
  const s = value as StageSettings;
  if (
    !s.ai ||
    typeof s.ai.enabled !== 'boolean' ||
    !(s.ai.condition in AI_CONDITIONS) ||
    typeof s.ai.instruction !== 'string' ||
    s.ai.instruction.length > 4000 ||
    !Number.isInteger(s.ai.days) ||
    s.ai.days < 1 ||
    s.ai.days > 365
  )
    return 'Condição da IA inválida.';
  if (s.ai.enabled && s.ai.condition === 'custom' && !s.ai.instruction.trim())
    return 'Descreva a condição para a IA.';
  if (!Array.isArray(s.rules) || s.rules.length > 20)
    return 'Use até 20 gatilhos por etapa.';
  const ids = new Set<string>();
  for (const r of s.rules) {
    if (!r || typeof r !== 'object') return 'Revise os campos dos gatilhos.';
    if (
      r.transport !== undefined &&
      r.transport !== 'cloud' &&
      r.transport !== 'qr'
    )
      return 'Canal de envio inválido.';
    if (
      typeof r.id !== 'string' ||
      !/^[\w-]{1,80}$/.test(r.id) ||
      ids.has(r.id) ||
      typeof r.name !== 'string' ||
      !r.name.trim() ||
      r.name.length > 100 ||
      typeof r.enabled !== 'boolean' ||
      !['entered', 'no_reply'].includes(r.event) ||
      !['message', 'add_tag'].includes(r.action) ||
      !Number.isInteger(r.hours) ||
      r.hours < 1 ||
      r.hours > 8760 ||
      typeof r.value !== 'string' ||
      r.value.length > 4000 ||
      (r.enabled && !r.value.trim())
    )
      return 'Revise os campos dos gatilhos.';
    ids.add(r.id);
  }
  if (
    !s.email ||
    Object.values(s.email).some((v) => typeof v !== 'string') ||
    typeof s.email.recipients !== 'string' ||
    typeof s.email.subject !== 'string' ||
    typeof s.email.html !== 'string'
  )
    return 'E-mail inválido.';
  const recipients = s.email.recipients
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (
    recipients.length > 10 ||
    recipients.some((v) => !/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(v)) ||
    s.email.subject.length > 200 ||
    s.email.html.length > 20000
  )
    return 'Revise os destinatários e o conteúdo do e-mail.';
  if (recipients.length && (!s.email.subject.trim() || !s.email.html.trim()))
    return 'Informe assunto e corpo do e-mail.';
  if (
    typeof s.metaEvent !== 'string' ||
    (s.metaEvent && !(META_EVENTS as readonly string[]).includes(s.metaEvent))
  )
    return 'Evento Meta inválido.';
  return null;
}
export function renderStageTemplate(
  template: string,
  values: Record<string, string>,
  html = false
) {
  return template.replace(
    /\{(contact\.(?:name|phone|email)|lead\.(?:stageName|pipelineName))\}/g,
    (_, key: string) => {
      const value = values[key] ?? '';
      return html
        ? value.replace(
            /[&<>"']/g,
            (c) =>
              ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
              })[c]!
          )
        : value;
    }
  );
}
