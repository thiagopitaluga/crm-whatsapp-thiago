import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';

export type InstagramChannel = {
  id: string;
  account_id: string;
  instagram_id: string;
  username: string;
  access_token_encrypted: string;
};
export class InstagramReadApi {
  constructor(private token: string) {}
  async get(path: string, params: Record<string, string> = {}) {
    const url = new URL(`https://graph.instagram.com/v25.0/${path}`);
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.error?.code === 190
          ? 'A autorização do Instagram expirou. Reconecte o perfil em Integração.'
          : `A Meta não liberou esta consulta (código ${data.error?.code ?? response.status}). Verifique as permissões do perfil em Integração.`
      );
    return data;
  }
  async list(path: string, params: Record<string, string> = {}, pages = 3) {
    const rows: Awaited<ReturnType<InstagramReadApi['get']>>[] = [];
    let after: string | undefined;
    for (let page = 0; page < pages; page++) {
      const data = await this.get(path, {
        ...params,
        ...(after ? { after } : {}),
      });
      rows.push(...(data.data ?? []));
      after = data.paging?.next ? data.paging?.cursors?.after : undefined;
      if (!after) break;
    }
    return rows;
  }
}

export async function readInstagramChannels(
  db: SupabaseClient,
  accountId: string
) {
  const { data, error } = await db
    .from('instagram_channels')
    .select('id,account_id,instagram_id,username,access_token_encrypted')
    .eq('account_id', accountId);
  if (error) throw error;
  return (data ?? []) as InstagramChannel[];
}

/** History imports only persist messages; they never enqueue automation. */
export async function syncInstagramInbox(
  db: SupabaseClient,
  channel: InstagramChannel,
  conversationId?: string
) {
  const api = new InstagramReadApi(decrypt(channel.access_token_encrypted));
  let recipient: string | undefined;
  if (conversationId) {
    const { data, error } = await db
      .from('instagram_conversations')
      .select('instagram_user_id')
      .eq('account_id', channel.account_id)
      .eq('channel_id', channel.id)
      .eq('id', conversationId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return;
    recipient = data.instagram_user_id;
  }
  const threads = await api.list(`${channel.instagram_id}/conversations`, {
    platform: 'instagram',
    fields: 'id,participants,updated_time',
    limit: '50',
    ...(recipient ? { user_id: recipient } : {}),
  });
  for (const thread of threads) {
    const participant = thread.participants?.data?.find(
      (person: { id: string }) => person.id !== channel.instagram_id
    );
    if (!participant?.id || (recipient && participant.id !== recipient))
      continue;
    const existing = await db
      .from('instagram_conversations')
      .select('id,profile_data,last_message_at')
      .eq('account_id', channel.account_id)
      .eq('channel_id', channel.id)
      .eq('instagram_user_id', participant.id)
      .maybeSingle();
    if (existing.error) throw existing.error;
    let profile = {
      ...(existing.data?.profile_data ?? {}),
      username: participant.username,
      thread_id: thread.id,
    };
    if (recipient) {
      try {
        profile = {
          ...profile,
          ...(await api.get(participant.id, {
            fields: 'name,username,profile_pic',
          })),
        };
      } catch {
        /* Participants still supply a display username. */
      }
    }
    const last =
      [existing.data?.last_message_at, thread.updated_time]
        .filter(Boolean)
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ??
      new Date().toISOString();
    const saved = await db
      .from('instagram_conversations')
      .upsert(
        {
          account_id: channel.account_id,
          channel_id: channel.id,
          instagram_user_id: participant.id,
          profile_data: profile,
          last_message_at: last,
        },
        { onConflict: 'channel_id,instagram_user_id' }
      )
      .select('id')
      .single();
    if (saved.error) throw saved.error;
    // Fetch messages on demand rather than downloading every inbox on every poll.
    if (!recipient) continue;
    const messages = await api.list(
      `${thread.id}/messages`,
      {
        fields: 'id,created_time,from,to,message,attachments,shares',
        limit: '100',
      },
      5
    );
    const rows = messages
      .filter((m) => m.id)
      .map((m) => ({
        account_id: channel.account_id,
        conversation_id: saved.data.id,
        external_id: m.id,
        direction: m.from?.id === channel.instagram_id ? 'outbound' : 'inbound',
        body:
          m.message ||
          (m.shares?.data?.length ? '[Publicação compartilhada]' : '[Mídia]'),
        metadata: {
          attachments: m.attachments?.data ?? [],
          shares: m.shares?.data ?? [],
        },
        created_at: m.created_time,
      }));
    if (rows.length) {
      const { error } = await db
        .from('instagram_messages')
        .upsert(rows, { onConflict: 'external_id' });
      if (error) throw error;
    }
  }
}

export async function readInstagramInsights(
  channel: InstagramChannel,
  days: number
) {
  const api = new InstagramReadApi(decrypt(channel.access_token_encrypted));
  const until = Math.floor(Date.now() / 1000);
  const since = until - days * 86400;
  const profile = await api.get(channel.instagram_id, {
    fields:
      'id,username,name,profile_picture_url,followers_count,follows_count,media_count',
  });
  const names = [
    'reach',
    'views',
    'accounts_engaged',
    'total_interactions',
    'likes',
    'comments',
    'shares',
    'saves',
    'replies',
    'profile_views',
    'profile_links_taps',
    'follows_and_unfollows',
  ];
  const metrics: Record<string, number | null> = {};
  const unavailable: string[] = [];
  let follows: number | null = null;
  let unfollows: number | null = null;
  await Promise.all(
    names.map(async (metric) => {
      try {
        const result = await api.get(`${channel.instagram_id}/insights`, {
          metric,
          period: 'day',
          metric_type: 'total_value',
          since: String(since),
          until: String(until),
          ...(metric === 'follows_and_unfollows'
            ? { breakdown: 'follow_type' }
            : {}),
        });
        const item = result.data?.[0];
        metrics[metric] =
          typeof item?.total_value?.value === 'number'
            ? item.total_value.value
            : Array.isArray(item?.values)
              ? item.values.reduce(
                  (sum: number, value: { value: number }) =>
                    sum + (typeof value.value === 'number' ? value.value : 0),
                  0
                )
              : null;
        if (metric === 'follows_and_unfollows')
          for (const breakdown of item?.total_value?.breakdowns ?? [])
            for (const row of breakdown.results ?? []) {
              const kind = row.dimension_values?.[0]?.toLowerCase();
              if (kind === 'follow' || kind === 'follows') follows = row.value;
              if (kind === 'unfollow' || kind === 'unfollows')
                unfollows = row.value;
            }
        if (metrics[metric] === null && metric !== 'follows_and_unfollows')
          unavailable.push(metric);
      } catch {
        metrics[metric] = null;
        unavailable.push(metric);
      }
    })
  );
  return {
    channelId: channel.id,
    profile,
    days,
    metrics,
    follows,
    unfollows,
    netGrowth:
      follows !== null && unfollows !== null ? follows - unfollows : null,
    engagementRate:
      metrics.reach && metrics.total_interactions !== null
        ? (metrics.total_interactions / metrics.reach) * 100
        : null,
    unavailable,
  };
}
