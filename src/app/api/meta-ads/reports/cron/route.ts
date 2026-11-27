import { loadReportContext } from '@/lib/meta-ads/report-context';
import { serviceEnabled } from '@/lib/billing/server-access';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { MetaGraphReadClient } from '@/lib/meta-ads/graph-client';
import { syncMetaAdsRange } from '@/lib/meta-ads/sync';
import type { MetaInsightRow } from '@/lib/meta-ads/dashboard';
import {
  calculateMetaReportMetrics,
  latestMetaReportPeriod,
  renderMetaWhatsAppReport,
  type MetaReportFrequency,
  type MetaReportPeriod,
} from '@/lib/meta-ads/whatsapp-report';
import { decrypt } from '@/lib/whatsapp/encryption';
import { fetchQrConnector } from '@/lib/whatsapp/qr-connector';

export const runtime = 'nodejs';
export const maxDuration = 120;

type Schedule = {
  id: string;
  account_id: string;
  integration_id: string;
  sender_account_id: string;
  sender_channel_id: string;
  target_group_jid: string;
  target_group_name: string;
  recipient_name: string;
  frequency: MetaReportFrequency;
  timezone: string;
  send_hour: number;
};

type Delivery = {
  id: string;
  status: 'sending' | 'sent' | 'failed' | 'uncertain';
  attempt_count: number;
  attempted_at: string;
};

function authorized(request: Request) {
  const expected =
    process.env.CRON_SECRET ?? process.env.AUTOMATION_CRON_SECRET ?? '';
  const supplied =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    request.headers.get('x-cron-secret') ??
    '';
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return (
    expected.length > 0 &&
    left.length === right.length &&
    timingSafeEqual(left, right)
  );
}

