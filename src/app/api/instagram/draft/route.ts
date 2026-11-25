import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { loadAiConfig } from '@/lib/ai/config';
import { buildSystemPrompt } from '@/lib/ai/defaults';
import { retrieveKnowledge } from '@/lib/ai/knowledge';
import { generateReply } from '@/lib/ai/generate';
import { logAiUsage } from '@/lib/ai/usage';
import { AiError, type ChatMessage } from '@/lib/ai/types';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    if (request.headers.get('origin') !== new URL(request.url).origin)
      return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
    for (const [key, limit] of [
      [`ai-draft:${ctx.userId}`, RATE_LIMITS.aiDraft],
      [`ai-draft-acct:${ctx.accountId}`, RATE_LIMITS.aiDraftAccount],
    ] as const) {
      const r = checkRateLimit(key, limit);
      if (!r.success) return rateLimitResponse(r);
    }
    const body = await request.json();
    if (
      typeof body.conversationId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(body.conversationId)
    )
      return NextResponse.json(
        { error: 'Conversa inválida.' },
        { status: 400 }
      );
    const db = supabaseAdmin();
    const conversation = await db
      .from('instagram_conversations')
      .select('id')
      .eq('account_id', ctx.accountId)
      .eq('id', body.conversationId)
      .maybeSingle();
    if (conversation.error) throw conversation.error;
    if (!conversation.data)
      return NextResponse.json(
        { error: 'Conversa não encontrada.' },
        { status: 404 }
      );
    const config = await loadAiConfig(db, ctx.accountId);
    if (!config)
      return NextResponse.json(
        { error: 'Configure o agente de IA da empresa para gerar sugestões.' },
        { status: 409 }
      );
    const history = await db
      .from('instagram_messages')
      .select('direction,body')
      .eq('account_id', ctx.accountId)
      .eq('conversation_id', body.conversationId)
      .order('created_at', { ascending: false })
      .limit(30);
    if (history.error) throw history.error;
    const messages: ChatMessage[] = (history.data ?? [])
      .reverse()
      .map((m) => ({
        role: m.direction === 'inbound' ? 'user' : 'assistant',
        content: m.body.slice(0, 2000),
      }));
    if (!messages.length)
      return NextResponse.json(
        { error: 'Aguarde uma mensagem para gerar uma sugestão.' },
        { status: 400 }
      );
    const query =
      [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const knowledge = await retrieveKnowledge(db, ctx.accountId, config, query);
    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'draft',
      knowledge,
      agentSettings: config.agentSettings,
    });
    const result = await generateReply({
      config,
      systemPrompt:
        systemPrompt +
        '\nResponda para o Instagram Direct em até 1000 caracteres. Gere apenas uma sugestão para revisão humana.',
      messages,
    });
    await logAiUsage(db, {
      accountId: ctx.accountId,
      conversationId: null,
      mode: 'draft',
      provider: config.provider,
      model: config.model,
      usage: result.usage,
    });
    return NextResponse.json({ draft: result.text.slice(0, 1000) });
  } catch (error) {
    if (error instanceof AiError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    return toErrorResponse(error);
  }
}
