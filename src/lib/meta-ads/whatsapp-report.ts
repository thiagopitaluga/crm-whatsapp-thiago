import type { ServiceMetrics, OrganicReport } from './report-service-metrics';
import type { MetaInsightRow } from './dashboard';

export type MetaReportFrequency = 'weekly' | 'monthly';

export type MetaReportPeriod = {
  periodKey: string;
  from: string;
  to: string;
  comparisonFrom: string;
  comparisonTo: string;
};

export type MetaReportMetrics = {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  formLeads: number;
  formLeadSpend: number;
  formCpl: number | null;
  whatsappConversations: number;
  opportunities: number;
  costPerOpportunity: number | null;
};

const WHATSAPP_CONVERSATION_ACTION =
  'onsite_conversion.messaging_conversation_started_7d';

function dateAtUtc(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function zonedParts(now: Date, timeZone: string) {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(values.find((item) => item.type === type)?.value ?? 0);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
  };
}

/** Returns the most recent fully completed report period whose 08:00 run is due. */
export function latestMetaReportPeriod(
  frequency: MetaReportFrequency,
  now = new Date(),
  timeZone = 'America/Sao_Paulo',
  sendHour = 8
): MetaReportPeriod {
  const local = zonedParts(now, timeZone);
  const today = new Date(Date.UTC(local.year, local.month - 1, local.day));

  if (frequency === 'weekly') {
    const daysSinceMonday = (today.getUTCDay() + 6) % 7;
    let scheduledMonday = addDays(today, -daysSinceMonday);
    if (daysSinceMonday === 0 && local.hour < sendHour)
      scheduledMonday = addDays(scheduledMonday, -7);
    const from = addDays(scheduledMonday, -7);
    const to = addDays(scheduledMonday, -1);
    return {
      periodKey: `weekly:${isoDate(from)}:${isoDate(to)}`,
      from: isoDate(from),
      to: isoDate(to),
      comparisonFrom: isoDate(addDays(from, -7)),
      comparisonTo: isoDate(addDays(to, -7)),
    };
  }

  let scheduledMonth = new Date(Date.UTC(local.year, local.month - 1, 1));
  if (local.day === 1 && local.hour < sendHour) {
    scheduledMonth = new Date(
      Date.UTC(
        scheduledMonth.getUTCFullYear(),
        scheduledMonth.getUTCMonth() - 1,
        1
      )
    );
  }
  const from = new Date(
    Date.UTC(
      scheduledMonth.getUTCFullYear(),
      scheduledMonth.getUTCMonth() - 1,
      1
    )
  );
  const to = addDays(scheduledMonth, -1);
  const comparisonFrom = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - 1, 1)
  );
  return {
    periodKey: `monthly:${isoDate(from)}:${isoDate(to)}`,
    from: isoDate(from),
    to: isoDate(to),
    comparisonFrom: isoDate(comparisonFrom),
    comparisonTo: isoDate(addDays(from, -1)),
  };
}

