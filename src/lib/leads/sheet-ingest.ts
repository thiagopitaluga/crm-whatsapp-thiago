import type { SupabaseClient } from '@supabase/supabase-js';

import { findOrCreateContact, resolveAuditUserId } from '@/lib/api/v1/contacts';
import { DEFAULT_CURRENCY } from '@/lib/currency';

export class SheetLeadIngestError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'SheetLeadIngestError';
    this.status = status;
  }
}

export interface SheetLeadInput {
  phone: string;
  name?: string | null;
  email?: string | null;
  /** Account-scoped pipeline name; resolved server-side before any write. */
  pipeline: string;
  /** Blank means the pipeline's first stage. */
  stage?: string | null;
  /** Identifies the upstream system, e.g. `google_sheets`. */
  source: string;
  /** Stable, upstream-specific row id used to make retries idempotent. */
  sourceId: string;
}

export interface SheetLeadIngestResult {
  contactId: string;
  contactCreated: boolean;
  dealId: string;
  dealCreated: boolean;
  pipeline: string;
  stage: string;
}

interface PipelineTarget {
  pipelineId: string;
  pipelineName: string;
  stageId: string;
  stageName: string;
}

/**
 * Ingest one spreadsheet lead into an explicitly named, account-scoped
 * pipeline. The source pair is unique at the database level, so a retry
 * after a network failure returns the original card instead of duplicating it.
 */
export async function ingestSheetLead(
  db: SupabaseClient,
  accountId: string,
  input: SheetLeadInput
): Promise<SheetLeadIngestResult> {
  const target = await resolvePipelineTarget(
    db,
    accountId,
    input.pipeline,
    input.stage
  );
  const auditUserId = await resolveAuditUserId(db, accountId);
  const contact = await findOrCreateContact(db, accountId, auditUserId, {
    phone: input.phone,
    name: input.name,
    email: input.email,
  });

  const existingDeal = await findExistingSourceDeal(
    db,
    accountId,
    input.source,
    input.sourceId
  );
  if (existingDeal) {
    return {
      contactId: contact.id,
      contactCreated: contact.created,
      dealId: existingDeal,
      dealCreated: false,
      pipeline: target.pipelineName,
      stage: target.stageName,
    };
  }

  const { data: account } = await db
    .from('accounts')
    .select('default_currency')
    .eq('id', accountId)
    .maybeSingle();

  const { data: created, error } = await db
    .from('deals')
    .insert({
      account_id: accountId,
      user_id: auditUserId,
      pipeline_id: target.pipelineId,
      stage_id: target.stageId,
      contact_id: contact.id,
      title: input.name?.trim() || input.phone,
      value: 0,
      currency: account?.default_currency ?? DEFAULT_CURRENCY,
      status: 'open',
      source_type: input.source,
      source_external_id: input.sourceId,
    })
    .select('id')
    .single();

  if (created?.id) {
    return {
      contactId: contact.id,
      contactCreated: contact.created,
      dealId: created.id as string,
      dealCreated: true,
      pipeline: target.pipelineName,
      stage: target.stageName,
    };
  }

  // A parallel retry can hit the unique source index after our initial read.
  // Read its winner so callers receive a stable success response.
  const racedDeal = await findExistingSourceDeal(
    db,
    accountId,
    input.source,
    input.sourceId
  );
  if (racedDeal) {
    return {
      contactId: contact.id,
      contactCreated: contact.created,
      dealId: racedDeal,
      dealCreated: false,
      pipeline: target.pipelineName,
      stage: target.stageName,
    };
  }

  console.error('[sheet-ingest] failed to create deal:', error);
  throw new SheetLeadIngestError('Failed to create pipeline card', 500);
}

async function resolvePipelineTarget(
  db: SupabaseClient,
  accountId: string,
  pipelineName: string,
  requestedStage?: string | null
): Promise<PipelineTarget> {
  const normalizedPipeline = pipelineName.trim();
  const { data: pipelines, error: pipelineError } = await db
    .from('pipelines')
    .select('id, name')
    .eq('account_id', accountId)
    .ilike('name', normalizedPipeline)
    .limit(2);

  if (pipelineError) {
    throw new SheetLeadIngestError('Failed to resolve pipeline', 500);
  }
  if (!pipelines?.length) {
    throw new SheetLeadIngestError(
      `Pipeline '${normalizedPipeline}' was not found for this CRM account`,
      422
    );
  }
  if (pipelines.length > 1) {
    throw new SheetLeadIngestError(
      `Pipeline '${normalizedPipeline}' is ambiguous for this CRM account`,
      422
    );
  }

  const pipeline = pipelines[0] as { id: string; name: string };
  const { data: stages, error: stageError } = await db
    .from('pipeline_stages')
    .select('id, name, position')
    .eq('pipeline_id', pipeline.id)
    .order('position', { ascending: true });

  if (stageError) {
    throw new SheetLeadIngestError('Failed to resolve pipeline stages', 500);
  }
  if (!stages?.length) {
    throw new SheetLeadIngestError(
      `Pipeline '${pipeline.name}' has no stages`,
      422
    );
  }

  const stageName = requestedStage?.trim();
  const stage = stageName
    ? stages.find(
        (item) =>
          item.name.trim().toLocaleLowerCase() === stageName.toLocaleLowerCase()
      )
    : stages[0];
  if (!stage) {
    throw new SheetLeadIngestError(
      `Stage '${stageName}' was not found in pipeline '${pipeline.name}'`,
      422
    );
  }

  return {
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    stageId: stage.id,
    stageName: stage.name,
  };
}

async function findExistingSourceDeal(
  db: SupabaseClient,
  accountId: string,
  source: string,
  sourceId: string
): Promise<string | null> {
  const { data, error } = await db
    .from('deals')
    .select('id')
    .eq('account_id', accountId)
    .eq('source_type', source)
    .eq('source_external_id', sourceId)
    .maybeSingle();

  if (error) {
    throw new SheetLeadIngestError('Failed to resolve existing lead', 500);
  }
  return data?.id ? (data.id as string) : null;
}
