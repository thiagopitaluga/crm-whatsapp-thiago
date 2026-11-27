import { describe, expect, it } from 'vitest';
import { calculateServiceMetrics } from './report-service-metrics';
describe('WhatsApp service report', () => {
  it('counts each conversation once and uses the first response after inbound', () => {
    const result = calculateServiceMetrics([
      { conversation_id: 'a', sender_type: 'agent', created_at: '2026-11-09T10:02:00Z' },
      { conversation_id: 'a', sender_type: 'customer', created_at: '2026-11-09T10:00:00Z' },
      { conversation_id: 'a', sender_type: 'customer', created_at: '2026-11-09T10:01:00Z' },
      { conversation_id: 'a', sender_type: 'agent', created_at: '2026-11-09T09:00:00Z' },
      { conversation_id: 'b', sender_type: 'customer', created_at: '2026-11-09T10:00:00Z' },
      { conversation_id: 'b', sender_type: 'bot', created_at: '2026-11-09T10:30:00Z' },
      { conversation_id: 'c', sender_type: 'customer', created_at: '2026-11-09T10:00:00Z' },
      { conversation_id: 'outgoing-only', sender_type: 'agent', created_at: '2026-11-09T10:00:00Z' },
    ]);
    expect(result).toEqual({ received: 3, replied: 2, unanswered: 1, averageSeconds: 960, withinFiveMinutes: 1, withinHour: 2 });
  });
  it('does not invent response time when there were no responses', () => {
    expect(calculateServiceMetrics([])).toMatchObject({ received: 0, averageSeconds: null });
  });
});
