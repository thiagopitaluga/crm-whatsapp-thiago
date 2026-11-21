import { describe, expect, it } from 'vitest';
import {
  selectInstagramCommentRule,
  selectInstagramMessageRule,
  type InstagramRule,
} from './match-trigger';
const rule = (data: Partial<InstagramRule>): InstagramRule => ({
  id: '1',
  trigger_type: 'message_keyword',
  keywords: 'preço',
  reply_text: 'Olá',
  channel_id: null,
  ...data,
});
describe('Instagram message rules', () => {
  it('chooses exact matches before partial matches', () => {
    const match = selectInstagramMessageRule(
      [
        rule({ id: 'partial', keywords: 'pre' }),
        rule({ id: 'exact', keywords: 'preço' }),
      ],
      'Preço',
      'channel',
      true
    );
    expect(match?.id).toBe('exact');
  });
  it('does not run rules from another channel or rules without replies', () => {
    expect(
      selectInstagramMessageRule(
        [rule({ channel_id: 'other' }), rule({ reply_text: '' })],
        'preço',
        'channel',
        true
      )
    ).toBeNull();
  });
  it('only matches first-message rules on a first message and ignores comment rules', () => {
    const rules = [
      rule({ trigger_type: 'first_message' }),
      rule({ id: 'comment', trigger_type: 'comment_keyword' }),
    ];
    expect(
      selectInstagramMessageRule(rules, 'olá', 'channel', false)
    ).toBeNull();
    expect(selectInstagramMessageRule(rules, 'olá', 'channel', true)?.id).toBe(
      '1'
    );
  });
});

describe('Instagram comment rules', () => {
  it('prefers the matching publication when keywords tie', () => {
    const rules = [
      rule({ id: 'all', trigger_type: 'comment_keyword' }),
      rule({
        id: 'post',
        trigger_type: 'comment_keyword',
        target_media_id: '12345',
      }),
    ];
    expect(selectInstagramCommentRule(rules, 'preço', '12345')?.id).toBe(
      'post'
    );
    expect(selectInstagramCommentRule(rules, 'preço', '99999')?.id).toBe('all');
  });
  it('ignores a specific post when media is missing and ignores empty keywords', () => {
    const rules = [
      rule({ trigger_type: 'comment_keyword', target_media_id: '12345' }),
      rule({ trigger_type: 'comment_keyword', keywords: '' }),
    ];
    expect(selectInstagramCommentRule(rules, 'preço', null)).toBeNull();
  });
});
