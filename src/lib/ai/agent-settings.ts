export type AiAgentSettings = {
  name: string;
  persona: string;
  objective: string;
  tone: string;
  closingStyle: string;
  negotiationMode: string;
  responseModel: string;
  maxTokens: number;
  creativity: number;
  responseSpeed: 'automatic' | 'fast' | 'normal' | 'slow' | 'custom';
  customResponseDelayMs: number;
  splitMessages: boolean;
  charactersPerBlock: number;
  pauseBetweenBlocksMs: number;
  confirmReadBeforeReply: boolean;
  vocabulary: string;
  realExamples: string;
  houseStyle: string;
  permittedTopics: string;
  initialGreeting: string;
  objectionResponses: string;
  qualificationQuestions: string;
  emotionalTriggers: string;
  behaviorInstructions: string;
  prohibitedTopics: string;
  handoffRules: string;
  enabledChannels: string[];
  inboundEnabled: boolean;
  firstMessageOnly: boolean;
  triggerKeywords: string[];
  followUpEnabled: boolean;
  followUpDelaysHours: number[];
  followUpInstructions: string;
  followUpWindowEnabled: boolean;
  followUpWindowStart: string;
  followUpWindowEnd: string;
  followUpWeekdays: number[];
  autoTrainingEnabled: boolean;
  trainingRequiresApproval: boolean;
  autoTrainingInstructions: string;
};

export const DEFAULT_AI_AGENT_SETTINGS: AiAgentSettings = {
  name: 'Assistente virtual',
  persona: '',
  objective: '',
  tone: 'Consultivo',
  closingStyle: 'consultative',
  negotiationMode: 'none',
  responseModel: '',
  maxTokens: 500,
  creativity: 0.3,
  responseSpeed: 'automatic',
  customResponseDelayMs: 2500,
  splitMessages: true,
  charactersPerBlock: 280,
  pauseBetweenBlocksMs: 800,
  confirmReadBeforeReply: false,
  vocabulary: '',
  realExamples: '',
  houseStyle: '',
  permittedTopics: '',
  initialGreeting: '',
  objectionResponses: '',
  qualificationQuestions: '',
  emotionalTriggers: '',
  behaviorInstructions: '',
  prohibitedTopics: '',
  handoffRules:
    'Quando pedirem para falar com uma pessoa, quando houver reclamação ou quando faltar informação segura.',
  enabledChannels: ['whatsapp_cloud', 'whatsapp_evolution'],
  inboundEnabled: true,
  firstMessageOnly: false,
  triggerKeywords: [],
  followUpEnabled: false,
  followUpDelaysHours: [24, 72],
  followUpInstructions: '',
  followUpWindowEnabled: false,
  followUpWindowStart: '08:00',
  followUpWindowEnd: '20:00',
  followUpWeekdays: [0, 1, 2, 3, 4, 5, 6],
  autoTrainingEnabled: false,
  trainingRequiresApproval: true,
  autoTrainingInstructions: '',
};

function text(value: unknown, max: number, fallback: string): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : fallback;
}

function lines(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim().slice(0, maxLength))
        .filter(Boolean)
    ),
  ].slice(0, maxItems);
}

