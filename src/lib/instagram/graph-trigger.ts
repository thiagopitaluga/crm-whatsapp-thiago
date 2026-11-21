import { triggerTextMatchScore, type TriggerConfig } from './automation-flow';
export type GraphRule = {
  id: string;
  channel_id: string | null;
  trigger_type: string;
  keywords: string;
  reply_text: string;
  target_media_id?: string | null;
  flow_graph?: unknown;
};
export type TriggerEvent = {
  text: string;
  kind: 'message' | 'comment' | 'live_comment';
  mediaId?: string | null;
  firstMessage?: boolean;
  storyReply?: boolean;
  storyMention?: boolean;
  ad?: boolean;
  shared?: boolean;
  reference?: string;
  starter?: boolean;
};
export function graphTriggers(rule: GraphRule): TriggerConfig[] {
  const graph = rule.flow_graph as {
    nodes?: Array<{ data?: { kind?: string; triggers?: TriggerConfig[] } }>;
  };
  return (
    graph?.nodes?.find((n) => n.data?.kind === 'trigger')?.data?.triggers || [
      {
        type: rule.trigger_type,
        keywords: rule.keywords,
        matchMode: rule.keywords ? 'keywords' : 'any',
        targetMediaId: rule.target_media_id,
      },
    ]
  );
}
export function matchGraphTrigger(
  rules: GraphRule[],
  channelId: string,
  event: TriggerEvent
) {
  const ranked = rules.flatMap((rule, index) => {
    if (rule.channel_id !== channelId) return [];
    return graphTriggers(rule).flatMap((config) => {
      let eligible = false,
        priority = 0;
      if (event.kind !== 'message')
        eligible =
          config.type === event.kind ||
          (event.kind === 'comment' && config.type === 'comment_keyword');
      else
        switch (config.type) {
          case 'first_message':
            eligible = !!event.firstMessage;
            priority = 20000;
            break;
          case 'story_reply':
            eligible = !!event.storyReply;
            priority = 100;
            break;
          case 'story_mention':
            eligible = !!event.storyMention;
            priority = 100;
            break;
          case 'ad_message':
            eligible = !!event.ad;
            priority = 100;
            break;
          case 'share_to_dm':
            eligible = !!event.shared;
            priority = 100;
            break;
          case 'ref_url':
            eligible = !!event.reference;
            priority = 100;
            break;
          case 'conversation_starter':
            eligible = !!event.starter;
            priority = 100;
            break;
          case 'message_keyword':
            eligible = true;
            break;
          case 'default_reply':
            eligible = true;
            priority = -0.5;
            break;
        }
      if (
        !eligible ||
        (config.targetMediaId && config.targetMediaId !== event.mediaId)
      )
        return [];
      const score = triggerTextMatchScore(
        config,
        config.type === 'ref_url' ? event.reference || '' : event.text
      );
      return score < 0
        ? []
        : [{ rule, config, score: score + priority, index }];
    });
  });
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked[0] || null;
}