function number(value: number | string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function actionValue(row: MetaInsightRow, actionType: string) {
  if (!Array.isArray(row.actions)) return 0;
  return row.actions.reduce((total, item) => {
    if (!item || typeof item !== 'object') return total;
    const action = item as Record<string, unknown>;
    if (action.action_type !== actionType) return total;
    return total + number(action.value as number | string);
  }, 0);
}

function inRange(row: MetaInsightRow, from: string, to: string) {
  return row.report_date >= from && row.report_date <= to;
}

/**
 * Campaign IDs that produced a native Meta lead in either compared period are
 * treated as form campaigns. This includes spend from their zero-lead ads, so
 * CPL is not artificially reduced by looking only at converting rows.
 */
export function calculateMetaReportMetrics(
  allRows: MetaInsightRow[],
  from: string,
  to: string,
  comparisonFrom: string,
  comparisonTo: string
): { current: MetaReportMetrics; previous: MetaReportMetrics } {
  const comparedRows = allRows.filter(
    (row) =>
      inRange(row, from, to) || inRange(row, comparisonFrom, comparisonTo)
  );
  const formCampaigns = new Set(
    comparedRows
      .filter((row) => number(row.reported_leads) > 0 && row.campaign_id)
      .map((row) => row.campaign_id as string)
  );

  const aggregate = (rangeFrom: string, rangeTo: string): MetaReportMetrics => {
    const rows = comparedRows.filter((row) => inRange(row, rangeFrom, rangeTo));
    const spend = rows.reduce((sum, row) => sum + number(row.spend), 0);
    const impressions = rows.reduce(
      (sum, row) => sum + number(row.impressions),
      0
    );
    const clicks = rows.reduce((sum, row) => sum + number(row.clicks), 0);
    const formLeads = rows.reduce(
      (sum, row) => sum + number(row.reported_leads),
      0
    );
    const formLeadSpend = rows
      .filter((row) => row.campaign_id && formCampaigns.has(row.campaign_id))
      .reduce((sum, row) => sum + number(row.spend), 0);
    const whatsappConversations = rows.reduce(
      (sum, row) => sum + actionValue(row, WHATSAPP_CONVERSATION_ACTION),
      0
    );
    const opportunities = formLeads + whatsappConversations;
    return {
      spend,
      impressions,
      clicks,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      formLeads,
      formLeadSpend,
      formCpl: formLeads > 0 ? formLeadSpend / formLeads : null,
      whatsappConversations,
      opportunities,
      costPerOpportunity: opportunities > 0 ? spend / opportunities : null,
    };
  };

  return {
    current: aggregate(from, to),
    previous: aggregate(comparisonFrom, comparisonTo),
  };
}

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(value: number | null) {
  return value === null ? '—' : `R$ ${decimal.format(value)}`;
}

function percentChange(current: number | null, previous: number | null) {
  const left = current ?? 0;
  const right = previous ?? 0;
  if (left === 0 && right === 0) return '0%';
  if (right === 0) return '▲100%';
  const change = ((left - right) / right) * 100;
  if (Math.abs(change) < 0.005) return '0%';
  return `${change > 0 ? '▲' : '▼'}${decimal.format(Math.abs(change))}%`;
}

function periodLabel(from: string, to: string) {
  const format = (value: string) => {
    const [, month, day] = value.split('-');
    return `${day}/${month}`;
  };
  return `${format(from)} a ${format(to)}`;
}

export function renderMetaWhatsAppReport(input: {
  recipientName: string;
  accountName?: string;
  service?: ServiceMetrics | null;
  organic?: OrganicReport;
  frequency: MetaReportFrequency;
  period: MetaReportPeriod;
  current: MetaReportMetrics;
  previous: MetaReportMetrics;
}) {
  const previousLabel =
    input.frequency === 'weekly' ? 'semana anterior' : 'mês anterior';
  const line = (
    label: string,
    currentText: string,
    previousText: string,
    currentValue: number | null,
    previousValue: number | null
  ) =>
    `• ${label}: ${currentText} (${previousLabel}: ${previousText}, ${percentChange(currentValue, previousValue)})`;
  const current = input.current;
  const previous = input.previous;
  const heading =
    input.frequency === 'weekly'
      ? `Bom dia, ${input.recipientName}! Segue o resumo do Meta Ads da última semana:`
      : `Bom dia, ${input.recipientName}! Segue o resumo mensal do Meta Ads:`;

  return [
    heading,
    '',
    `*${input.frequency === 'weekly' ? 'Resumo da sua semana' : 'Resumo do mês'} — ${input.accountName || input.recipientName}*`,
    `📅 ${periodLabel(input.period.from, input.period.to)}`,
    '',
    `No período, foram registradas ${integer.format(current.opportunities)} oportunidades com investimento de ${money(current.spend)}.`,
    '',
    '*📱 Meta Ads (Instagram/Facebook)*',
    line(
      'Investimento',
      money(current.spend),
      money(previous.spend),
      current.spend,
      previous.spend
    ),
    line(
      'Impressões',
      integer.format(current.impressions),
      integer.format(previous.impressions),
      current.impressions,
      previous.impressions
    ),
    line(
      'Cliques',
      integer.format(current.clicks),
      integer.format(previous.clicks),
      current.clicks,
      previous.clicks
    ),
    line(
      'CTR',
      `${decimal.format(current.ctr)}%`,
      `${decimal.format(previous.ctr)}%`,
      current.ctr,
      previous.ctr
    ),
    `• Custo por clique: ${money(current.clicks ? current.spend / current.clicks : null)}`,
    line(
      'Leads de formulário',
      integer.format(current.formLeads),
      integer.format(previous.formLeads),
      current.formLeads,
      previous.formLeads
    ),
    line(
      'Custo por lead de formulário',
      money(current.formCpl),
      money(previous.formCpl),
      current.formCpl,
      previous.formCpl
    ),
    line(
      'Conversas no WhatsApp',
      integer.format(current.whatsappConversations),
      integer.format(previous.whatsappConversations),
      current.whatsappConversations,
      previous.whatsappConversations
    ),
    line(
      'Total de oportunidades',
      integer.format(current.opportunities),
      integer.format(previous.opportunities),
      current.opportunities,
      previous.opportunities
    ),
    line(
      'Custo por oportunidade',
      money(current.costPerOpportunity),
      money(previous.costPerOpportunity),
      current.costPerOpportunity,
      previous.costPerOpportunity
    ),
    ...renderSupplement(input.service, input.organic),
  ].join('\n');
}

function renderSupplement(
  service?: ServiceMetrics | null,
  organic?: OrganicReport
) {
  const value = (n: number | null | undefined) =>
    n === null || n === undefined ? 'Não disponível' : integer.format(n);
  const lines = ['', '*📸 Instagram (orgânico)*'];
  if (!organic?.connected) lines.push('Instagram não conectado.');
  else {
    for (const profile of organic.profiles)
      lines.push(
        '@' + profile.name,
        '• Total de seguidores (atual): ' + value(profile.followers),
        '• Seguidores no período: ' +
          (profile.growth === null
            ? 'Não disponível'
            : (profile.growth >= 0 ? '+' : '') + value(profile.growth)),
        '• Taxa de engajamento (interações/alcance): ' +
          (profile.engagementRate === null
            ? 'Não disponível'
            : decimal.format(profile.engagementRate) + '%'),
        '• Interações: ' + value(profile.interactions),
        '• Publicações no período: ' + value(profile.posts),
        '• Alcance no Instagram: ' + value(profile.reach),
        '• Visitas ao perfil: ' + value(profile.visits)
      );
    if (organic.error || !organic.profiles.length)
      lines.push(
        'Não foi possível consultar todas as métricas do Instagram neste período.'
      );
  }
  lines.push('', '*💬 Atendimento no WhatsApp*');
  if (!service)
    lines.push('Dados de atendimento indisponíveis para este período.');
  else
    lines.push(
      '• Conversas recebidas: ' + value(service.received),
      '• Respondidas: ' +
        value(service.replied) +
        ' de ' +
        value(service.received) +
        (service.received
          ? ' (' +
            decimal.format((service.replied / service.received) * 100) +
            '%)'
          : ''),
      '• Tempo médio até a 1ª resposta: ' +
        (service.averageSeconds === null
          ? 'Não disponível'
          : service.averageSeconds < 60
            ? Math.round(service.averageSeconds) + 's'
            : service.averageSeconds < 3600
              ? decimal.format(service.averageSeconds / 60) + 'min'
              : decimal.format(service.averageSeconds / 3600) + 'h'),
      '• Respondidas em até 5 minutos: ' + value(service.withinFiveMinutes),
      '• Respondidas na 1ª hora: ' +
        value(service.withinHour) +
        ' de ' +
        value(service.received),
      '• Sem resposta até o fim do período: ' + value(service.unanswered)
    );
  return lines;
}
