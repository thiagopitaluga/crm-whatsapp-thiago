import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt, encrypt } from '@/lib/whatsapp/encryption';

export async function GET() {
  try {
    const { accountId } = await requireRole('admin');
    const { data, error } = await supabaseAdmin()
      .from('stage_integrations')
      .select('pixel_id,access_token_encrypted')
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
    return NextResponse.json({
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
    const { testCode } = await request.json().catch(() => ({}));
    if (typeof testCode !== 'string' || !/^TEST[\w-]{1,50}$/.test(testCode))
      return NextResponse.json(
        { error: 'Informe um código de teste do Gerenciador de Eventos.' },
        { status: 400 }
      );
    const { data: integration, error } = await supabaseAdmin()
      .from('stage_integrations')
      .select('pixel_id,access_token_encrypted')
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw error;
    if (!integration)
      return NextResponse.json(
        { error: 'Configure o pixel antes de testar.' },
        { status: 400 }
      );
    const response = await fetch(
      `https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION || 'v22.0'}/${integration.pixel_id}/events`,
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
            {
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
    const { data: existing } = await db
      .from('stage_integrations')
      .select('access_token_encrypted')
      .eq('account_id', accountId)
      .maybeSingle();
    if (!body.token && !existing)
      return NextResponse.json(
        { error: 'Informe o token de acesso.' },
        { status: 400 }
      );
    const { error } = await db.from('stage_integrations').upsert({
      account_id: accountId,
      pixel_id: body.pixelId,
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
