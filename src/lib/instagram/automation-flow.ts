export type TriggerConfig = {
  id?: string;
  type: string;
  matchMode?: 'any' | 'keywords';
  keywords?: string;
  excludedKeywords?: string;
  targetMediaId?: string | null;
  publicRepliesEnabled?: boolean;
  publicReplies?: string[];
  autoLike?: boolean;
};

export type SendableContent = {
  id?: string;
  type: 'text' | 'image' | 'pdf';
  text?: string;
  url?: string;
};

export type DelayContent = {
  id?: string;
  type: 'delay';
  seconds?: number;
};

export type ContentBlock = SendableContent | DelayContent;

export type MessageButton = {
  id?: string;
  text: string;
  type?: 'url' | 'flow';
  url?: string;
  targetNodeId?: string;
};

export type FlowContact = {
  tags?: string | null;
  custom_fields?: string | null;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
};

export type FlowGraphNode = {
  id: string;
  data?: {
    kind?: string;
    text?: string;
    tags?: string;
    seconds?: number;
    minutes?: number;
    condition?: string;
    conditionOperator?: string;
    conditionValue?: string;
    triggers?: TriggerConfig[];
    triggerType?: string;
    keywords?: string;
    targetMediaId?: string | null;
    contentBlocks?: ContentBlock[];
    buttons?: MessageButton[];
  };
};

export type FlowGraphEdge = {
  source: string;
  target: string;
  sourceHandle?: string | null;
};

export type FlowPlanStep =
  | { type: 'content'; content: SendableContent; buttons: MessageButton[] }
  | { type: 'delay'; seconds: number };

export type FlowPlan = {
  steps: FlowPlanStep[];
  tags: string[];
  stoppedByCycle: boolean;
};

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function conditionResult(
  node: FlowGraphNode,
  contact: FlowContact | null,
  now: number
) {
  const data = node.data;
  const value = data?.conditionValue || '';
  const tags = parseJson<string[]>(contact?.tags, []);
  const fields = parseJson<Record<string, unknown>>(contact?.custom_fields, {});

  if (data?.condition === 'follows_profile')
    return fields.followsProfile === true;
  if (data?.condition === 'has_tag') return tags.includes(value);
  if (data?.condition === 'not_has_tag') return !tags.includes(value);
  if (data?.condition === 'verified_profile') {
    return String(fields.verifiedProfile === true) === (value || 'true');
  }
  if (data?.condition === 'followers_count') {
    const count = Number(fields.followerCount || 0);
    return data.conditionOperator === 'lte'
      ? count <= Number(value || 0)
      : count >= Number(value || 0);
  }
  if (['last_interaction', 'last_seen'].includes(data?.condition || '')) {
    const date = contact?.last_seen_at || contact?.first_seen_at;
    const elapsedDays = date
      ? (now - new Date(date).getTime()) / 86_400_000
      : Number.POSITIVE_INFINITY;
    return data?.conditionOperator === 'before'
      ? elapsedDays > Number(value || 7)
      : elapsedDays <= Number(value || 7);
  }
  return false;
}

function messageSteps(
  node: FlowGraphNode,
  edges: FlowGraphEdge[]
): FlowPlanStep[] {
  const data = node.data;
  const blocks = data?.contentBlocks?.length
    ? data.contentBlocks
    : data?.text?.trim()
      ? [{ type: 'text' as const, text: data.text.trim() }]
      : [];
  const steps: FlowPlanStep[] = blocks.map((block) =>
    block.type === 'delay'
      ? {
          type: 'delay' as const,
          seconds: Math.max(0, Number(block.seconds || 0)),
        }
      : { type: 'content' as const, content: block, buttons: [] }
  );
  const lastContent = steps.findLastIndex((step) => step.type === 'content');
  if (lastContent >= 0 && steps[lastContent].type === 'content') {
    const buttons = (data?.buttons || []).map((button) => {
      if ((button.type || 'url') !== 'flow' || !button.id) return button;
      const edge = edges.find(
        (item) =>
          item.source === node.id && item.sourceHandle === `button:${button.id}`
      );
      return { ...button, targetNodeId: edge?.target || button.targetNodeId };
    });
    steps[lastContent] = { ...steps[lastContent], buttons };
  }
  return steps;
}

export function resolveFlowPlan(
  raw: string | null,
  contact: FlowContact | null,
  now = Date.now(),
  startNodeId?: string
): FlowPlan {
  const graph = parseJson<{ nodes?: FlowGraphNode[]; edges?: FlowGraphEdge[] }>(
    raw,
    {}
  );
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const steps: FlowPlanStep[] = [];
  const tags: string[] = [];
  let current = startNodeId
    ? nodes.find((node) => node.id === startNodeId)
    : nodes.find((node) => node.data?.kind === 'trigger');
  const visited = new Set<string>();

  while (current && !visited.has(current.id) && visited.size < 50) {
    visited.add(current.id);
    if (current.data?.kind === 'message')
      steps.push(...messageSteps(current, edges));
    if (current.data?.kind === 'delay') {
      const legacySeconds = Number(
        current.data.seconds ?? current.data.minutes ?? 0
      );
      steps.push({ type: 'delay', seconds: Math.max(0, legacySeconds) });
    }
    if (current.data?.kind === 'tag') {
      tags.push(
        ...(current.data.tags || '')
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      );
    }

    let branch: string | undefined;
    if (current.data?.kind === 'condition') {
      branch = conditionResult(current, contact, now) ? 'true' : 'false';
    }
    const edge = edges.find(
      (item) =>
        item.source === current!.id &&
        (branch ? item.sourceHandle === branch : !item.sourceHandle)
    );
    current = edge ? nodes.find((node) => node.id === edge.target) : undefined;
  }

  return { steps, tags, stoppedByCycle: Boolean(current) };
}

export function composePrivateReply(plan: FlowPlan, fallback: string) {
  const parts: string[] = [];
  for (const step of plan.steps) {
    if (step.type === 'delay') break;
    if (step.content.type === 'text' && step.content.text?.trim())
      parts.push(step.content.text.trim());
    if (step.content.type !== 'text' && step.content.url)
      parts.push(step.content.url);
    for (const button of step.buttons) {
      if (
        (button.type || 'url') === 'url' &&
        button.text.trim() &&
        button.url &&
        /^https?:\/\//i.test(button.url)
      ) {
        parts.push(`${button.text.trim()}: ${button.url}`);
      }
    }
  }
  return parts.join('\n\n').trim() || fallback;
}

export function triggerTextMatchScore(config: TriggerConfig, text: string) {
  const normalized = text.trim().toLocaleLowerCase('pt-BR');
  const excluded = (config.excludedKeywords || '')
    .split(',')
    .map((word) => word.trim().toLocaleLowerCase('pt-BR'))
    .filter(Boolean);
  if (excluded.some((word) => normalized.includes(word))) return -1;
  if ((config.matchMode || (config.keywords ? 'keywords' : 'any')) === 'any')
    return 0;
  const keywords = (config.keywords || '')
    .split(',')
    .map((word) => word.trim().toLocaleLowerCase('pt-BR'))
    .filter(Boolean);
  let score = -1;
  for (const keyword of keywords) {
    if (!normalized.includes(keyword)) continue;
    score = Math.max(
      score,
      keyword.length + (normalized === keyword ? 10_000 : 0)
    );
  }
  return score;
}
