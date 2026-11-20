import { describe, it, expect } from 'vitest';
import { aggregateConnectionStatus } from './connection-status';
describe('inbox disconnection warning', () => {
  it('suppresses a disconnection warning if any number is connected', () =>
    expect(
      aggregateConnectionStatus(['disconnected', 'connected', 'unknown'])
    ).toBe('connected'));
  it('does not report pairing or reconnecting as disconnected', () => {
    expect(
      aggregateConnectionStatus(['disconnected', 'awaiting_qr_scan'])
    ).toBe('connecting');
    expect(aggregateConnectionStatus(['reconnecting'])).toBe('connecting');
  });
  it('does not infer disconnected from a failed or malformed status check', () => {
    expect(aggregateConnectionStatus(['disconnected', undefined])).toBe(
      'unknown'
    );
    expect(aggregateConnectionStatus([])).toBe('unknown');
  });
  it('only reports disconnected after all checks confirm it', () =>
    expect(aggregateConnectionStatus(['disconnected', 'logged_out'])).toBe(
      'disconnected'
    ));
});
