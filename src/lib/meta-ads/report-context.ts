import type { SupabaseClient } from '@supabase/supabase-js';
import {
  readInstagramChannels,
  readInstagramInsights,
} from '@/lib/instagram/read-api';
import {
  calculateServiceMetrics,
  type OrganicReport,
  type ServiceMessage,
} from './report-service-metrics';
import type { MetaReportPeriod } from './whatsapp-report';
export async function loadReportContext(
  db: SupabaseClient,
  accountId: string,
  period: MetaReportPeriod
) {
  const from = new Date(`${period.from}T00:00:00-03:00`),
    until = new Date(`${period.to}T00:00:00-03:00`);
  until.setUTCDate(until.getUTCDate() + 1);
  const [account, messages, channels] = await Promise.all([
    db.from('accounts').select('name').eq('id', accountId).maybeSingle(),
    readServiceMessages(db, accountId, from, until),
    readInstagramChannels(db, accountId),
  ]);
  const organic: OrganicReport = {
    connected: channels.length > 0,
    profiles: [],
  };
  await Promise.all(
    channels.map(async (channel) => {
      try {
        const insight = await readInstagramInsights(
          channel,
          Math.ceil((until.getTime() - from.getTime()) / 86400000),
          {
            since: Math.floor(from.getTime() / 1000),
            until: Math.floor(until.getTime() / 1000),
          }
        );
        organic.profiles.push({
          name: insight.profile.username || channel.username,
          followers:
            typeof insight.profile.followers_count === 'number'
              ? insight.profile.followers_count
              : null,
          growth: insight.netGrowth,
          engagementRate: insight.engagementRate,
          interactions: insight.metrics.total_interactions,
          posts: insight.posts,
          reach: insight.metrics.reach,
          visits: insight.metrics.profile_views,
        });
      } catch {
        organic.error = true;
      }
    })
  );
  return {
    accountName: account.data?.name || undefined,
    organic,
    service: messages ? calculateServiceMetrics(messages) : null,
  };
}

async function readServiceMessages(
  db: SupabaseClient,
  accountId: string,
  from: Date,
  until: Date
): Promise<ServiceMessage[] | null> {
  const messages: ServiceMessage[] = [];
  for (let offset = 0; offset < 10000; offset += 1000) {
    const result = await db
      .from('messages')
      .select(
        'id,conversation_id,sender_type,created_at,conversations!inner(account_id)'
      )
      .eq('conversations.account_id', accountId)
      .gte('created_at', from.toISOString())
      .lt('created_at', until.toISOString())
      .order('created_at')
      .order('id')
      .range(offset, offset + 999);
    if (result.error) return null;
    messages.push(...((result.data ?? []) as ServiceMessage[]));
    if ((result.data?.length ?? 0) < 1000) return messages;
  }
  return null; // Do not label a truncated history as a complete report.
}
