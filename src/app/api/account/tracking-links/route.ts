import { NextResponse } from 'next/server';

import {
  normalizeTrackingSlug,
  normalizeWhatsAppNumber,
} from '@/lib/attribution/click-tracking';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  RATE_LIMITS,
  rateLimitResponse,
} from '@/lib/rate-limit';

const MAX_DEFAULT_MESSAGE_LENGTH = 3_500;
const SAFE_COLUMNS =
  'id, slug, whatsapp_number, default_message, is_active, created_at, updated_at';

/** Lists the current account's public tracking entry points. */
export async function GET() {
  try {
    const ctx = await requireRole('admin');
    const { data, error } = await ctx.supabase
      .from('campaign_tracking_links')
      .select(SAFE_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[GET /api/account/tracking-links] list error:', error);
      return NextResponse.json(
        { error: 'Failed to load tracking links' },
        { status: 500 }
      );
    }
    return NextResponse.json({ links: data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Creates an account-scoped public entry point. The slug resolves only inside
 * the redirect backend; its response contains no tenant data.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(
      `admin:trackingLinkCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      slug?: unknown;
      whatsappNumber?: unknown;
      defaultMessage?: unknown;
    } | null;
    const slug =
      typeof body?.slug === 'string' ? normalizeTrackingSlug(body.slug) : null;
    const whatsappNumber =
      typeof body?.whatsappNumber === 'string'
        ? normalizeWhatsAppNumber(body.whatsappNumber)
        : null;
    const defaultMessage =
      typeof body?.defaultMessage === 'string'
        ? body.defaultMessage.trim()
        : null;

    if (!slug) {
      return NextResponse.json(
        {
          error:
            "'slug' must use lowercase letters, digits, and hyphens (1-80 characters)",
        },
        { status: 400 }
      );
    }
    if (!whatsappNumber) {
      return NextResponse.json(
        { error: "'whatsappNumber' must be a valid international number" },
        { status: 400 }
      );
    }
    if (defaultMessage && defaultMessage.length > MAX_DEFAULT_MESSAGE_LENGTH) {
      return NextResponse.json(
        {
          error: `'defaultMessage' must be ${MAX_DEFAULT_MESSAGE_LENGTH} characters or fewer`,
        },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('campaign_tracking_links')
      .insert({
        account_id: ctx.accountId,
        slug,
        whatsapp_number: whatsappNumber,
        default_message: defaultMessage || null,
        created_by: ctx.userId,
      })
      .select(SAFE_COLUMNS)
      .single();
    if (error?.code === '23505') {
      return NextResponse.json(
        { error: 'This tracking link slug is already in use' },
        { status: 409 }
      );
    }
    if (error || !data) {
      console.error('[POST /api/account/tracking-links] insert error:', error);
      return NextResponse.json(
        { error: 'Failed to create tracking link' },
        { status: 500 }
      );
    }
    return NextResponse.json({ link: data }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
