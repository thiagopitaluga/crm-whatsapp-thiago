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
  last_error?: unknown;
  history_import?: unknown;
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
          'content-type': 'image/svg+xml; charset=utf-8',
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
        last_error:
          typeof data.last_error === 'string' ? data.last_error : null,
        history_import: normalizeHistoryImport(data.history_import),
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
    const suffix = operation === 'import_history' ? 'import' : 'connect';
    const upstream = await fetchQrConnector(accountId, suffix, {
      method: 'POST',
      body: '{}',
    });
    if (!upstream.ok) {
      if (upstream.status === 409 && operation === 'import_history') {
        return NextResponse.json(
          { error: 'Conecte o WhatsApp antes de importar as conversas.' },
          { status: 409 }
        );
      }
      return connectorUnavailable();
    }
    return NextResponse.json(await upstream.json(), { status: 202 });
  } catch (error) {
    return handleError(error);
  }
}

function normalizeHistoryImport(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const allowed = new Set(['preparing', 'running', 'completed', 'failed']);
  return {
    status:
      typeof data.status === 'string' && allowed.has(data.status)
        ? data.status
        : 'failed',
    discovered: typeof data.discovered === 'number' ? data.discovered : 0,
    imported: typeof data.imported === 'number' ? data.imported : 0,
    failed: typeof data.failed === 'number' ? data.failed : 0,
    error: typeof data.error === 'string' ? data.error : null,
  };
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
