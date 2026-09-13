import { NextResponse } from 'next/server';

import {
  attributionInputFromRequest,
  buildAttributionMessage,
  buildWhatsAppRedirectUrl,
  captureAttributionClick,
  findActiveTrackingLink,
  normalizeTrackingSlug,
} from '@/lib/attribution/click-tracking';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export const dynamic = 'force-dynamic';

/**
 * Public first-party campaign URL.
 *
 * Example:
 *   /w/morgana-lotes?utm_source=google&gclid=...
 *
 * The only response is a WhatsApp redirect. It never exposes link, account,
 * campaign, or token details in JSON/HTML for a visitor to enumerate.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug: rawSlug } = await params;
  const slug = normalizeTrackingSlug(rawSlug);
  if (!slug) return new NextResponse('Not found', { status: 404 });

  try {
    const link = await findActiveTrackingLink(supabaseAdmin(), slug);
    if (!link) return new NextResponse('Not found', { status: 404 });

    const click = await captureAttributionClick(
      supabaseAdmin(),
      link,
      attributionInputFromRequest(request)
    );
    const destination = buildWhatsAppRedirectUrl(
      link.whatsapp_number,
      buildAttributionMessage(link.default_message, click.token)
    );
    const response = NextResponse.redirect(destination, 302);
    // Clicks include campaign data, so neither the browser nor a CDN should
    // cache a redirect keyed by a prior visitor's query string.
    response.headers.set('Cache-Control', 'no-store, max-age=0');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  } catch (error) {
    console.error('[GET /w/[slug]] attribution redirect failed:', error);
    return new NextResponse('Unable to start WhatsApp conversation', {
      status: 500,
    });
  }
}
