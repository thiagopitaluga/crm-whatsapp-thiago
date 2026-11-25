import { describe, expect, it } from 'vitest';
import {
  parseEvolutionReceipt,
  receiptPreviousStatuses,
} from './evolution-receipts';

describe('Evolution delivery receipts', () => {
  it('maps delivery and read acknowledgments, ignoring inbound events', () => {
    expect(
      parseEvolutionReceipt({ keyId: 'message', status: 'DELIVERY_ACK' })
    ).toEqual({ id: 'message', status: 'delivered' });
    expect(
      parseEvolutionReceipt({
        key: { id: 'message', fromMe: true },
        update: { status: 'READ' },
      })
    ).toEqual({ id: 'message', status: 'read' });
    expect(
      parseEvolutionReceipt({ keyId: 'message', status: 'READ', fromMe: false })
    ).toBeNull();
    expect(
      parseEvolutionReceipt({ keyId: 'message', status: 'PENDING' })
    ).toBeNull();
  });

  it('prevents late failures and acknowledgments from rolling back delivered messages', () => {
    expect(receiptPreviousStatuses.failed).not.toContain('delivered');
    expect(receiptPreviousStatuses.delivered).not.toContain('read');
    expect(receiptPreviousStatuses.read).toContain('delivered');
  });
});
