import type { FlowGraphNode } from './automation-flow';
export const INSTAGRAM_TRIGGERS = [
  'message_keyword',
  'first_message',
  'comment_keyword',
  'story_reply',
  'story_mention',
  'ad_message',
  'live_comment',
  'share_to_dm',
  'ref_url',
  'conversation_starter',
  'follow_to_dm',
  'default_reply',
] as const;
export type VisualGraph = {
  nodes: Array<{
    id: string;
    position: { x: number; y: number };
    data: NonNullable<FlowGraphNode['data']> & {
      kind: string;
      title?: string;
      subtitle?: string;
    };
    [key: string]: unknown;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    [key: string]: unknown;
  }>;
};
export function validHttps(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' && !!u.hostname && !u.username && !u.password
    );
  } catch {
    return false;
  }
}
export function validateInstagramGraph(
  value: unknown,
  activating = false
): asserts value is VisualGraph {
  const fail: (message: string) => never = (message) => {
    throw new Error(message);
  };
  if (
    !value ||
    typeof value !== 'object' ||
    JSON.stringify(value).length > 200000
  )
    fail('Fluxo inválido ou muito grande.');
  const graph = value as VisualGraph;
  if (
    !Array.isArray(graph.nodes) ||
    !graph.nodes.length ||
    graph.nodes.length > 100 ||
    !Array.isArray(graph.edges) ||
    graph.edges.length > 200
  )
    fail('Use até 100 blocos e 200 conexões.');
  const ids = new Set<string>();
  const kinds = ['trigger', 'message', 'condition', 'delay', 'tag', 'action'];
  for (const n of graph.nodes) {
    if (
      !n ||
      typeof n.id !== 'string' ||
      !/^[\w-]{1,100}$/.test(n.id) ||
      ids.has(n.id) ||
      !n.data ||
      !kinds.includes(n.data.kind) ||
      !Number.isFinite(n.position?.x) ||
      !Number.isFinite(n.position?.y)
    )
      fail('Bloco inválido ou repetido.');
    ids.add(n.id);
    const d = n.data;
    for (const key of [
      'title',
      'subtitle',
      'text',
      'tags',
      'conditionValue',
    ] as const)
      if (
        d[key] !== undefined &&
        (typeof d[key] !== 'string' || d[key].length > 5000)
      )
        fail('Texto de bloco inválido.');
    if (d.kind === 'trigger') {
      if (
        !Array.isArray(d.triggers) ||
        !d.triggers.length ||
        d.triggers.length > 12
      )
        fail('Configure pelo menos um gatilho.');
      for (const t of d.triggers) {
        if (
          !t ||
          !INSTAGRAM_TRIGGERS.some((type) => type === t.type) ||
          !['any', 'keywords', undefined].includes(t.matchMode) ||
          [t.keywords, t.excludedKeywords].some(
            (x) => x !== undefined && (typeof x !== 'string' || x.length > 1000)
          ) ||
          (t.targetMediaId && !/^\d{5,32}$/.test(t.targetMediaId))
        )
          fail('Configuração de gatilho inválida.');
        if (
          t.publicReplies !== undefined &&
          (!Array.isArray(t.publicReplies) ||
            t.publicReplies.length > 10 ||
            t.publicReplies.some(
              (x: unknown) => typeof x !== 'string' || x.length > 1000
            ))
        )
          fail('Respostas públicas inválidas.');
        if (activating && t.type === 'follow_to_dm')
          fail(
            'A Meta não fornece o evento de novo seguidor nesta integração. Escolha outro gatilho.'
          );
        if (activating && t.matchMode === 'keywords' && !t.keywords?.trim())
          fail('Preencha as palavras-chave dos gatilhos.');
      }
    }
    if (
      d.kind === 'delay' &&
      (!Number.isFinite(d.seconds) ||
        (d.seconds ?? -1) < 0 ||
        (d.seconds ?? 31) > 30)
    )
      fail('A espera deve ficar entre 0 e 30 segundos.');
    if (
      d.kind === 'condition' &&
      ![
        'follows_profile',
        'has_tag',
        'not_has_tag',
        'last_interaction',
        'last_seen',
        'followers_count',
        'verified_profile',
      ].includes(d.condition || '')
    )
      fail('Condição inválida.');
    if (
      d.kind === 'action' &&
      d.actionType &&
      !['none', 'open', 'close', 'human', 'remove_tag'].includes(d.actionType)
    )
      fail('Ação inválida.');
    if (d.kind === 'message') {
      if (
        !Array.isArray(d.contentBlocks) ||
        d.contentBlocks.length > 20 ||
        !Array.isArray(d.buttons) ||
        d.buttons.length > 3
      )
        fail('Use até 20 conteúdos e 3 botões por mensagem.');
      for (const b of d.contentBlocks) {
        if (!b || !['text', 'image', 'pdf', 'delay'].includes(b.type))
          fail('Conteúdo inválido.');
        if (
          b.type === 'text' &&
          (typeof b.text !== 'string' ||
            b.text.length > 1000 ||
            (activating && !b.text.trim()))
        )
          fail(
            'Cada texto precisa ter entre 1 e 1.000 caracteres para ativar.'
          );
        if (
          (b.type === 'image' || b.type === 'pdf') &&
          ((b.url && !validHttps(b.url)) || (activating && !b.url))
        )
          fail('Informe um endereço HTTPS ou envie o arquivo.');
        if (
          b.type === 'delay' &&
          (!Number.isFinite(b.seconds) ||
            (b.seconds ?? -1) < 0 ||
            (b.seconds ?? 31) > 30)
        )
          fail('O atraso deve ficar entre 0 e 30 segundos.');
      }
      if (
        activating &&
        d.buttons.length &&
        d.contentBlocks.some(
          (b) => b.type === 'text' && (b.text?.length || 0) > 640
        )
      )
        fail('Texto com botões deve ter até 640 caracteres.');
      for (const b of d.buttons) {
        if (
          !b ||
          typeof b.id !== 'string' ||
          typeof b.text !== 'string' ||
          b.text.length > 20 ||
          !['url', 'flow', undefined].includes(b.type)
        )
          fail('Botão inválido. Use títulos de até 20 caracteres.');
        if (
          activating &&
          (!b.text.trim() ||
            ((b.type || 'url') === 'url' && !validHttps(b.url)))
        )
          fail('Preencha o título e o endereço HTTPS dos botões.');
      }
      if (activating && !d.contentBlocks.some((b) => b.type !== 'delay'))
        fail('Adicione conteúdo ao bloco de mensagem.');
      if (
        activating &&
        d.buttons.length &&
        d.contentBlocks.filter((b) => b.type !== 'delay').at(-1)?.type !==
          'text'
      )
        fail('Os botões devem acompanhar um texto no final do bloco.');
    }
  }
  if (graph.nodes.filter((n) => n.data.kind === 'trigger').length !== 1)
    fail('O fluxo deve ter um único bloco inicial.');
  const handles = new Set<string>();
  for (const e of graph.edges) {
    if (
      !e ||
      !ids.has(e.source) ||
      !ids.has(e.target) ||
      graph.nodes.find((n) => n.id === e.target)?.data.kind === 'trigger'
    )
      fail('Conexão inválida.');
    const source = graph.nodes.find((n) => n.id === e.source)!;
    if (
      e.sourceHandle &&
      !(source.data.kind === 'condition'
        ? ['true', 'false'].includes(e.sourceHandle)
        : source.data.buttons?.some((b) => e.sourceHandle === `button:${b.id}`))
    )
      fail('Saída de conexão inválida.');
    const key = e.source + ':' + (e.sourceHandle || '');
    if (handles.has(key)) fail('Cada saída pode ter apenas uma conexão.');
    handles.add(key);
  }
  for (const n of graph.nodes)
    for (const b of n.data.buttons || [])
      if (
        activating &&
        b.type === 'flow' &&
        !graph.edges.some(
          (e) => e.source === n.id && e.sourceHandle === `button:${b.id}`
        )
      )
        fail('Conecte o destino de cada botão de fluxo.');
  const visited = new Set<string>(),
    stack = new Set<string>();
  function visit(id: string) {
    if (stack.has(id))
      fail(
        'O fluxo contém um ciclo automático. Use um botão para retornar a outra etapa.'
      );
    if (visited.has(id)) return;
    stack.add(id);
    for (const e of graph.edges.filter(
      (e) => e.source === id && !e.sourceHandle?.startsWith('button:')
    ))
      visit(e.target);
    stack.delete(id);
    visited.add(id);
  }
  for (const id of ids) visit(id);
  if (
    activating &&
    !graph.edges.some(
      (e) => e.source === graph.nodes.find((n) => n.data.kind === 'trigger')!.id
    )
  )
    fail('Conecte o gatilho ao próximo bloco.');
}
