import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { ingestSheetLead } from '@/lib/leads/sheet-ingest';
import { MetaGraphReadClient } from './graph-client';
import { normalizeMetaInsight, normalizeMetaLead } from './normalize';

const META_PIPELINE = 'Formulário Meta';
const META_ID = /^\d{5,32}$/;

async function assertIntegration(
  db: SupabaseClient,
  accountId: string,
  adAccountId: string
) {
  const { data, error } = await db
    .from('meta_ad_account_integrations')
    .select('meta_ad_account_id, meta_page_ids, is_active')
    .eq('account_id', accountId)
    .eq('provider', 'meta')
    .eq('meta_ad_account_id', adAccountId)
    .maybeSingle();
  if (error || !data?.is_active)
    throw new Error('Meta ad account is not linked to this CRM account');
  return data as {
    meta_ad_account_id: string;
    meta_page_ids: string[];
    is_active: boolean;
  };
}

/** Explicit server-side entrypoint for the future approved ads_read connection. No scheduler invokes it today. */
export async function syncMetaAdsRange(
  db: SupabaseClient,
  graph: MetaGraphReadClient,
  accountId: string,
  adAccountId: string,
  from: string,
  to: string
) {
  await assertIntegration(db, accountId, adAccountId);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
    from > to
  )
    throw new Error('Invalid Meta report range');
  const raw = await graph.adInsights(adAccountId, from, to);
  const rows = raw.map((item) =>
    normalizeMetaInsight(item, accountId, adAccountId)
  );
  const entityRows: Array<Record<string, string | null>> = [];
  for (const [endpoint, entityType] of [
    ['campaigns', 'campaign'],
    ['adsets', 'adset'],
    ['ads', 'ad'],
  ] as const) {
    const entities = await graph.adEntities(adAccountId, endpoint);
    for (const entity of entities) {
      if (typeof entity.id !== 'string' || !META_ID.test(entity.id))
        throw new Error('Meta returned an entity without a valid ID');
      entityRows.push({
        account_id: accountId,
        meta_ad_account_id: adAccountId,
        entity_type: entityType,
        meta_entity_id: entity.id,
        name: typeof entity.name === 'string' ? entity.name : `ID ${entity.id}`,
        campaign_id:
          typeof entity.campaign_id === 'string' ? entity.campaign_id : null,
        adset_id: typeof entity.adset_id === 'string' ? entity.adset_id : null,
        effective_status:
          typeof entity.effective_status === 'string'
            ? entity.effective_status
            : null,
        objective:
          typeof entity.objective === 'string' ? entity.objective : null,
        updated_at: new Date().toISOString(),
      });
    }
  }
  for (let index = 0; index < entityRows.length; index += 500) {
    const { error } = await db
      .from('meta_ads_entities')
      .upsert(entityRows.slice(index, index + 500), {
        onConflict: 'account_id,meta_ad_account_id,entity_type,meta_entity_id',
      });
    if (error) throw error;
  }
  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await db
      .from('meta_ads_daily_insights')
      .upsert(rows.slice(index, index + 500), {
        onConflict: 'account_id,meta_ad_account_id,report_date,ad_id',
      });
    if (error) throw error;
  }
  const { error } = await db
    .from('meta_ad_account_integrations')
    .update({ ads_last_synced_at: new Date().toISOString(), sync_error: null })
    .eq('account_id', accountId)
    .eq('meta_ad_account_id', adAccountId);
  if (error) throw error;
  return { insightRows: rows.length, entities: entityRows.length };
}

/** Explicit server-side entrypoint for the future leads_retrieval connection. */
export async function syncMetaFormLeads(
  db: SupabaseClient,
  graph: MetaGraphReadClient,
  accountId: string,
  adAccountId: string
) {
  const integration = await assertIntegration(db, accountId, adAccountId);
  let imported = 0;
  let failed = 0;
  for (const pageId of integration.meta_page_ids) {
    const forms = await graph.leadForms(pageId);
    for (const form of forms) {
      const formId = typeof form.id === 'string' ? form.id : '';
      const formName = typeof form.name === 'string' ? form.name : '';
      const rawLeads = await graph.formLeads(formId);
      for (const raw of rawLeads) {
        const lead = normalizeMetaLead({
          ...raw,
          form_id: raw.form_id ?? formId,
        });
        const { data: previous, error: lookupError } = await db
          .from('meta_lead_receipts')
          .select('status')
          .eq('account_id', accountId)
          .eq('meta_lead_id', lead.leadId)
          .maybeSingle();
        if (lookupError) throw lookupError;
        if (previous?.status === 'imported') continue;
        const fields = {
          ...lead.fields,
          id: lead.leadId,
          form_id: lead.formId,
          form_name: formName,
          ad_id: lead.adId ?? '',
          created_time: lead.submittedAt ?? '',
        };
        const { error: receiptError } = await db
          .from('meta_lead_receipts')
          .upsert(
            {
              account_id: accountId,
              meta_lead_id: lead.leadId,
              meta_ad_account_id: adAccountId,
              page_id: pageId,
              form_id: lead.formId,
              ad_id: lead.adId,
              submitted_at: lead.submittedAt,
              fields,
              status: 'received',
              error_message: null,
            },
            { onConflict: 'account_id,meta_lead_id' }
          );
        if (receiptError) throw receiptError;
        try {
          if (!lead.phone)
            throw new Error(
              'Lead has no phone number for CRM contact matching'
            );
          const result = await ingestSheetLead(db, accountId, {
            phone: lead.phone,
            name: lead.name,
            email: lead.email,
            company: lead.company,
            pipeline: META_PIPELINE,
            source: 'meta_api',
            sourceId: lead.leadId,
            formData: fields,
            submittedAt: lead.submittedAt,
          });
          const { error: updateError } = await db
            .from('meta_lead_receipts')
            .update({
              contact_id: result.contactId,
              status: 'imported',
              imported_at: new Date().toISOString(),
              error_message: null,
            })
            .eq('account_id', accountId)
            .eq('meta_lead_id', lead.leadId);
          if (updateError) throw updateError;
          imported++;
        } catch (cause) {
          const message =
            cause instanceof Error ? cause.message : 'Lead import failed';
          const { error: updateError } = await db
            .from('meta_lead_receipts')
            .update({ status: 'failed', error_message: message.slice(0, 500) })
            .eq('account_id', accountId)
            .eq('meta_lead_id', lead.leadId);
          if (updateError) throw updateError;
          failed++;
        }
      }
    }
  }
  const { error } = await db
    .from('meta_ad_account_integrations')
    .update({ leads_last_synced_at: new Date().toISOString() })
    .eq('account_id', accountId)
    .eq('meta_ad_account_id', adAccountId);
  if (error) throw error;
  return { imported, failed };
}