async function claimDelivery(schedule: Schedule, period: MetaReportPeriod) {
  const db = supabaseAdmin();
  const now = new Date();
  const row = {
    schedule_id: schedule.id,
    period_key: period.periodKey,
    period_from: period.from,
    period_to: period.to,
    comparison_from: period.comparisonFrom,
    comparison_to: period.comparisonTo,
    status: 'sending',
    attempt_count: 1,
    attempted_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  const { data: inserted, error: insertError } = await db
    .from('meta_ads_whatsapp_report_deliveries')
    .insert(row)
    .select('id,status,attempt_count,attempted_at')
    .maybeSingle();
  if (!insertError && inserted) return inserted as Delivery;
  if (insertError?.code !== '23505') throw insertError;

  const { data, error } = await db
    .from('meta_ads_whatsapp_report_deliveries')
    .select('id,status,attempt_count,attempted_at')
    .eq('schedule_id', schedule.id)
    .eq('period_key', period.periodKey)
    .maybeSingle();
  if (error) throw error;
  const existing = data as Delivery | null;
  if (
    !existing ||
    existing.status === 'sent' ||
    existing.status === 'uncertain'
  )
    return null;
  const retryAfter =
    existing.status === 'sending' ? 15 * 60_000 : 6 * 60 * 60_000;
  if (
    existing.attempt_count >= 10 ||
    Date.parse(existing.attempted_at) + retryAfter > now.getTime()
  )
    return null;
  const { data: claimed, error: claimError } = await db
    .from('meta_ads_whatsapp_report_deliveries')
    .update({
      status: 'sending',
      attempt_count: existing.attempt_count + 1,
      attempted_at: now.toISOString(),
      updated_at: now.toISOString(),
      error_message: null,
    })
    .eq('id', existing.id)
    .eq('status', existing.status)
    .eq('attempted_at', existing.attempted_at)
    .select('id,status,attempt_count,attempted_at')
    .maybeSingle();
  if (claimError) throw claimError;
  return (claimed as Delivery | null) ?? null;
}

async function syncReportRange(schedule: Schedule, period: MetaReportPeriod) {
  const db = supabaseAdmin();
  const { data: integration, error: integrationError } = await db
    .from('meta_ad_account_integrations')
    .select('id,meta_ad_account_id,is_active,ads_read_granted')
    .eq('id', schedule.integration_id)
    .eq('account_id', schedule.account_id)
    .maybeSingle();
  if (integrationError) throw integrationError;
  if (!integration?.is_active || !integration.ads_read_granted)
    throw new Error('A integração Meta Ads não está ativa.');
  const { data: credential, error: credentialError } = await db
    .from('meta_ads_credentials')
    .select('access_token_encrypted,token_expires_at,sync_lock_until')
    .eq('integration_id', schedule.integration_id)
    .eq('account_id', schedule.account_id)
    .maybeSingle();
  if (credentialError) throw credentialError;
  if (!credential || Date.parse(credential.token_expires_at) <= Date.now())
    throw new Error('A autorização da Meta expirou.');

  const lease = new Date(Date.now() + 4 * 60_000).toISOString();
  const { data: locked, error: lockError } = await db
    .from('meta_ads_credentials')
    .update({ sync_lock_until: lease })
    .eq('integration_id', schedule.integration_id)
    .eq('account_id', schedule.account_id)
    .lt('sync_lock_until', new Date().toISOString())
    .select('integration_id')
    .maybeSingle();
  if (lockError) throw lockError;
  if (!locked) throw new Error('A sincronização da Meta já está em andamento.');
  try {
    const graph = new MetaGraphReadClient({
      accessToken: decrypt(credential.access_token_encrypted),
      version: process.env.META_ADS_GRAPH_VERSION?.trim() || 'v26.0',
    });
    await syncMetaAdsRange(
      db,
      graph,
      schedule.account_id,
      integration.meta_ad_account_id,
      period.comparisonFrom,
      period.to
    );
    return integration.meta_ad_account_id as string;
  } finally {
    await db
      .from('meta_ads_credentials')
      .update({ sync_lock_until: new Date().toISOString() })
      .eq('integration_id', schedule.integration_id)
      .eq('account_id', schedule.account_id)
      .eq('sync_lock_until', lease);
  }
}

async function processSchedule(schedule: Schedule) {
  const db = supabaseAdmin();
  if (
    !(await serviceEnabled(db, schedule.account_id, 'metaAds')) ||
    !(await serviceEnabled(db, schedule.sender_account_id, 'groupAutomation'))
  )
    return { scheduleId: schedule.id, disabled: true };
  const period = latestMetaReportPeriod(
    schedule.frequency,
    new Date(),
    schedule.timezone,
    schedule.send_hour
  );
  const delivery = await claimDelivery(schedule, period);
  if (!delivery)
    return {
      scheduleId: schedule.id,
      frequency: schedule.frequency,
      skipped: true,
    };

  try {
    const adAccountId = await syncReportRange(schedule, period);
    const { data: rows, error: rowsError } = await db
      .from('meta_ads_daily_insights')
      .select(
        'report_date,meta_ad_account_id,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,currency,spend,impressions,clicks,link_clicks,reported_leads,actions'
      )
      .eq('account_id', schedule.account_id)
      .eq('meta_ad_account_id', adAccountId)
      .gte('report_date', period.comparisonFrom)
      .lte('report_date', period.to);
    if (rowsError) throw rowsError;
    const metrics = calculateMetaReportMetrics(
      (rows ?? []) as MetaInsightRow[],
      period.from,
      period.to,
      period.comparisonFrom,
      period.comparisonTo
    );
    const context = await loadReportContext(db, schedule.account_id, period);
    const message = renderMetaWhatsAppReport({
      ...context,
      recipientName: schedule.recipient_name,
      frequency: schedule.frequency,
      period,
      ...metrics,
    });
    const { data: channel, error: channelError } = await db
      .from('whatsapp_channels')
      .select('provider,channel_key,evolution_instance_name')
      .eq('id', schedule.sender_channel_id)
      .eq('account_id', schedule.sender_account_id)
      .maybeSingle();
    if (channelError) throw channelError;
    if (channel?.provider !== 'evolution' || !channel.evolution_instance_name)
      throw new Error(
        'O WhatsApp remetente não é uma conexão Evolution ativa.'
      );

    let response: Response;
    try {
      response = await fetchQrConnector(
        schedule.sender_account_id,
        'groups/send',
        {
          method: 'POST',
          body: JSON.stringify({
            text: message,
            group_ids: [schedule.target_group_jid],
            kind: 'text',
          }),
          signal: AbortSignal.timeout(30_000),
        },
        {
          instanceName: channel.evolution_instance_name,
          channelKey: channel.channel_key,
        }
      );
    } catch (cause) {
      await db
        .from('meta_ads_whatsapp_report_deliveries')
        .update({
          status: 'uncertain',
          message_text: message,
          metrics,
          error_message:
            cause instanceof Error
              ? `Entrega incerta: ${cause.message}`
              : 'Entrega incerta: resposta não recebida.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', delivery.id);
      return {
        scheduleId: schedule.id,
        frequency: schedule.frequency,
        uncertain: true,
      };
    }
    const payload = (await response.json().catch(() => null)) as {
      results?: Array<{
        status?: string;
        message_id?: string;
        error?: string;
      }>;
      error?: string;
    } | null;
    const result = payload?.results?.[0];
    if (!response.ok || result?.status !== 'sent')
      throw new Error(
        result?.error ??
          payload?.error ??
          `Evolution retornou ${response.status}.`
      );
    await db
      .from('meta_ads_whatsapp_report_deliveries')
      .update({
        status: 'sent',
        message_text: message,
        metrics,
        whatsapp_message_id: result.message_id ?? null,
        error_message: null,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', delivery.id);
    return {
      scheduleId: schedule.id,
      frequency: schedule.frequency,
      sent: true,
    };
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : 'Não foi possível gerar o relatório.';
    await db
      .from('meta_ads_whatsapp_report_deliveries')
      .update({
        status: 'failed',
        error_message: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq('id', delivery.id);
    return {
      scheduleId: schedule.id,
      frequency: schedule.frequency,
      error: message,
    };
  }
}

export async function GET(request: Request) {
  if (!authorized(request))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('meta_ads_whatsapp_report_schedules')
    .select(
      'id,account_id,integration_id,sender_account_id,sender_channel_id,target_group_jid,target_group_name,recipient_name,frequency,timezone,send_hour'
    )
    .eq('enabled', true)
    .lte('starts_at', new Date().toISOString())
    .order('frequency');
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  const results = [];
  for (const schedule of (data ?? []) as Schedule[])
    results.push(await processSchedule(schedule));
  return NextResponse.json({ processed: results.length, results });
}
