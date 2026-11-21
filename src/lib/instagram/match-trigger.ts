import { triggerTextMatchScore } from './automation-flow';

export type InstagramRule = {
  id: string;
  trigger_type: string;
  keywords: string;
  reply_text: string;
  channel_id: string | null;
  target_media_id?: string | null;
};
export function selectInstagramCommentRule(
  rules: InstagramRule[],
  text: string,
  mediaId: string | null
): InstagramRule | null {
  const candidates = rules
    .filter(
      (rule) =>
        rule.trigger_type === 'comment_keyword' &&
        (!rule.target_media_id || rule.target_media_id === mediaId)
    )
    .map((rule) => ({
      rule,
      score:
        rule.keywords.trim() && rule.reply_text.trim()
          ? triggerTextMatchScore(
              {
                type: 'comment_keyword',
                matchMode: 'keywords',
                keywords: rule.keywords,
              },
              text
            )
          : -1,
    }))
    .filter((item) => item.score >= 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(Boolean(b.rule.target_media_id)) -
          Number(Boolean(a.rule.target_media_id))
    );
  return candidates[0]?.rule ?? null;
}
/** Select one rule deterministically; exact keyword matches outrank partial matches. */
export function selectInstagramMessageRule(
  rules: InstagramRule[],
  text: string,
  channelId: string,
  firstMessage: boolean
): InstagramRule | null {
  const ranked = rules.flatMap((rule, index) => {
    if (rule.channel_id && rule.channel_id !== channelId) return [];
    if (!rule.reply_text.trim()) return [];
    if (rule.trigger_type === 'first_message')
      return firstMessage ? [{ rule, score: -1, index }] : [];
    if (rule.trigger_type !== 'message_keyword' || !rule.keywords.trim())
      return [];
    const score = triggerTextMatchScore(
      {
        type: 'message_keyword',
        matchMode: 'keywords',
        keywords: rule.keywords,
      },
      text
    );
    return score < 0 ? [] : [{ rule, score, index }];
  });
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked[0]?.rule ?? null;
}
