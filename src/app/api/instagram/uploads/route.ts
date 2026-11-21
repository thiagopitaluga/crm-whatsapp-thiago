import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    if (request.headers.get('origin') !== new URL(request.url).origin)
      return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
    const rate = checkRateLimit(
      'instagram-upload:' + ctx.userId,
      RATE_LIMITS.adminAction
    );
    if (!rate.success) return rateLimitResponse(rate);
    const file = await request.json().catch(() => null);
    const extensions: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'application/pdf': 'pdf',
    };
    if (
      !file ||
      typeof file.name !== 'string' ||
      file.name.length > 250 ||
      !extensions[file.type] ||
      !Number.isSafeInteger(file.size) ||
      file.size > 10 * 1024 * 1024 ||
      file.size <= 0
    )
      return NextResponse.json(
        { error: 'Envie uma imagem ou PDF de até 10 MB.' },
        { status: 400 }
      );
    const bucket = supabaseAdmin().storage.from('instagram-flow-media');
    const path = `${ctx.accountId}/${randomUUID()}.${extensions[file.type]}`;
    const result = await bucket.createSignedUploadUrl(path, { upsert: false });
    if (result.error) throw result.error;
    const url = bucket.getPublicUrl(path).data.publicUrl;
    return NextResponse.json(
      { uploadUrl: result.data.signedUrl, url },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
