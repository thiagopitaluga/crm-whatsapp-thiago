import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { ContactError } from '@/lib/api/v1/contacts';
import { ingestLead, updateExistingLeadConversation } from '@/lib/leads/ingest';
import { isValidQrConnectorSecret } from '@/lib/whatsapp/qr-connector';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isValidQrConnectorSecret(request.headers.get('x-connector-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const accountId =
    typeof body?.account_id === 'string' ? body.account_id.trim() : '';
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : null;
  const lastMessagePreview =
    typeof body?.last_message_preview === 'string'
      ? body.last_message_preview
      : null;
  const direction = body?.direction === 'outbound' ? 'outbound' : 'inbound';

  if (!/^[0-9a-f-]{36}$/i.test(accountId) || !phone) {
    return NextResponse.json(
      { error: 'account_id and phone are required' },
      { status: 400 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: account } = await supabase
    .from('accounts')
    .select('id')
    .eq('id', accountId)
    .maybeSingle();
  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  try {
    if (direction === 'outbound') {
      const updated = await updateExistingLeadConversation(supabase, accountId, {
        phone,
        lastMessagePreview,
      });
      return NextResponse.json({ updated });
    }

    const result = await ingestLead(supabase, accountId, {
      phone,
      name,
      lastMessagePreview,
    });
    return NextResponse.json(
      {
        contact_id: result.contactId,
        contact_created: result.contactCreated,
        conversation_id: result.conversationId,
        deal_id: result.dealId,
      },
      { status: result.contactCreated ? 201 : 200 }
    );
  } catch (error) {
    if (error instanceof ContactError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    console.error('[qr-ingest] lead ingest failed:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
