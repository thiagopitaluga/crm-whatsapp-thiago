import { requireApiKey } from '@/lib/auth/api-context';
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import { ContactError } from '@/lib/api/v1/contacts';
import {
  ingestExternalWhatsAppMessage,
  type ExternalMessageContentType,
} from '@/lib/leads/ingest';

/**
 * POST /api/v1/ingest/whatsapp
 *
 * A trusted QR connector may store a real message from the last 24 hours.
 * Preview-only, stale and synthetic events never create CRM records.
 * The connector must use an API key with only `ingest:write`.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'ingest:write');
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    if (!phone) return fail('bad_request', "'phone' is required", 400);

    const name = typeof body.name === 'string' ? body.name.trim() : null;
    const direction = body.direction === 'outbound' ? 'outbound' : 'inbound';
    const messageId =
      typeof body.message_id === 'string' ? body.message_id.trim() : '';
    const contentText =
      typeof body.content_text === 'string' ? body.content_text : null;
    const contentType = asContentType(body.content_type);
    const messageCreatedAt =
      typeof body.message_created_at === 'string'
        ? body.message_created_at
        : null;

    if (messageId && contentText && contentType) {
      const result = await ingestExternalWhatsAppMessage(
        ctx.supabase,
        ctx.accountId,
        {
          phone,
          name,
          direction,
          messageId,
          contentText,
          contentType,
          createdAt: messageCreatedAt,
        }
      );
      return ok({
        stored: Boolean(result),
        contact_id: result?.contactId ?? null,
        conversation_id: result?.conversationId ?? null,
      });
    }

    return ok({ stored: false, ignored: 'message_required' });
  } catch (error) {
    if (error instanceof ContactError) {
      return fail(
        error.status === 400 ? 'bad_request' : 'internal',
        error.message,
        error.status
      );
    }
    return toApiErrorResponse(error);
  }
}

function asContentType(value: unknown): ExternalMessageContentType | null {
  return typeof value === 'string' &&
    [
      'text',
      'image',
      'document',
      'audio',
      'video',
      'location',
      'interactive',
    ].includes(value)
    ? (value as ExternalMessageContentType)
    : null;
}
