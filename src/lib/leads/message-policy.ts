/** Enforce the same capture policy at the CRM boundary as at the QR worker. */
export function acceptsWhatsAppMessage(
  input: {
    messageId?: string | null;
    contentText?: string | null;
    createdAt?: string | null;
  },
  now = Date.now()
): boolean {
  if (!input.messageId?.trim() || !input.contentText?.trim()) return false;
  // Older workers invented this text for protocol/sync/unsupported events.
  if (/^\[mensagem\]$/i.test(input.contentText.trim())) return false;
  if (!input.createdAt) return false;
  const timestamp = Date.parse(input.createdAt);
  const age = now - timestamp;
  return (
    Number.isFinite(timestamp) && age >= -5 * 60_000 && age <= 24 * 60 * 60_000
  );
}
