import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt, encrypt } from '@/lib/whatsapp/encryption';
import {
  buildWhatsAppConversion,
  type WhatsAppConversion,
} from '@/lib/pipelines/meta-conversion';

export async function GET() {
  try {
    const { accountId } = await requireRole('admin');
    const { data, error } = await supabaseAdmin()
      .from('stage_integrations')
      .select('pixel_id,access_token_encrypted,whatsapp_conversion')
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw error;
    const { data: history, error: historyError } = await supabaseAdmin()
      .from('stage_jobs')
      .select('id,created_at,status,error,payload,stage_id')
      .eq('account_id', accountId)
      .eq('kind', 'meta')
      .order('created_at', { ascending: false })
      .limit(30);
    if (historyError) throw historyError;
    const db = supabaseAdmin();
    const [channels, clicks, ads] = await Promise.all([
      db
        .from('whatsapp_channels')
        .select('channel_key,label,provider')
        .eq('account_id', accountId),
      db
        .from('conversation_attributions')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .not('ctwa_clid', 'is', null),
      db
        .from('conversation_attributions')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .not('source_id', 'is', null),
    ]);
    for (const result of [channels, clicks, ads])
      if (result.error) throw result.error;
    return NextResponse.json({
      whatsappConversion: data?.whatsapp_conversion ?? null,
      channels: channels.data ?? [],
      tracking: { clickIds: clicks.count ?? 0, adIds: ads.count ?? 0 },
      pixelId: data?.pixel_id ?? '',
      configured: Boolean(data),
      tokenHint: data
        ? `••••${decrypt(data.access_token_encrypted).slice(-4)}`
        : '',
      history: history ?? [],
      emailReady: Boolean(
        process.env.RESEND_API_KEY && process.env.STAGE_EMAIL_FROM
      ),
      cronReady: Boolean(
        process.env.AUTOMATION_CRON_SECRET ?? process.env.CRON_SECRET
      ),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin');
    const { testCode, whatsapp = false } = await request
      .json()
      .catch(() => ({}));
    if (typeof testCode !== 'string' || !/^TEST[\w-]{1,50}$/.test(testCode))
      return NextResponse.json(
        { error: 'Informe um código de teste do Gerenciador de Eventos.' },
        { status: 400 }
      );
    const { data: integration, error } = await supabaseAdmin()
      .from('stage_integrations')
      .select('pixel_id,access_token_encrypted,whatsapp_conversion')
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw error;
    if (!integration)
      return NextResponse.json(
        { error: 'Configure o pixel antes de testar.' },
        { status: 400 }
      );
    const config = integration.whatsapp_conversion as WhatsAppConversion | null;
    let messagingEvent = null;
    if (whatsapp) {
      if (!config)
        return NextResponse.json(
          { error: 'Salve a configuração de conversões do WhatsApp.' },
          { status: 400 }
        );
      const { data: referral, error: referralError } = await supabaseAdmin()
        .from('conversation_attributions')
        .select('ctwa_clid,conversations!inner(whatsapp_channel_key)')
        .eq('account_id', accountId)
        .eq('conversations.whatsapp_channel_key', config.channelKey)
        .not('ctwa_clid', 'is', null)
        .order('received_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (referralError) throw referralError;
      if (!referral?.ctwa_clid)
        return NextResponse.json(
          {
            error:
              'Ainda não há um clique de anúncio registrado neste WhatsApp para testar.',
          },
          { status: 400 }
        );
      messagingEvent = buildWhatsAppConversion({
        config,
        channelKey: config.channelKey,
        clickId: referral.ctwa_clid,
        eventName: 'Lead',
        eventId: `test-${crypto.randomUUID()}`,
        occurredAt: new Date().toISOString(),
        value: 0,
        currency: 'BRL',
      });
    }
    const response = await fetch(
      `https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION || 'v22.0'}/${messagingEvent ? config!.datasetId : integration.pixel_id}/events`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${decrypt(integration.access_token_encrypted)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          test_event_code: testCode,
          data: [
            messagingEvent ?? {
              event_name: 'Lead',
              event_time: Math.floor(Date.now() / 1000),
              action_source: 'system_generated',
              user_data: {
                client_user_agent: 'Organizap stage integration test',
              },
            },
          ],
        }),
      }
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      return NextResponse.json(
        { error: result.error?.message || `Meta retornou ${response.status}.` },
        { status: 502 }
      );
    return NextResponse.json({ received: result.events_received ?? 0 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
export async function PUT(request: Request) {
  try {
    const { accountId } = await requireRole('admin');
    const body = await request.json().catch(() => null);
    if (
      !body ||
      typeof body.pixelId !== 'string' ||
      !/^\d{5,30}$/.test(body.pixelId) ||
      typeof body.token !== 'string' ||
      (body.token.length > 0 && body.token.length < 10) ||
      body.token.length > 4096
    )
      return NextResponse.json(
        { error: 'Informe um pixel e token válidos.' },
        { status: 400 }
      );
    const db = supabaseAdmin();
    const { data: existing, error: existingError } = await db
      .from('stage_integrations')
      .select('access_token_encrypted')
      .eq('account_id', accountId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!body.token && !existing)
      return NextResponse.json(
        { error: 'Informe o token de acesso.' },
        { status: 400 }
      );
    const config = body.whatsappConversion;
    if (config) {
      if (
        typeof config.wabaId !== 'string' ||
        !/^\d{5,30}$/.test(config.wabaId) ||
        typeof config.datasetId !== 'string' ||
        !/^\d{5,30}$/.test(config.datasetId) ||
        typeof config.channelKey !== 'string' ||
        config.channelKey.length > 200
      )
        return NextResponse.json(
          { error: 'Informe WABA, conjunto de dados e canal válidos.' },
          { status: 400 }
        );
      const { data: channel, error: channelError } = await db
        .from('whatsapp_channels')
        .select('id')
        .eq('account_id', accountId)
        .eq('channel_key', config.channelKey)
        .maybeSingle();
      if (channelError) throw channelError;
      if (!channel)
        return NextResponse.json(
          { error: 'Escolha um WhatsApp desta conta.' },
          { status: 400 }
        );
      const check = await fetch(
        `https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION || 'v22.0'}/${config.wabaId}/dataset`,
        {
          headers: {
            Authorization: `Bearer ${body.token || decrypt(existing!.access_token_encrypted)}`,
          },
          signal: AbortSignal.timeout(15000),
          cache: 'no-store',
        }
      );
      const dataset = await check.json().catch(() => null);
      const matchesDataset =
        dataset?.id === config.datasetId ||
        (Array.isArray(dataset?.data) &&
          dataset.data.some(
            (item: { id?: unknown }) => item?.id === config.datasetId
          ));
      if (!check.ok || !matchesDataset)
        return NextResponse.json(
          {
            error:
              'A Meta não confirmou o conjunto de dados desta WABA. Confira os IDs e as permissões whatsapp_business_management e whatsapp_business_manage_events do token.',
          },
          { status: 400 }
        );
    }
    const { error } = await db.from('stage_integrations').upsert({
      account_id: accountId,
      pixel_id: body.pixelId,
      ...(config !== undefined
        ? {
            whatsapp_conversion: config
              ? {
                  wabaId: config.wabaId,
                  datasetId: config.datasetId,
                  channelKey: config.channelKey,
                }
              : null,
          }
        : {}),
      access_token_encrypted: body.token
        ? encrypt(body.token)
        : existing!.access_token_encrypted,
    });
    if (error) throw error;
    return NextResponse.json({ saved: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
