import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  fetchQrConnector,
  QrConnectorConfigurationError,
} from '@/lib/whatsapp/qr-connector';

export const runtime = 'nodejs';

type ConnectorStatus = {
  status?: unknown;
  qr_available?: unknown;
  qr_version?: unknown;
  last_error?: unknown;
};

export async function GET(request: Request) {
  try {
    const { accountId } = await requireRole('admin');
    const view = new URL(request.url).searchParams.get('view');

    if (view === 'qr') {
      const upstream = await fetchQrConnector(accountId, 'qr.svg');
      if (!upstream.ok) {
        return NextResponse.json(
          { error: 'QR code is not available yet' },
          { status: upstream.status === 404 ? 404 : 502 }
        );
      }
      return new NextResponse(await upstream.arrayBuffer(), {
        status: 200,
        headers: {
          'content-type': upstream.headers.get('content-type') ?? 'image/png',
          'cache-control': 'no-store, max-age=0',
          'x-content-type-options': 'nosniff',
          'content-security-policy':
            "default-src 'none'; style-src 'unsafe-inline'",
        },
      });
    }

    const upstream = await fetchQrConnector(accountId, 'status');
    if (!upstream.ok) return connectorUnavailable();
    const data = (await upstream.json()) as ConnectorStatus;

    return NextResponse.json(
      {
        status: normalizeStatus(data.status),
        qr_available: data.qr_available === true,
        pairing_code_supported:
          process.env.WHATSAPP_QR_PROVIDER === 'evolution',
        qr_version:
          typeof data.qr_version === 'string' ? data.qr_version : null,
        last_error:
          typeof data.last_error === 'string' ? data.last_error : null,
      },
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin');
    const operation = new URL(request.url).searchParams.get('operation');
    if (operation === 'import_history') {
      return NextResponse.json(
        { error: 'A importação de conversas antigas está desativada.' },
        { status: 410 }
      );
    }
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const method = body.method === 'pairing_code' ? 'pairing_code' : 'qr';
    const phone =
      typeof body.phone === 'string' ? body.phone.replace(/\D/g, '') : '';
    if (method === 'pairing_code' && !/^\d{8,15}$/.test(phone)) {
      return NextResponse.json(
        {
          error:
            'Informe o telefone com código do país e DDD (8 a 15 dígitos).',
        },
        { status: 400 }
      );
    }
    const upstream = await fetchQrConnector(accountId, 'connect', {
      method: 'POST',
      body: JSON.stringify(
        method === 'pairing_code' ? { pairing_number: phone } : {}
      ),
    });
    const data = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      const detail =
        data &&
        typeof data === 'object' &&
        'error' in data &&
        typeof data.error === 'string'
          ? data.error
          : null;
      return NextResponse.json(
        { error: detail ?? 'Não foi possível iniciar a conexão.' },
        {
          status:
            upstream.status >= 400 && upstream.status < 600
              ? upstream.status
              : 502,
        }
      );
    }
    return NextResponse.json(data ?? {}, { status: 202 });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE() {
  try {
    const { accountId } = await requireRole('admin');
    const upstream = await fetchQrConnector(accountId, '', {
      method: 'DELETE',
    });
    if (!upstream.ok) return connectorUnavailable();
    return NextResponse.json(await upstream.json());
  } catch (error) {
    return handleError(error);
  }
}

function normalizeStatus(value: unknown): string {
  const allowed = new Set([
    'starting',
    'connecting',
    'awaiting_qr_scan',
    'connected',
    'reconnecting',
    'logged_out',
    'disconnected',
  ]);
  return typeof value === 'string' && allowed.has(value)
    ? value
    : 'disconnected';
}

function connectorUnavailable() {
  return NextResponse.json(
    { error: 'O conector QR não respondeu. Tente novamente em instantes.' },
    { status: 502 }
  );
}

function handleError(error: unknown) {
  if (error instanceof QrConnectorConfigurationError) {
    return NextResponse.json(
      { error: 'O conector QR ainda não está configurado neste ambiente.' },
      { status: 503 }
    );
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return connectorUnavailable();
  }
  return toErrorResponse(error);
}
