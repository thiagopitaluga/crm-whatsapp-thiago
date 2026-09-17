import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { extensionForMime } from '@/lib/media/filename';
import { buildMediaPath } from '@/lib/storage/upload-media';
import { isValidQrConnectorSecret } from '@/lib/whatsapp/qr-connector';

export const runtime = 'nodejs';

const MEDIA_KINDS = new Set(['image', 'audio', 'video', 'document']);

/**
 * Gives the QR bridge a single-use, account-scoped Storage upload URL.
 * The bridge sends media bytes straight to Storage; they never traverse a
 * Vercel function, avoiding payload limits and keeping the service key out
 * of the connector.
 */
export async function POST(request: Request) {
  if (!isValidQrConnectorSecret(request.headers.get('x-connector-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const accountId =
    typeof body?.account_id === 'string' ? body.account_id.trim() : '';
  const messageId =
    typeof body?.message_id === 'string' ? body.message_id.trim() : '';
  const kind = typeof body?.kind === 'string' ? body.kind.trim() : '';
  const mimeType =
    typeof body?.mime_type === 'string'
      ? body.mime_type.split(';')[0].trim().toLowerCase()
      : '';
  const fileName =
    typeof body?.file_name === 'string' ? body.file_name.trim() : '';

  if (
    !/^[0-9a-f-]{36}$/i.test(accountId) ||
    !messageId ||
    !MEDIA_KINDS.has(kind) ||
    !mimeType.includes('/')
  ) {
    return NextResponse.json({ error: 'Invalid media upload request' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: account } = await supabase
    .from('accounts')
    .select('id')
    .eq('id', accountId)
    .maybeSingle();
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  const baseName = fileName || `${messageId}-${kind}.${extensionForMime(mimeType)}`;
  // One stable key per provider message makes retries idempotent.
  const path = buildMediaPath(accountId, baseName, null, 'inbound-qr');
  const bucket = supabase.storage.from('chat-media');
  const { data: signed, error } = await bucket.createSignedUploadUrl(path, {
    upsert: true,
  });
  if (error || !signed?.signedUrl) {
    console.error('[qr-media-upload] could not create signed upload URL:', error);
    return NextResponse.json({ error: 'Could not prepare media upload' }, { status: 500 });
  }

  const {
    data: { publicUrl },
  } = bucket.getPublicUrl(path);
  return NextResponse.json({ upload_url: signed.signedUrl, media_url: publicUrl });
}
