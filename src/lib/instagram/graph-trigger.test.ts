import { describe, it, expect } from 'vitest';
import { matchGraphTrigger, type GraphRule } from './graph-trigger';
const rule = (
  type: string,
  id = type,
  config: Record<string, unknown> = {}
): GraphRule => ({
  id,
  channel_id: 'channel-a',
  trigger_type: type,
  reply_text: 'Olá',
  keywords: '',
  flow_graph: {
    nodes: [
      {
        data: {
          kind: 'trigger',
          triggers: [{ type, matchMode: 'any', ...config }],
        },
      },
    ],
  },
});
describe('Instagram event routing', () => {
  it('does not mistake a normal DM for an advertisement or reference link', () => {
    expect(
      matchGraphTrigger([rule('ad_message'), rule('ref_url')], 'channel-a', {
        kind: 'message',
        text: 'vim do anúncio',
      })
    ).toBeNull();
  });
  it('uses actual ad metadata and excludes foreign channels', () => {
    expect(
      matchGraphTrigger([rule('ad_message')], 'channel-a', {
        kind: 'message',
        text: 'Olá',
        ad: true,
      })?.rule.id
    ).toBe('ad_message');
    expect(
      matchGraphTrigger([rule('ad_message')], 'channel-b', {
        kind: 'message',
        text: 'Olá',
        ad: true,
      })
    ).toBeNull();
  });
  it('does not confuse a DM with a comment rule', () => {
    expect(
      matchGraphTrigger([rule('comment_keyword')], 'channel-a', {
        kind: 'message',
        text: 'Olá',
      })
    ).toBeNull();
  });
  it('matches secondary triggers and respects excluded words and publication scope', () => {
    const r = rule('message_keyword');
    (r.flow_graph as any).nodes[0].data.triggers.push({
      type: 'comment_keyword',
      matchMode: 'keywords',
      keywords: 'cupom',
      excludedKeywords: 'spam',
      targetMediaId: '12345',
    });
    expect(
      matchGraphTrigger([r], 'channel-a', {
        kind: 'comment',
        text: 'cupom',
        mediaId: '12345',
      })
    ).not.toBeNull();
    expect(
      matchGraphTrigger([r], 'channel-a', {
        kind: 'comment',
        text: 'cupom spam',
        mediaId: '12345',
      })
    ).toBeNull();
    expect(
      matchGraphTrigger([r], 'channel-a', {
        kind: 'comment',
        text: 'cupom',
        mediaId: '99999',
      })
    ).toBeNull();
  });
  it('uses the fallback only if no more specific message rule matches', () => {
    const rs = [
      rule('default_reply'),
      rule('message_keyword', 'specific', {
        matchMode: 'keywords',
        keywords: 'preço',
      }),
    ];
    expect(
      matchGraphTrigger(rs, 'channel-a', { kind: 'message', text: 'preço' })
        ?.rule.id
    ).toBe('specific');
    expect(
      matchGraphTrigger(rs, 'channel-a', { kind: 'message', text: 'outro' })
        ?.rule.id
    ).toBe('default_reply');
  });
});
