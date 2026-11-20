export function aggregateConnectionStatus(
  statuses: unknown[],
  cloudConnected = false
): 'connected' | 'connecting' | 'unknown' | 'disconnected' {
  if (cloudConnected || statuses.includes('connected')) return 'connected';
  if (
    statuses.some((s) =>
      ['connecting', 'reconnecting', 'starting', 'awaiting_qr_scan'].includes(
        String(s)
      )
    )
  )
    return 'connecting';
  return statuses.length &&
    statuses.every((s) => s === 'disconnected' || s === 'logged_out')
    ? 'disconnected'
    : 'unknown';
}
