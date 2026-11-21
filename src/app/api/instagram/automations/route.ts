import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function GET() {
  try {
    const ctx = await requireRole('viewer');
    const { data, error } = await supabaseAdmin()
      .from('instagram_automations')
      .select(
        'id,name,trigger_type,keywords,reply_text,created_at,is_active,channel_id,target_media_id'
      )
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ automations: data });
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
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const trigger = body?.trigger_type;
    if (
      !name ||
      name.length > 150 ||
      !['message_keyword', 'first_message', 'comment_keyword'].includes(trigger)
    )
      return NextResponse.json(
        { error: 'Informe um nome e um gatilho válidos.' },
        { status: 400 }
      );
    const keywords =
      typeof body.keywords === 'string'
        ? body.keywords.trim().slice(0, 1000)
        : '';
    const reply =
      typeof body.reply_text === 'string'
        ? body.reply_text.trim().slice(0, 5000)
        : '';
    const mediaId =
      typeof body.target_media_id === 'string'
        ? body.target_media_id.trim()
        : '';
    const selectedChannel =
      typeof body.channel_id === 'string' ? body.channel_id : '';
    if (
      mediaId &&
      (trigger !== 'comment_keyword' || !/^\d{5,32}$/.test(mediaId))
    )
      return NextResponse.json(
        { error: 'Informe um ID de publicação válido.' },
        { status: 400 }
      );
    if (
      mediaId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        selectedChannel
      )
    )
      return NextResponse.json(
        { error: 'Selecione o perfil da publicação.' },
        { status: 400 }
      );
    if (mediaId) {
      const channel = await supabaseAdmin()
        .from('instagram_channels')
        .select('id')
        .eq('id', selectedChannel)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (channel.error) throw channel.error;
      if (!channel.data)
        return NextResponse.json(
          { error: 'Perfil não encontrado nesta empresa.' },
          { status: 404 }
        );
    }
    const { data, error } = await supabaseAdmin()
      .from('instagram_automations')
      .insert({
        account_id: ctx.accountId,
        name,
        trigger_type: trigger,
        keywords,
        reply_text: reply,
        target_media_id: mediaId || null,
        channel_id: mediaId ? selectedChannel : null,
      })
      .select(
        'id,name,trigger_type,keywords,reply_text,created_at,is_active,channel_id,target_media_id'
      )
      .single();
    if (error) throw error;
    return NextResponse.json({ automation: data }, { status: 201 });
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
    const id = body?.id,
      active = body?.active,
      channelId = body?.channelId;
    const uuid = (v: unknown) =>
      typeof v === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    if (
      !uuid(id) ||
      typeof active !== 'boolean' ||
      (active && !uuid(channelId))
    )
      return NextResponse.json(
        { error: 'Selecione um perfil válido.' },
        { status: 400 }
      );
    const db = supabaseAdmin();
    const rule = await db
      .from('instagram_automations')
      .select('id,trigger_type,keywords,reply_text,target_media_id,channel_id')
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .maybeSingle();
    if (rule.error) throw rule.error;
    if (!rule.data)
      return NextResponse.json(
        { error: 'Automação não encontrada.' },
        { status: 404 }
      );
    if (active) {
      if (process.env.INSTAGRAM_AUTOMATION_ENABLED !== 'true')
        return NextResponse.json(
          {
            error:
              'A execução das automações ainda não foi habilitada no servidor.',
          },
          { status: 409 }
        );
      if (
        !['first_message', 'message_keyword', 'comment_keyword'].includes(
          rule.data.trigger_type
        )
      )
        return NextResponse.json(
          { error: 'Gatilho indisponível.' },
          { status: 400 }
        );
      if (rule.data.target_media_id && rule.data.channel_id !== channelId)
        return NextResponse.json(
          { error: 'Use o perfil da publicação escolhida.' },
          { status: 400 }
        );
      if (
        !rule.data.reply_text.trim() ||
        rule.data.reply_text.length > 1000 ||
        (rule.data.trigger_type !== 'first_message' &&
          !rule.data.keywords.trim())
      )
        return NextResponse.json(
          { error: 'Preencha a mensagem e as palavras-chave do gatilho.' },
          { status: 400 }
        );
      const channel = await db
        .from('instagram_channels')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('id', channelId)
        .maybeSingle();
      if (channel.error) throw channel.error;
      if (!channel.data)
        return NextResponse.json(
          { error: 'Perfil não encontrado nesta empresa.' },
          { status: 404 }
        );
    }
    const result = await db
      .from('instagram_automations')
      .update({
        is_active: active,
        ...(active ? { channel_id: channelId } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .select(
        'id,name,trigger_type,keywords,reply_text,created_at,is_active,channel_id,target_media_id'
      )
      .maybeSingle();
    if (result.error) throw result.error;
    return NextResponse.json({ automation: result.data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
