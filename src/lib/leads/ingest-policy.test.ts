import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/api/v1/contacts', () => ({
  findOrCreateContact: vi.fn(),
  resolveAuditUserId: vi.fn(),
}));
vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: vi.fn().mockResolvedValue(null),
  isUniqueViolation: vi.fn(),
}));

import { findOrCreateContact, resolveAuditUserId } from '@/lib/api/v1/contacts';
import { ingestExternalWhatsAppMessage } from './ingest';

it('ignores old, synthetic and undated worker events without touching the database', async () => {
  const db = { from: vi.fn(), rpc: vi.fn() };
  for (const invalid of [
    { contentText: '[Mensagem]' },
    { createdAt: '2020-01-01T00:00:00Z' },
    { createdAt: null },
    { messageId: '' },
  ]) {
    expect(
      await ingestExternalWhatsAppMessage(
        db as unknown as SupabaseClient,
        'account',
        {
          phone: '5511999999999',
          direction: 'inbound',
          messageId: 'provider-id',
          contentText: 'Olá',
          contentType: 'text',
          createdAt: new Date().toISOString(),
          ...invalid,
        }
      )
    ).toBeNull();
  }
  expect(db.from).not.toHaveBeenCalled();
  expect(db.rpc).not.toHaveBeenCalled();
  expect(findOrCreateContact).not.toHaveBeenCalled();
  expect(resolveAuditUserId).not.toHaveBeenCalled();
});

it('does not turn an outbound event to an unknown number into a contact', async () => {
  expect(
    await ingestExternalWhatsAppMessage({} as SupabaseClient, 'account', {
      phone: '5511999999999',
      direction: 'outbound',
      messageId: 'sent-id',
      contentText: 'Olá',
      contentType: 'text',
      createdAt: new Date().toISOString(),
    })
  ).toBeNull();
  expect(findOrCreateContact).not.toHaveBeenCalled();
});
