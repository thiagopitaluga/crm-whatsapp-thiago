const idPattern = /^\d{5,32}$/;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function id(value: unknown): string | null {
  const candidate = string(value);
  return candidate && idPattern.test(candidate) ? candidate : null;
}

function nonnegative(value: unknown): number {
  const number =
    typeof value === 'number' || typeof value === 'string'
      ? Number(value)
      : NaN;
  if (!Number.isFinite(number) || number < 0)
    throw new Error('Invalid Meta insight metric');
  return number;
}

export function normalizeMetaInsight(
  raw: Record<string, unknown>,
  accountId: string,
  metaAdAccountId: string
) {
  const adId = id(raw.ad_id);
  const reportDate = string(raw.date_start);
  const currency = string(raw.account_currency) ?? 'BRL';
  if (
    !adId ||
    !reportDate ||
    !/^\d{4}-\d{2}-\d{2}$/.test(reportDate) ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    throw new Error('Meta insight is missing an ad, date, or currency');
  }
  const actions = Array.isArray(raw.actions)
    ? raw.actions.filter((entry) => object(entry))
    : [];
  // Meta can describe the same lead under more than one action type. Use one
  // preferred action rather than summing aliases and inflating conversion.
  const reportedLeads = [
    'onsite_conversion.lead_grouped',
    'lead',
    'offsite_conversion.fb_pixel_lead',
  ]
    .map((type) => actions.find((entry) => object(entry)?.action_type === type))
    .find(Boolean);
  const leadAction = reportedLeads ? object(reportedLeads) : null;
  return {
    account_id: accountId,
    meta_ad_account_id: metaAdAccountId,
    report_date: reportDate,
    ad_id: adId,
    ad_name: string(raw.ad_name) ?? '',
    adset_id: id(raw.adset_id),
    adset_name: string(raw.adset_name) ?? '',
    campaign_id: id(raw.campaign_id),
    campaign_name: string(raw.campaign_name) ?? '',
    currency,
    spend: nonnegative(raw.spend ?? 0),
    impressions: nonnegative(raw.impressions ?? 0),
    reach: nonnegative(raw.reach ?? 0),
    clicks: nonnegative(raw.clicks ?? 0),
    link_clicks: nonnegative(raw.inline_link_clicks ?? 0),
    reported_leads: leadAction ? nonnegative(leadAction.value ?? 0) : 0,
    actions,
    synced_at: new Date().toISOString(),
  };
}

export function normalizeMetaLead(raw: Record<string, unknown>) {
  const leadId = id(raw.id);
  const formId = id(raw.form_id);
  if (!leadId || !formId)
    throw new Error('Meta lead is missing its unique lead or form ID');
  const fields: Record<string, string> = {};
  for (const item of Array.isArray(raw.field_data) ? raw.field_data : []) {
    const row = object(item);
    const name = string(row?.name);
    const values = Array.isArray(row?.values)
      ? row.values.filter(
          (value): value is string =>
            typeof value === 'string' && Boolean(value.trim())
        )
      : [];
    if (name && values.length) fields[name] = values.join(', ');
  }
  const created = string(raw.created_time);
  if (created && Number.isNaN(Date.parse(created)))
    throw new Error('Meta lead has an invalid creation time');
  return {
    leadId,
    formId,
    adId: id(raw.ad_id),
    submittedAt: created,
    fields,
    name: fields.full_name ?? fields.nome_completo ?? fields.name ?? null,
    phone: fields.phone_number ?? fields.telefone ?? fields.phone ?? null,
    email: fields.email ?? null,
    company: fields.company_name ?? fields.nome_da_empresa ?? null,
  };
}

