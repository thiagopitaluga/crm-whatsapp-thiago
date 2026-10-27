import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  isPlaceholderOnlyContact,
  type LegacyConversation,
} from '@/lib/leads/legacy-placeholder';

export const runtime = 'nodejs';
export const maxDuration = 300;

type Conversation = LegacyConversation & { contact_id: string };
type Contact = { id: string; name: string | null; phone: string };
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!
  );

// Read all pages and all conversations belonging to each candidate contact.
// Two message rows per conversation suffice to disqualify a multi-message
// contact, without transferring entire chat histories to this maintenance view.
async function findCandidates(accountId: string): Promise<Contact[]> {
  const db = supabaseAdmin();
  const ids = new Set<string>();
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db
      .from('conversations')
      .select('id,contact_id')
      .eq('account_id', accountId)
      .ilike('last_message_text', '[Mensagem]')
      .order('id')
      .range(offset, offset + 499);
    if (error) throw error;
    for (const row of data ?? []) if (row.contact_id) ids.add(row.contact_id);
    if (!data || data.length < 500) break;
  }
  const candidates: Contact[] = [];
  const contactIds = [...ids];
  for (let index = 0; index < contactIds.length; index += 50) {
    const chunk = contactIds.slice(index, index + 50);
    const conversations: Conversation[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await db
        .from('conversations')
        .select(
          'contact_id,last_message_text,messages(content_text,content_type,media_url)'
        )
        .eq('account_id', accountId)
        .in('contact_id', chunk)
        .order('id')
        .range(offset, offset + 499)
        .limit(2, { referencedTable: 'messages' });
      if (error) throw error;
      conversations.push(...((data ?? []) as Conversation[]));
      if (!data || data.length < 500) break;
    }
    const eligible = chunk.filter((id) =>
      isPlaceholderOnlyContact(conversations.filter((c) => c.contact_id === id))
    );
    if (!eligible.length) continue;
    const { data, error } = await db
      .from('contacts')
      .select('id,name,phone')
      .eq('account_id', accountId)
      .in('id', eligible)
      .order('id');
    if (error) throw error;
    candidates.push(...(data ?? []));
  }
  return candidates;
}

async function destination(accountId: string) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('pipelines')
    .select('id,name')
    .eq('account_id', accountId)
    .ilike('name', 'Leads Antigos');
  if (error || data?.length !== 1)
    throw new Error('Expected one existing Leads Antigos pipeline');
  const pipeline = data[0];
  const { data: stage, error: stageError } = await db
    .from('pipeline_stages')
    .select('id')
    .eq('pipeline_id', pipeline.id)
    .order('position')
    .limit(1)
    .single();
  if (stageError || !stage) throw new Error('Destination stage unavailable');
  return { pipeline, stage };
}

function html(body: string) {
  return new Response(
    `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Organizar leads antigos — OrganiZAP</title><body><main><h1>Organizar leads antigos</h1>${body}<p><a href="/pipelines">Voltar ao Kanban</a></p></main></body></html>`,
    {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'private, no-store',
        'content-security-policy':
          "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      },
    }
  );
}

export async function GET() {
  try {
    const ctx = await requireRole('admin');
    const { pipeline } = await destination(ctx.accountId);
    const candidates = await findCandidates(ctx.accountId);
    let pending = 0;
    for (let index = 0; index < candidates.length; index += 50) {
      const chunk = candidates.slice(index, index + 50);
      const { data: deals, error } = await supabaseAdmin()
        .from('deals')
        .select('contact_id,pipeline_id')
        .eq('account_id', ctx.accountId)
        .in(
          'contact_id',
          chunk.map((c) => c.id)
        );
      if (error) throw error;
      for (const contact of chunk) {
        const cards = (deals ?? []).filter((d) => d.contact_id === contact.id);
        if (!cards.length || cards.some((d) => d.pipeline_id !== pipeline.id))
          pending += 1;
      }
    }
    return html(
      `<h2>${escape(ctx.account.name)}</h2><p>${candidates.length} contatos possuem somente “[Mensagem]”, incluindo prévias legadas sem histórico.</p><p>Contatos pendentes de organização: ${pending}.</p><p>Destino: ${escape(pipeline.name)}. Contatos com outras mensagens são preservados.</p><form method="post"><input type="hidden" name="account_id" value="${escape(ctx.accountId)}"><button type="submit">Mover contatos identificados para Leads Antigos</button></form><ul>${candidates.map((c) => `<li>${escape(c.name || c.phone)}</li>`).join('')}</ul>`
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin) {
      return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
    }
    const ctx = await requireRole('admin');
    const form = await request.formData();
    if (form.get('account_id') !== ctx.accountId)
      return NextResponse.json({ error: 'Account changed' }, { status: 409 });
    const { pipeline, stage } = await destination(ctx.accountId);
    // Recompute on submission so the preview is never trusted as eligibility.
    const candidates = await findCandidates(ctx.accountId);
    let moved = 0;
    let created = 0;
    let alreadyThere = 0;
    for (const contact of candidates) {
      // Check again immediately before writing, including other conversations.
      const { data: conversations, error: historyError } = await supabaseAdmin()
        .from('conversations')
        .select(
          'last_message_text,messages(content_text,content_type,media_url)'
        )
        .eq('account_id', ctx.accountId)
        .eq('contact_id', contact.id)
        .limit(2, { referencedTable: 'messages' });
      if (historyError) throw historyError;
      if (!isPlaceholderOnlyContact(conversations ?? [])) continue;
      const { data: deals, error } = await ctx.supabase
        .from('deals')
        .select('id,pipeline_id,stage_id')
        .eq('account_id', ctx.accountId)
        .eq('contact_id', contact.id);
      if (error) throw error;
      if (!deals?.length) {
        const { error: insertError } = await ctx.supabase.from('deals').insert({
          account_id: ctx.accountId,
          user_id: ctx.userId,
          contact_id: contact.id,
          pipeline_id: pipeline.id,
          stage_id: stage.id,
          title: contact.name || contact.phone,
          value: 0,
          status: 'open',
        });
        if (insertError) throw insertError;
        created += 1;
      } else {
        for (const deal of deals) {
          if (deal.pipeline_id === pipeline.id) {
            alreadyThere += 1;
            continue;
          }
          const { data: changed, error: moveError } = await ctx.supabase
            .from('deals')
            .update({
              pipeline_id: pipeline.id,
              stage_id: stage.id,
              updated_at: new Date().toISOString(),
            })
            .eq('account_id', ctx.accountId)
            .eq('id', deal.id)
            .eq('pipeline_id', deal.pipeline_id)
            .eq('stage_id', deal.stage_id)
            .select('id');
          if (moveError) throw moveError;
          moved += changed?.length ?? 0;
        }
      }
    }
    return html(
      `<h2>${escape(ctx.account.name)}</h2><p>Organização concluída.</p><p>Contatos identificados: ${candidates.length}. Cartões movidos: ${moved}. Cartões criados para contatos sem cartão: ${created}. Cartões que já estavam em Leads Antigos: ${alreadyThere}.</p><p>Destino: ${escape(pipeline.name)}. Histórico, responsáveis, notas e dados dos contatos foram mantidos.</p><p><a href="/api/admin/legacy-leads">Conferir novamente</a></p>`
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
