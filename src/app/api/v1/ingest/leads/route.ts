import { requireApiKey } from '@/lib/auth/api-context';
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import { ContactError } from '@/lib/api/v1/contacts';
import {
  ingestSheetLead,
  SheetLeadIngestError,
} from '@/lib/leads/sheet-ingest';

const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 320;
const MAX_PIPELINE_LENGTH = 120;
const MAX_STAGE_LENGTH = 120;
const MAX_SOURCE_LENGTH = 80;
const MAX_SOURCE_ID_LENGTH = 250;

function readString(
  body: Record<string, unknown>,
  field: string,
  maxLength: number,
  required = false
): string | null {
  const value = body[field];
  if (value == null && !required) return null;
  if (typeof value !== 'string') {
    throw new SheetLeadIngestError(`'${field}' must be a string`, 400);
  }
  const trimmed = value.trim();
  if (required && !trimmed) {
    throw new SheetLeadIngestError(`'${field}' is required`, 400);
  }
  if (trimmed.length > maxLength) {
    throw new SheetLeadIngestError(
      `'${field}' must be ${maxLength} characters or fewer`,
      400
    );
  }
  return trimmed || null;
}

/**
 * POST /api/v1/ingest/leads
 *
 * A narrow API-key endpoint for external lead sources such as Google
 * Sheets. The key fixes the CRM account; the request can only select a
 * pipeline that belongs to that account. `source` + `source_id` make
 * retries safe and prevent a sheet row from creating multiple cards.
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

    const phone = readString(body, 'phone', 40, true)!;
    const pipeline = readString(body, 'pipeline', MAX_PIPELINE_LENGTH, true)!;
    const source = readString(body, 'source', MAX_SOURCE_LENGTH, true)!;
    const sourceId = readString(body, 'source_id', MAX_SOURCE_ID_LENGTH, true)!;
    const result = await ingestSheetLead(ctx.supabase, ctx.accountId, {
      phone,
      name: readString(body, 'name', MAX_NAME_LENGTH),
      email: readString(body, 'email', MAX_EMAIL_LENGTH),
      pipeline,
      stage: readString(body, 'stage', MAX_STAGE_LENGTH),
      source,
      sourceId,
    });

    return ok(
      {
        contact_id: result.contactId,
        contact_created: result.contactCreated,
        deal_id: result.dealId,
        deal_created: result.dealCreated,
        pipeline: result.pipeline,
        stage: result.stage,
      },
      result.dealCreated ? 201 : 200
    );
  } catch (error) {
    if (error instanceof SheetLeadIngestError) {
      return fail(
        error.status === 400 || error.status === 422
          ? 'bad_request'
          : 'internal',
        error.message,
        error.status
      );
    }
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