export function normalizeAiAgentSettings(value: unknown): AiAgentSettings {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const validChannel = (channel: string) => /^(whatsapp_cloud|whatsapp_evolution)(:[a-zA-Z0-9-]{1,80})?$/.test(channel);
  const delays = Array.isArray(source.followUpDelaysHours)
    ? source.followUpDelaysHours
        .map(Number)
        .filter((hour) => Number.isInteger(hour) && hour >= 1 && hour <= 8760)
        .slice(0, 5)
    : DEFAULT_AI_AGENT_SETTINGS.followUpDelaysHours;

  return {
    name:
      text(source.name, 80, DEFAULT_AI_AGENT_SETTINGS.name) ||
      DEFAULT_AI_AGENT_SETTINGS.name,
    persona: text(source.persona, 4000, ''),
    objective: text(source.objective, 2000, ''),
    tone: ['Formal', 'Consultivo', 'Casual', 'Direto'].includes(String(source.tone)) ? String(source.tone) : DEFAULT_AI_AGENT_SETTINGS.tone,
    closingStyle: ['direct', 'consultative', 'urgency', 'gentle'].includes(String(source.closingStyle)) ? String(source.closingStyle) : DEFAULT_AI_AGENT_SETTINGS.closingStyle,
    negotiationMode: ['none', 'fixed_discount', 'strategic'].includes(String(source.negotiationMode)) ? String(source.negotiationMode) : DEFAULT_AI_AGENT_SETTINGS.negotiationMode,
    responseModel: text(source.responseModel, 160, ''),
    maxTokens: Math.min(8192, Math.max(1, Math.floor(Number(source.maxTokens) || DEFAULT_AI_AGENT_SETTINGS.maxTokens))),
    creativity: Math.min(1, Math.max(0, Number.isFinite(Number(source.creativity)) ? Number(source.creativity) : DEFAULT_AI_AGENT_SETTINGS.creativity)),
    responseSpeed: ['automatic', 'fast', 'normal', 'slow', 'custom'].includes(String(source.responseSpeed)) ? source.responseSpeed as AiAgentSettings['responseSpeed'] : 'automatic',
    customResponseDelayMs: Math.min(30000, Math.max(0, Math.floor(Number.isFinite(Number(source.customResponseDelayMs)) ? Number(source.customResponseDelayMs) : DEFAULT_AI_AGENT_SETTINGS.customResponseDelayMs))),
    splitMessages: source.splitMessages !== false,
    charactersPerBlock: Math.min(1000, Math.max(80, Math.floor(Number(source.charactersPerBlock) || 280))),
    pauseBetweenBlocksMs: Math.min(10000, Math.max(0, Math.floor(Number.isFinite(Number(source.pauseBetweenBlocksMs)) ? Number(source.pauseBetweenBlocksMs) : 800))),
    confirmReadBeforeReply: source.confirmReadBeforeReply === true,
    vocabulary: text(source.vocabulary, 4000, ''),
    realExamples: text(source.realExamples, 8000, ''),
    houseStyle: text(source.houseStyle, 4000, ''),
    permittedTopics: text(source.permittedTopics, 4000, ''),
    initialGreeting: text(source.initialGreeting, 2000, ''),
    objectionResponses: text(source.objectionResponses, 8000, ''),
    qualificationQuestions: text(source.qualificationQuestions, 4000, ''),
    emotionalTriggers: text(source.emotionalTriggers, 4000, ''),
    behaviorInstructions: text(source.behaviorInstructions, 8000, ''),
    prohibitedTopics: text(source.prohibitedTopics, 4000, ''),
    handoffRules: text(
      source.handoffRules,
      4000,
      DEFAULT_AI_AGENT_SETTINGS.handoffRules
    ),
    enabledChannels: lines(source.enabledChannels, 30, 120).filter(validChannel),
    inboundEnabled: source.inboundEnabled !== false,
    firstMessageOnly: source.firstMessageOnly === true,
    triggerKeywords: lines(source.triggerKeywords, 50, 100),
    followUpEnabled: source.followUpEnabled === true,
    followUpDelaysHours: delays.sort((a, b) => a - b),
    followUpInstructions: text(source.followUpInstructions, 4000, ''),
    followUpWindowEnabled: source.followUpWindowEnabled === true,
    followUpWindowStart: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(source.followUpWindowStart ?? '')) ? String(source.followUpWindowStart) : '08:00',
    followUpWindowEnd: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(source.followUpWindowEnd ?? '')) ? String(source.followUpWindowEnd) : '20:00',
    followUpWeekdays: Array.isArray(source.followUpWeekdays) ? [...new Set(source.followUpWeekdays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))] : [0, 1, 2, 3, 4, 5, 6],
    autoTrainingEnabled: source.autoTrainingEnabled === true,
    trainingRequiresApproval: source.trainingRequiresApproval !== false,
    autoTrainingInstructions: text(source.autoTrainingInstructions, 4000, ''),
  };
}

export function validateAiAgentSettings(
  settings: AiAgentSettings
): string | null {
  if (!settings.name.trim()) return 'Informe um nome para o agente.';
  if (settings.followUpEnabled && settings.followUpDelaysHours.length === 0)
    return 'Defina pelo menos um intervalo para o follow-up.';
  if (settings.followUpEnabled && settings.followUpWindowEnabled && settings.followUpWeekdays.length === 0)
    return 'Selecione pelo menos um dia permitido para os follow-ups.';
  if (settings.followUpEnabled && settings.followUpWindowEnabled && settings.followUpWindowStart >= settings.followUpWindowEnd)
    return 'O fim da janela de follow-up deve ser depois do início.';
  return null;
}

export function aiChannelsOverlap(left: string, right: string): boolean {
  if (left === right) return true;
  const leftFamily = left.split(':', 1)[0];
  const rightFamily = right.split(':', 1)[0];
  return leftFamily === rightFamily && (!left.includes(':') || !right.includes(':'));
}
