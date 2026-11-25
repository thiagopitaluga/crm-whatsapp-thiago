import type { MessageStatus } from '@/types';

const receipts = {
  SERVER_ACK: 'sent',
  DELIVERY_ACK: 'delivered',
  READ: 'read',
  PLAYED: 'read',
  ERROR: 'failed',
} as const;

export const receiptPreviousStatuses: Record<string, MessageStatus[]> = {
  sent: ['sending'],
  delivered: ['sending', 'sent', 'failed'],
  read: ['sending', 'sent', 'delivered', 'failed'],
  failed: ['sending', 'sent'],
};

function record(value: unknown) {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export function parseEvolutionReceipt(value: unknown) {
  const row = record(value);
  const key = record(row?.key);
  const update = record(row?.update);
  const id = row?.keyId ?? key?.id;
  const status = row?.status ?? update?.status;
  if ((row?.fromMe ?? key?.fromMe) === false || typeof id !== 'string' || !id)
    return null;
  if (typeof status !== 'string' || !Object.hasOwn(receipts, status))
    return null;
  return { id, status: receipts[status as keyof typeof receipts] };
}
