import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  readInstagramChannels,
  syncInstagramInbox,
} from '@/lib/instagram/read-api';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    const db = supabaseAdmin();
    const id = new URL(request.url).searchParams.get('conversation');
    const cached = new URL(request.url).searchParams.get('cached') === '1';
    let syncWarning: string | null = null;
    if (!cached && (!id || /^[0-9a-f-]{36}$/i.test(id))) {
      const channels = await readInstagramChannels(db, ctx.accountId);
      await Promise.all(
        channels.map(async (channel) => {
          try {
            await syncInstagramInbox(db, channel, id ?? undefined);
          } catch (error) {
            syncWarning =
              error instanceof Error
                ? error.message
                : 'Não foi possível sincronizar o Direct.';
          }
        })
      );
    }
    if (id) {
      if (!/^[0-9a-f-]{36}$/i.test(id))
        return NextResponse.json(
          { error: 'Conversa inválida.' },
          { status: 400 }
        );
      const ensured = await db.rpc('instagram_ensure_lead', {
        p_account: ctx.accountId,
        p_conversation: id,
        p_route: false,
      });
      if (ensured.error) throw ensured.error;
      const contact = ensured.data
        ? await db
            .from('contacts')
            .select('*')
            .eq('account_id', ctx.accountId)
            .eq('id', ensured.data)
            .maybeSingle()
        : { data: null, error: null };
      if (contact.error) throw contact.error;
      const { data, error } = await db
        .from('instagram_messages')
        .select('id,direction,body,created_at,metadata')
        .eq('account_id', ctx.accountId)
        .eq('conversation_id', id)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      const profile = await db
        .from('instagram_conversations')
        .select('profile_data')
        .eq('account_id', ctx.accountId)
        .eq('id', id)
        .maybeSingle();
      return NextResponse.json({
        messages: (data ?? []).reverse(),
        syncWarning,
        profile: profile.data?.profile_data ?? null,
        contact: contact.data,
      });
    }
    const { data, error } = await db.rpc('instagram_inbox_rows', {
      p_account: ctx.accountId,
    });
    if (error) throw error;
    return NextResponse.json({ conversations: data ?? [], syncWarning });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('agent');
    if (request.headers.get('origin') !== new URL(request.url).origin)
      return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
    const body = await request.json().catch(() => null);
    const id =
      typeof body?.conversationId === 'string' ? body.conversationId : '';
    if (
      /^[0-9a-f-]{36}$/i.test(id) &&
      ('assignedAgentId' in body || body.markRead === true)
    ) {
      const db = supabaseAdmin();
      const updates: Record<string, unknown> = {};
      if (body.markRead === true) updates.read_at = new Date().toISOString();
      if ('assignedAgentId' in body) {
        if (body.assignedAgentId !== null) {
          if (
            typeof body.assignedAgentId !== 'string' ||
            !/^[0-9a-f-]{36}$/i.test(body.assignedAgentId)
          )
            return NextResponse.json(
              { error: 'Responsável inválido.' },
              { status: 400 }
            );
          const member = await db
            .from('account_memberships')
            .select('user_id')
            .eq('account_id', ctx.accountId)
            .eq('user_id', body.assignedAgentId)
            .maybeSingle();
          if (member.error) throw member.error;
          if (!member.data)
            return NextResponse.json(
              { error: 'Responsável fora desta empresa.' },
              { status: 400 }
            );
        }
        updates.assigned_agent_id = body.assignedAgentId;
      }
      const changed = await db
        .from('instagram_conversations')
        .update(updates)
        .eq('account_id', ctx.accountId)
        .eq('id', id)
        .select('id')
        .maybeSingle();
      if (changed.error) throw changed.error;
      if (!changed.data)
        return NextResponse.json(
          { error: 'Conversa não encontrada.' },
          { status: 404 }
        );
      return NextResponse.json({ saved: true });
    }
    if (
      body &&
      ['open', 'closed', 'human'].includes(body.status) &&
      /^[0-9a-f-]{36}$/i.test(id)
    ) {
      const changed = await supabaseAdmin()
        .from('instagram_conversations')
        .update({ status: body.status })
        .eq('id', id)
        .eq('account_id', ctx.accountId)
        .select('id,status')
        .maybeSingle();
      if (changed.error) throw changed.error;
      if (!changed.data)
        return NextResponse.json(
          { error: 'Conversa não encontrada.' },
          { status: 404 }
        );
      return NextResponse.json({ conversation: changed.data });
    }
    const contactId = body?.contactId;
    const validId = (value: unknown) =>
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value
      );
    if (!validId(id) || (contactId !== null && !validId(contactId)))
      return NextResponse.json(
        { error: 'Contato ou conversa inválidos.' },
        { status: 400 }
      );
    const db = supabaseAdmin();
    if (contactId) {
      const { data, error } = await db
        .from('contacts')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('id', contactId)
        .maybeSingle();
      if (error) throw error;
      if (!data)
        return NextResponse.json(
          { error: 'Contato não encontrado nesta empresa.' },
          { status: 404 }
        );
    }
    const { data, error } = await db
      .from('instagram_conversations')
      .update({ contact_id: contactId })
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .select('id,contact_id')
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return NextResponse.json(
        { error: 'Conversa não encontrada.' },
        { status: 404 }
      );
    return NextResponse.json({ conversation: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    if (request.headers.get('origin') !== new URL(request.url).origin)
      return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
    const body = await request.json().catch(() => null);
    const id =
      typeof body?.conversationId === 'string' ? body.conversationId : '';
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const media = body?.media as { type?: string; url?: string } | undefined;
    if (media) {
      const prefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/instagram-flow-media/${ctx.accountId}/`;
      if (
        !['image', 'pdf'].includes(media.type ?? '') ||
        typeof media.url !== 'string' ||
        !media.url.startsWith(prefix) ||
        media.url.includes('..')
      )
        return NextResponse.json({ error: 'Anexo inválido.' }, { status: 400 });
    }
    if (!/^[0-9a-f-]{36}$/i.test(id) || (!text && !media) || text.length > 1000)
      return NextResponse.json(
        { error: 'Informe uma mensagem válida de até 1000 caracteres.' },
        { status: 400 }
      );
    const db = supabaseAdmin();
    const { data: conversation, error } = await db
      .from('instagram_conversations')
      .select('id,channel_id,instagram_user_id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) throw error;
    if (!conversation)
      return NextResponse.json(
        { error: 'Conversa não encontrada.' },
        { status: 404 }
      );
    const { data: channel, error: channelError } = await db
      .from('instagram_channels')
      .select('instagram_id,access_token_encrypted')
      .eq('id', conversation.channel_id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (channelError) throw channelError;
    if (!channel)
      return NextResponse.json(
        { error: 'Perfil não conectado.' },
        { status: 409 }
      );
    if (
      !/^\d+$/.test(channel.instagram_id) ||
      !/^\d+$/.test(conversation.instagram_user_id)
    )
      return NextResponse.json({ error: 'Canal inválido.' }, { status: 400 });
    const response = await fetch(
      `https://graph.instagram.com/v25.0/${channel.instagram_id}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + decrypt(channel.access_token_encrypted),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: { id: conversation.instagram_user_id },
          message: media
            ? {
                attachment: {
                  type: media.type === 'image' ? 'image' : 'file',
                  payload: { url: media.url, is_reusable: true },
                },
              }
            : { text },
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
      }
    );
    const result = (await response.json().catch(() => ({}))) as {
      message_id?: string;
    };
    if (!response.ok || !result.message_id)
      return NextResponse.json(
        {
          error:
            'A Meta não confirmou o envio. Confira a conexão e a janela de atendimento.',
        },
        { status: 502 }
      );
    const { error: saveError } = await db.from('instagram_messages').upsert(
      {
        account_id: ctx.accountId,
        conversation_id: id,
        external_id: result.message_id,
        direction: 'outbound',
        body: media
          ? media.type === 'image'
            ? '[Imagem]'
            : '[Documento PDF]'
          : text,
        metadata: media
          ? {
              attachments:
                media.type === 'image'
                  ? [{ image_data: { url: media.url } }]
                  : [{ file_url: media.url }],
            }
          : {},
      },
      { onConflict: 'external_id', ignoreDuplicates: true }
    );
    if (saveError)
      return NextResponse.json(
        {
          error:
            'Mensagem enviada, mas não foi possível salvar no histórico. Confira antes de reenviar.',
        },
        { status: 500 }
      );
    await db
      .from('instagram_conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('account_id', ctx.accountId)
      .eq('id', id);
    return NextResponse.json({ sent: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
