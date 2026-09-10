import { requireApiKey } from '@/lib/auth/api-context';
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import { ContactError } from '@/lib/api/v1/contacts';
import { ingestLead } from '@/lib/leads/ingest';

/**
 * POST /api/v1/ingest/whatsapp
 *
 * A narrowly-scoped, capture-only endpoint for a trusted QR connector.
 * It never sends a WhatsApp message and deliberately stores no inbound
 * message body. A new phone becomes a contact, a lightweight
 * conversation record, and (when a pipeline exists) a deal in its first
 * stage. The connector must use an API key with only `ingest:write`.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'ingest:write');
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    if (!phone) return fail('bad_request', "'phone' is required", 400);

    const name = typeof body.name === 'string' ? body.name.trim() : null;
    const result = await ingestLead(ctx.supabase, ctx.accountId, { phone, name });

    return ok({
      contact_id: result.contactId,
      contact_created: result.contactCreated,
      conversation_id: result.conversationId,
      deal_id: result.dealId,
    }, result.contactCreated ? 201 : 200);
  } catch (error) {
    if (error instanceof ContactError) {
      return fail(error.status === 400 ? 'bad_request' : 'internal', error.message, error.status);
    }
    return toApiErrorResponse(error);
  }
}
