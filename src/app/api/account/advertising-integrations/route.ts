import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  RATE_LIMITS,
  rateLimitResponse,
} from '@/lib/rate-limit';

const PROVIDERS = ['meta', 'google_ads'] as const;
type Provider = (typeof PROVIDERS)[number];

const SAFE_COLUMNS =
  'id, provider, external_account_id, manager_account_id, display_name, access_scope, connection_status, credential_ref, is_active, last_sync_at, last_error, created_at, updated_at';

function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value);
}

function normalizeAccountId(provider: Provider, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/[^0-9]/g, '');
  if (provider === 'meta') return /^\d{5,32}$/.test(compact) ? compact : null;
  // Google Ads customer IDs are normally ten digits, displayed as 123-456-7890.
  return /^\d{10}$/.test(compact) ? compact : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, max) : null;
}

/** Read-only configuration and readiness overview for the active CRM. */
export async function GET() {
  try {
    const ctx = await requireRole('admin');
    const [integrationsRes, linksRes, clicksRes, conversationsRes, insightRes] =
      await Promise.all([
        ctx.supabase
          .from('advertising_integrations')
          .select(SAFE_COLUMNS)
          .eq('account_id', ctx.accountId)
          .order('created_at', { ascending: false }),
        ctx.supabase
          .from('campaign_tracking_links')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', ctx.accountId)
          .eq('is_active', true),
        ctx.supabase
          .from('campaign_attribution_clicks')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', ctx.accountId),
        ctx.supabase
          .from('conversation_attributions')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', ctx.accountId),
        ctx.supabase
          .from('advertising_insight_daily')
          .select('insight_date')
          .eq('account_id', ctx.accountId)
          .order('insight_date', { ascending: false })
          .limit(1),
      ]);

    const failed = [
      integrationsRes.error,
      linksRes.error,
      clicksRes.error,
      conversationsRes.error,
      insightRes.error,
    ].find(Boolean);
    if (failed) {
      console.error('[GET /api/account/advertising-integrations] list error:', failed);
      return NextResponse.json(
        { error: 'Não foi possível carregar a configuração de rastreamento.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      integrations: integrationsRes.data ?? [],
      summary: {
        activeLinks: linksRes.count ?? 0,
        trackedClicks: clicksRes.count ?? 0,
        attributedConversations: conversationsRes.count ?? 0,
        lastInsightDate: insightRes.data?.[0]?.insight_date ?? null,
      },
      providerReadiness: {
        meta: Boolean(process.env.META_MARKETING_ACCESS_TOKEN?.trim()),
        googleAds: Boolean(
          process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() &&
            process.env.GOOGLE_ADS_CLIENT_ID?.trim() &&
            process.env.GOOGLE_ADS_CLIENT_SECRET?.trim()
        ),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Saves only a public account mapping. OAuth/API secrets stay server-side. */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(
      `admin:advertisingIntegrationCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      provider?: unknown;
      externalAccountId?: unknown;
      managerAccountId?: unknown;
      displayName?: unknown;
    } | null;
    if (!isProvider(body?.provider)) {
      return NextResponse.json({ error: 'Plataforma inválida.' }, { status: 400 });
    }

    const provider = body.provider;
    const externalAccountId = normalizeAccountId(provider, body?.externalAccountId);
    const managerAccountId =
      body?.managerAccountId === undefined || body.managerAccountId === ''
        ? null
        : normalizeAccountId(provider, body.managerAccountId);
    if (!externalAccountId) {
      return NextResponse.json(
        {
          error:
            provider === 'meta'
              ? 'Informe um ID numérico de conta de anúncios da Meta.'
              : 'Informe um ID de cliente do Google Ads com 10 dígitos.',
        },
        { status: 400 }
      );
    }
    if (body?.managerAccountId && !managerAccountId) {
      return NextResponse.json({ error: 'ID de conta gerenciadora inválido.' }, { status: 400 });
    }

    const payload = {
      account_id: ctx.accountId,
      provider,
      external_account_id: externalAccountId,
      manager_account_id: managerAccountId,
      display_name: text(body?.displayName, 160),
      connection_status: 'not_connected',
      access_scope: 'read',
      created_by: ctx.userId,
    };
    const { data, error } = await ctx.supabase
      .from('advertising_integrations')
      .upsert(payload, { onConflict: 'account_id,provider,external_account_id' })
      .select(SAFE_COLUMNS)
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Essa conta de anúncios já está vinculada a outro CRM.' },
          { status: 409 }
        );
      }
      console.error('[POST /api/account/advertising-integrations] create error:', error);
      return NextResponse.json(
        { error: 'Não foi possível salvar a conta de anúncios.' },
        { status: 500 }
      );
    }

    // The established webhook resolver reads this compatibility mapping.
    // Keeping it in sync means a Meta CTWA referral starts enriching as soon
    // as the server-side token is connected, with no later data migration.
    if (provider === 'meta') {
      const { error: metaError } = await ctx.supabase
        .from('meta_ad_account_integrations')
        .upsert(
          {
            account_id: ctx.accountId,
            provider: 'meta',
            meta_ad_account_id: externalAccountId,
            meta_business_id: managerAccountId,
            access_scope: 'read',
            is_active: true,
            created_by: ctx.userId,
          },
          { onConflict: 'account_id,provider,meta_ad_account_id' }
        );
      if (metaError) {
        console.error('[POST /api/account/advertising-integrations] meta mapping error:', metaError);
      }
    }

    return NextResponse.json({ integration: data }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
