import { NextResponse } from 'next/server';
import { ForbiddenError, UnauthorizedError, requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { serviceEnabled } from '@/lib/billing/server-access';
import { brazilPhone, parseCampaignInput, uuidPattern, type CampaignAudience } from '@/lib/broadcasts/evolution-campaign';
import { isAccountGroupMediaUrl } from '@/lib/whatsapp/group-broadcast-input';
import { fetchQrConnector } from '@/lib/whatsapp/qr-connector';

export const runtime = 'nodejs';
export const maxDuration = 60;

type ContactRow = { id: string; phone: string; name: string | null; assigned_to: string | null; created_at: string };
type Db = ReturnType<typeof supabaseAdmin>;

async function allContacts(db: Db, accountId: string): Promise<ContactRow[]> {
  const rows: ContactRow[] = [];
  for (let offset = 0; offset <= 5000; offset += 1000) {
    const { data, error } = await db.from('contacts')
      .select('id,phone,name,assigned_to,created_at').eq('account_id', accountId)
      .order('created_at').range(offset, offset + 999);
    if (error) throw error;
    rows.push(...(data ?? []) as ContactRow[]);
    if ((data ?? []).length < 1000) break;
  }
  if (rows.length > 5000) throw new Error('O público excede 5.000 contatos. Refine o segmento.');
  return rows;
}

async function resolveAudience(db: Db, accountId: string, createdBy: string,
  audience: CampaignAudience) {
  if (audience.mode === 'contacts') {
    const selected: ContactRow[] = [];
    for (let offset = 0; offset < audience.contactIds.length; offset += 200) {
      const { data, error } = await db.from('contacts').select('id,phone,name,assigned_to,created_at')
        .eq('account_id', accountId).in('id', audience.contactIds.slice(offset, offset + 200));
      if (error) throw error;
      selected.push(...(data ?? []) as ContactRow[]);
    }
    if (selected.length !== audience.contactIds.length)
      throw new Error('A seleção contém contatos fora desta conta.');
    return selected;
  }
  if (audience.mode === 'csv') {
    const unique = new Map(audience.csvContacts.map((row) => [row.phone, row]));
    const existing = new Map<string, ContactRow>();
    const phones = [...unique.keys()];
    for (let offset = 0; offset < phones.length; offset += 100) {
      const batch = phones.slice(offset, offset + 100);
      const { data, error } = await db.from('contacts').select('id,phone,name,assigned_to,created_at')
        .eq('account_id', accountId).in('phone', batch.flatMap((phone) => [phone, `+${phone}`]));
      if (error) throw error;
      for (const contact of (data ?? []) as ContactRow[]) existing.set(brazilPhone(contact.phone), contact);
    }
    const missing = [...unique.values()].filter((row) => !existing.has(row.phone));
    for (let offset = 0; offset < missing.length; offset += 200) {
      const { data, error } = await db.from('contacts').insert(missing.slice(offset, offset + 200).map((row) => ({
        account_id: accountId, user_id: createdBy, phone: `+${row.phone}`, name: row.name || null,
      }))).select('id,phone,name,assigned_to,created_at');
      if (error) throw error;
      for (const contact of (data ?? []) as ContactRow[]) existing.set(brazilPhone(contact.phone), contact);
    }
    return [...unique.keys()].map((phone) => existing.get(phone)).filter((c): c is ContactRow => Boolean(c));
  }
  const contacts = await allContacts(db, accountId);
  const filter = audience.segment;
  let eligible = contacts;
  if (filter.pipelineId) {
    if (!uuidPattern.test(filter.pipelineId)) throw new Error('Funil inválido.');
    const { data: pipeline } = await db.from('pipelines').select('id')
      .eq('account_id', accountId).eq('id', filter.pipelineId).maybeSingle();
    if (!pipeline) throw new Error('Funil não encontrado.');
    const { data: deals, error } = await db.from('deals').select('contact_id,stage_id,created_at')
      .eq('account_id', accountId).eq('pipeline_id', filter.pipelineId).limit(5001);
    if (error) throw error;
    if ((deals ?? []).length > 5000) throw new Error('O funil excede 5.000 leads. Refine o segmento.');
    const stageSet = new Set(filter.stageIds);
    const ids = new Set((deals ?? []).filter((row) =>
      (!stageSet.size || stageSet.has(row.stage_id)) &&
      (!filter.createdFrom || row.created_at >= `${filter.createdFrom}T00:00:00`) &&
      (!filter.createdTo || row.created_at <= `${filter.createdTo}T23:59:59`)
    ).map((row) => row.contact_id));
    eligible = eligible.filter((c) => ids.has(c.id));
  } else if (filter.stageIds.length) throw new Error('Escolha um funil antes das etapas.');
  if (filter.tagIds.length) {
    const { data: tags, error } = await db.from('tags').select('id')
      .eq('account_id', accountId).in('id', filter.tagIds);
    if (error || tags?.length !== filter.tagIds.length) throw new Error('Etiqueta inválida.');
    const { data: tagged, error: taggedError } = await db.from('contact_tags')
      .select('contact_id').in('tag_id', filter.tagIds).limit(5001);
    if (taggedError) throw taggedError;
    if ((tagged ?? []).length > 5000) throw new Error('A etiqueta excede 5.000 contatos. Refine o segmento.');
    const ids = new Set((tagged ?? []).map((row) => row.contact_id));
    eligible = eligible.filter((c) => ids.has(c.id));
  }
  if (filter.assigneeId) eligible = eligible.filter((c) => c.assigned_to === filter.assigneeId);
  if (!filter.pipelineId && (filter.createdFrom || filter.createdTo)) {
    const { data: deals, error } = await db.from('deals').select('contact_id,created_at')
      .eq('account_id', accountId).limit(5001);
    if (error) throw error;
    if ((deals ?? []).length > 5000) throw new Error('Há muitos leads. Escolha um funil para refinar o segmento.');
    const ids = new Set((deals ?? []).filter((deal) =>
      (!filter.createdFrom || deal.created_at >= `${filter.createdFrom}T00:00:00`) &&
      (!filter.createdTo || deal.created_at <= `${filter.createdTo}T23:59:59`)
    ).map((deal) => deal.contact_id));
    eligible = eligible.filter((contact) => ids.has(contact.id));
  }
  return eligible;
}

async function validateAction(db: Db, accountId: string, action: import('@/lib/broadcasts/evolution-campaign').CampaignAction) {
  if (action.pipelineId) {
    const { data } = await db.from('pipelines').select('id').eq('account_id', accountId).eq('id', action.pipelineId).maybeSingle();
    if (!data) throw new Error('Funil da ação inválido.');
    if (action.stageId) {
      const { data: stage } = await db.from('pipeline_stages').select('id').eq('pipeline_id', action.pipelineId).eq('id', action.stageId).maybeSingle();
      if (!stage) throw new Error('Etapa da ação inválida.');
    }
  } else if (action.stageId) throw new Error('Escolha o funil da etapa.');
  if (action.tagId) {
    const { data } = await db.from('tags').select('id').eq('account_id', accountId).eq('id', action.tagId).maybeSingle();
    if (!data) throw new Error('Etiqueta da ação inválida.');
  }
  if (action.assigneeId) {
    const { data } = await db.from('profiles').select('id').eq('account_id', accountId).eq('id', action.assigneeId).maybeSingle();
    if (!data) throw new Error('Responsável da ação inválido.');
  }
}

export async function GET() {
  try {
    const { accountId } = await requireRole('agent');
    const { data, error } = await supabaseAdmin().from('evolution_campaigns')
      .select('id,name,status,created_at,scheduled_at,total_recipients,sent_count,failed_count,last_error')
      .eq('account_id', accountId).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return NextResponse.json({ campaigns: data ?? [] }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return toErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('agent');
    const db = supabaseAdmin();
    if (!await serviceEnabled(db, accountId, 'broadcasts'))
      return NextResponse.json({ error: 'Disparos não estão habilitados neste plano.' }, { status: 403 });
    const parsed = parseCampaignInput(await request.json().catch(() => null));
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const input = parsed.value;
    for (const message of input.messages) if (message.mediaUrl &&
      !isAccountGroupMediaUrl(message.mediaUrl, accountId, process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''))
      return NextResponse.json({ error: 'Anexo fora do armazenamento desta conta.' }, { status: 400 });
    const { data: channels, error: channelError } = await db.from('whatsapp_channels')
      .select('id,channel_key,evolution_instance_name').eq('account_id', accountId)
      .eq('provider', 'evolution').in('id', input.delivery.senderIds);
    if (channelError) throw channelError;
    if (channels?.length !== input.delivery.senderIds.length)
      return NextResponse.json({ error: 'Selecione apenas números Evolution desta conta.' }, { status: 400 });
    const states = await Promise.all((channels ?? []).map(async (channel) => {
      const response = await fetchQrConnector(accountId, 'status', {}, {
        instanceName: channel.evolution_instance_name, channelKey: channel.channel_key,
      });
      const payload = await response.json().catch(() => null) as { status?: string } | null;
      return response.ok && payload?.status === 'connected';
    }));
    if (states.some((connected) => !connected))
      return NextResponse.json({ error: 'Todos os números selecionados precisam estar conectados.' }, { status: 409 });
    await validateAction(db, accountId, input.onSent);
    await validateAction(db, accountId, input.onReply);
    const contacts = await resolveAudience(db, accountId, userId, input.audience);
    const unique = [...new Map(contacts.map((contact) => [brazilPhone(contact.phone), contact])).entries()]
      .filter(([phone]) => Boolean(phone));
    if (!unique.length) return NextResponse.json({ error: 'Nenhum contato válido encontrado.' }, { status: 400 });
    const scheduledAt = input.delivery.sendNow ? new Date().toISOString() : new Date(input.delivery.scheduledAt).toISOString();
    const { data: campaign, error: insertError } = await db.from('evolution_campaigns').insert({
      account_id: accountId, created_by: userId, name: input.name,
      message_variants: input.messages, audience_config: input.audience,
      delivery_config: input.delivery, on_sent: input.onSent, on_reply: input.onReply,
      sender_channel_ids: input.delivery.senderIds, status: 'draft',
      scheduled_at: scheduledAt, total_recipients: unique.length,
    }).select('id').single();
    if (insertError || !campaign) throw insertError ?? new Error('Falha ao criar disparo.');
    for (let offset = 0; offset < unique.length; offset += 200) {
      const { error } = await db.from('evolution_campaign_recipients').insert(unique.slice(offset, offset + 200)
        .map(([phone, contact], index) => ({
          campaign_id: campaign.id, account_id: accountId, contact_id: contact.id,
          phone, contact_name: contact.name, sequence_no: offset + index,
        })));
      if (error) {
        await db.from('evolution_campaigns').delete().eq('id', campaign.id);
        throw error;
      }
    }
    const { error: scheduleError } = await db.from('evolution_campaigns').update({
      status: 'scheduled', next_run_at: scheduledAt,
    }).eq('id', campaign.id).eq('account_id', accountId).eq('status', 'draft');
    if (scheduleError) throw scheduleError;
    return NextResponse.json({ campaign_id: campaign.id, recipients: unique.length }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) return toErrorResponse(error);
    console.error('[evolution-campaigns] create failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Falha ao criar disparo.' }, { status: 500 });
  }
}
