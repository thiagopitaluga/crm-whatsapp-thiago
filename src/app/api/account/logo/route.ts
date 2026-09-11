import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

const LOGO_BUCKET = 'account-logos';
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MIME_TO_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function ownerRateLimit(userId: string) {
  const limit = checkRateLimit(`owner:account-logo:${userId}`, RATE_LIMITS.adminAction);
  return limit.success ? null : rateLimitResponse(limit);
}

/** Upload a company logo. Account identity is an owner-only setting. */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('owner');
    const limited = ownerRateLimit(ctx.userId);
    if (limited) return limited;

    const formData = await request.formData().catch(() => null);
    const logo = formData?.get('logo');
    if (!(logo instanceof File)) {
      return NextResponse.json({ error: 'logo file required' }, { status: 400 });
    }
    if (!Object.hasOwn(MIME_TO_EXTENSION, logo.type)) {
      return NextResponse.json({ error: 'Unsupported image type' }, { status: 400 });
    }
    if (logo.size > MAX_LOGO_BYTES) {
      return NextResponse.json({ error: 'Logo must be 2 MB or smaller' }, { status: 400 });
    }

    const extension = MIME_TO_EXTENSION[logo.type];
    const storage = supabaseAdmin().storage.from(LOGO_BUCKET);
    const path = `account-${ctx.accountId}/logo-${Date.now()}.${extension}`;
    const { error: uploadError } = await storage.upload(path, logo, {
      cacheControl: '3600',
      contentType: logo.type,
      upsert: false,
    });
    if (uploadError) {
      console.error('[POST /api/account/logo] upload error:', uploadError);
      return NextResponse.json({ error: 'Failed to upload logo' }, { status: 500 });
    }

    const {
      data: { publicUrl: logoUrl },
    } = storage.getPublicUrl(path);
    const { data: account, error: accountError } = await supabaseAdmin()
      .from('accounts')
      .update({ logo_url: logoUrl })
      .eq('id', ctx.accountId)
      .select('id, name, logo_url')
      .single();

    if (accountError) {
      // Best effort cleanup prevents a failed database update from leaving
      // an otherwise inaccessible object in the public logo bucket.
      await storage.remove([path]);
      console.error('[POST /api/account/logo] account update error:', accountError);
      return NextResponse.json({ error: 'Failed to save logo' }, { status: 500 });
    }

    return NextResponse.json({ account });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Remove the account logo without affecting the workspace name. */
export async function DELETE() {
  try {
    const ctx = await requireRole('owner');
    const limited = ownerRateLimit(ctx.userId);
    if (limited) return limited;

    const { data: account, error } = await supabaseAdmin()
      .from('accounts')
      .update({ logo_url: null })
      .eq('id', ctx.accountId)
      .select('id, name, logo_url')
      .single();
    if (error) {
      console.error('[DELETE /api/account/logo] account update error:', error);
      return NextResponse.json({ error: 'Failed to remove logo' }, { status: 500 });
    }

    return NextResponse.json({ account });
  } catch (error) {
    return toErrorResponse(error);
  }
}
