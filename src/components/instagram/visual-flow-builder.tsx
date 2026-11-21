'use client';

import {
  Background,
  BaseEdge,
  ConnectionMode,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  getSmoothStepPath,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeProps,
  type FinalConnectionState,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  type XYPosition,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './visual-flow-builder.css';
import {
  Bot,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  GitBranch,
  FileText,
  Image as ImageIcon,
  Link2,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Tag,
  Trash2,
  Upload,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const Instagram = Camera;

export type AutomationRecord = {
  id: string;
  name: string;
  triggerType: string;
  keywords: string;
  targetMediaId?: string | null;
  instagramAccountId?: string | null;
  flowSteps?: string;
  flowGraph?: string;
  conditions?: string;
  tagsToAdd?: string;
  replyText: string;
  status: 'active' | 'paused';
  runs: number;
  updatedAt: string;
};

export type Account = {
  id: string;
  username: string;
  accountType: string;
  tokenExpiresAt: string | null;
};
type MediaItem = {
  id: string;
  caption: string;
  mediaType: string;
  imageUrl: string;
  timestamp: string;
};
type NodeKind =
  'trigger' | 'message' | 'condition' | 'delay' | 'tag' | 'action';
type TriggerConfig = {
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
type ContentBlock = {
  id: string;
  type: 'text' | 'image' | 'pdf' | 'delay';
  text?: string;
  url?: string;
  fileName?: string;
  fileSize?: number;
  seconds?: number;
};
type MessageButton = {
  id: string;
  text: string;
  type?: 'url' | 'flow';
  url?: string;
  targetNodeId?: string;
};
type FlowNodeData = {
  kind: NodeKind;
  title: string;
  subtitle?: string;
  triggerType?: string;
  keywords?: string;
  text?: string;
  seconds?: number;
  minutes?: number;
  tags?: string;
  condition?: string;
  conditionOperator?: string;
  conditionValue?: string;
  actionType?: string;
  targetMediaId?: string | null;
  triggers?: TriggerConfig[];
  contentBlocks?: ContentBlock[];
  buttons?: MessageButton[];
};
type FlowNode = Node<FlowNodeData>;
type NodeAction = { id: string; action: 'duplicate' | 'delete' };
type NodePickerState = {
  position: XYPosition;
  source?: string;
  sourceHandle?: string | null;
};
type ButtonActionPickerState = {
  nodeId: string;
  buttonId: string;
  view: 'actions' | 'existing';
};

const TRIGGERS = [
  [
    'message_keyword',
    'Mensagem no Instagram',
    'A pessoa envia uma mensagem ou palavra-chave',
  ],
  ['first_message', 'Primeira mensagem', 'A pessoa inicia a primeira conversa'],
  [
    'comment_keyword',
    'Comentário em publicação ou Reel',
    'A pessoa comenta em uma publicação ou Reel',
  ],
  ['story_reply', 'Resposta ao Story', 'A pessoa responde ao seu Story'],
  ['story_mention', 'Menção nos Stories', 'A pessoa menciona o seu perfil'],
  ['ad_message', 'Mensagem de anúncio', 'A conversa é iniciada por um anúncio'],
  [
    'live_comment',
    'Comentário em Live',
    'A pessoa comenta durante uma transmissão',
  ],
  [
    'share_to_dm',
    'Compartilhamento no Direct',
    'A pessoa compartilha sua publicação ou Reel',
  ],
  ['ref_url', 'Link de referência', 'A pessoa chega por um link rastreável'],
  [
    'conversation_starter',
    'Início de conversa',
    'A pessoa escolhe uma opção inicial',
  ],
  ['follow_to_dm', 'Novo seguidor', 'A Meta confirma um novo seguidor'],
  ['default_reply', 'Resposta padrão', 'Nenhuma outra regra foi encontrada'],
] as const;

const NODE_CATALOG: Record<
  Exclude<NodeKind, 'trigger'>,
  {
    label: string;
    description: string;
    icon: typeof MessageCircle;
    color: string;
    defaults: Partial<FlowNodeData>;
  }
> = {
  message: {
    label: 'Enviar mensagem',
    description: 'Envie texto, imagem, PDF e botões',
    icon: MessageCircle,
    color: '#ec6d9a',
    defaults: {
      text: 'Escreva a mensagem...',
      contentBlocks: [
        { id: 'text-initial', type: 'text', text: 'Escreva a mensagem...' },
      ],
      buttons: [],
    },
  },
  condition: {
    label: 'Condição',
    description: 'Crie caminhos verdadeiro e falso',
    icon: GitBranch,
    color: '#27bda8',
    defaults: { condition: 'follows_profile' },
  },
  delay: {
    label: 'Espera',
    description: 'Aguarde até 30 segundos antes da próxima etapa',
    icon: Clock3,
    color: '#8c79a0',
    defaults: { seconds: 10 },
  },
  tag: {
    label: 'Adicionar tag',
    description: 'Organize e segmente o contato',
    icon: Tag,
    color: '#548cf2',
    defaults: { tags: 'lead' },
  },
  action: {
    label: 'Ação',
    description: 'Execute uma ação no fluxo',
    icon: Zap,
    color: '#e8a93c',
    defaults: {},
  },
};

function emitNodeAction(detail: NodeAction) {
  window.dispatchEvent(
    new CustomEvent<NodeAction>('organizap-instagram:node-action', { detail })
  );
}

function FlowCard(props: NodeProps<FlowNode>) {
  const data = props.data;
  const meta =
    data.kind === 'trigger'
      ? { label: 'Gatilho', icon: Instagram, color: '#a847f4' }
      : NODE_CATALOG[data.kind];
  const Icon = meta.icon;
  const isCondition = data.kind === 'condition';
  const flowButtons =
    data.kind === 'message'
      ? (data.buttons || []).filter(
          (button) => (button.type || 'url') === 'flow'
        )
      : [];
  return (
    <article
      className={`vf-node vf-${data.kind} ${props.selected ? 'selected' : ''}`}
      style={{ '--node-color': meta.color } as React.CSSProperties}
    >
      {data.kind !== 'trigger' && (
        <Handle
          type="target"
          position={Position.Left}
          aria-label={`Entrada de ${data.title}`}
        />
      )}
      {data.kind !== 'trigger' && (
        <span className="vf-node-actions nodrag nopan">
          <button
            title="Duplicar nó"
            aria-label="Duplicar nó"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              emitNodeAction({ id: props.id, action: 'duplicate' });
            }}
          >
            <Copy size={13} />
          </button>
          <button
            className="danger"
            title="Excluir nó"
            aria-label="Excluir nó"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              emitNodeAction({ id: props.id, action: 'delete' });
            }}
          >
            <Trash2 size={13} />
          </button>
        </span>
      )}
      <header>
        <span>
          <Icon size={16} />
        </span>
        <small>{meta.label}</small>
      </header>
      {data.kind === 'trigger' ? (
        <div className="vf-trigger-node-content">
          <strong>Quando...</strong>
          <div>
            {triggerConfigs(data).map((config, index) => {
              const item = TRIGGERS.find(
                (trigger) => trigger[0] === config.type
              );
              return (
                <span key={config.id || `${config.type}-${index}`}>
                  <Instagram size={12} />
                  <span>
                    <b>{item?.[1] || config.type}</b>
                    <small>{item?.[2]}</small>
                  </span>
                </span>
              );
            })}
          </div>
          <button
            type="button"
            className="nodrag nopan"
            onClick={(event) => {
              event.stopPropagation();
              window.dispatchEvent(
                new CustomEvent('organizap-instagram:trigger-add')
              );
            }}
          >
            <Plus size={12} />
            Novo gatilho
          </button>
          <small>Então</small>
        </div>
      ) : (
        <>
          <strong>{data.title}</strong>
          <p>{data.subtitle || 'Clique para configurar'}</p>
        </>
      )}
      {flowButtons.length > 0 && (
        <div className="vf-node-button-branches">
          {flowButtons.map((button, index) => (
            <span key={button.id}>
              <small>{button.text || `Botão ${index + 1}`}</small>
              <Handle
                id={`button:${button.id}`}
                className="vf-button-handle"
                type="source"
                position={Position.Right}
                aria-label={`Saída do botão ${button.text || index + 1}`}
              />
            </span>
          ))}
        </div>
      )}
      {isCondition ? (
        <>
          <span className="branch-label true-label">Verdadeiro</span>
          <Handle
            id="true"
            type="source"
            position={Position.Right}
            style={{ top: '38%', background: '#20b99c' }}
          />
          <span className="branch-label false-label">Falso</span>
          <Handle
            id="false"
            type="source"
            position={Position.Right}
            style={{ top: '76%', background: '#e46e83' }}
          />
        </>
      ) : data.kind === 'message' ? (
        <div className="vf-next-step">
          <small>Próximo passo</small>
          <Handle
            className="vf-next-step-handle"
            type="source"
            position={Position.Right}
            aria-label="Saída do próximo passo"
          />
        </div>
      ) : (
        <Handle type="source" position={Position.Right} />
      )}
    </article>
  );
}

function RemovableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  label,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false);
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 18,
  });
  return (
    <>
      <g
        className="vf-edge-hit"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <path d={path} fill="none" stroke="transparent" strokeWidth={22} />
        <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      </g>
      <EdgeLabelRenderer>
        <div
          className={`vf-edge-label ${hovered ? 'visible' : ''}`}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {label && <span>{String(label)}</span>}
          <button
            className="nodrag nopan"
            title="Excluir conexão"
            aria-label="Excluir conexão"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent<string>('organizap-instagram:edge-delete', {
                  detail: id,
                })
              )
            }
          >
            <Trash2 size={13} />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const NODE_TYPES = { flowNode: FlowCard };
const EDGE_TYPES = { removable: RemovableEdge };

function makeEdge(
  connection:
    | Connection
    | { source: string; target: string; sourceHandle?: string | null }
): Edge {
  return {
    id: `edge-${crypto.randomUUID()}`,
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle || null,
    targetHandle: 'targetHandle' in connection ? connection.targetHandle : null,
    type: 'removable',
    label:
      connection.sourceHandle === 'true'
        ? 'Verdadeiro'
        : connection.sourceHandle === 'false'
          ? 'Falso'
          : connection.sourceHandle?.startsWith('button:')
            ? 'Botão'
            : undefined,
    markerEnd: { type: MarkerType.ArrowClosed },
  };
}

function initialGraph(): { nodes: FlowNode[]; edges: Edge[] } {
  const nodes: FlowNode[] = [
    {
      id: 'trigger',
      type: 'flowNode',
      position: { x: 80, y: 180 },
      data: {
        kind: 'trigger',
        title: 'Quando...',
        subtitle: '1 gatilho configurado',
        triggerType: 'message_keyword',
        keywords: '',
        triggers: [
          {
            id: crypto.randomUUID(),
            type: 'message_keyword',
            matchMode: 'any',
            keywords: '',
          },
        ],
      },
    },
    {
      id: 'message-1',
      type: 'flowNode',
      position: { x: 390, y: 160 },
      data: {
        kind: 'message',
        title: 'Enviar mensagem',
        subtitle: 'Olá! Como posso ajudar?',
        text: 'Olá! Como posso ajudar?',
        contentBlocks: [
          { id: 'text-initial', type: 'text', text: 'Olá! Como posso ajudar?' },
        ],
        buttons: [],
      },
    },
  ];
  return {
    nodes,
    edges: [
      {
        ...makeEdge({ source: 'trigger', target: 'message-1' }),
        id: 'trigger-message',
      },
    ],
  };
}

function triggerConfigs(
  data: FlowNodeData | undefined,
  fallbackType = 'message_keyword'
): TriggerConfig[] {
  if (data?.triggers?.length) return data.triggers;
  return [
    {
      id: crypto.randomUUID(),
      type: data?.triggerType || fallbackType,
      matchMode: data?.keywords ? 'keywords' : 'any',
      keywords: data?.keywords || '',
      targetMediaId: data?.targetMediaId || null,
    },
  ];
}

function safeParse<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function pointerPosition(event: MouseEvent | TouchEvent) {
  if ('changedTouches' in event) {
    const touch = event.changedTouches[0];
    return { x: touch?.clientX || 0, y: touch?.clientY || 0 };
  }
  return { x: event.clientX, y: event.clientY };
}

function FlowEditor({
  automation,
  accounts,
  onClose,
  onSaved,
  showToast,
}: {
  automation: AutomationRecord | null;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  showToast: (value: string) => void;
}) {
  const starter = useMemo(() => {
    const stored = safeParse<{ nodes: FlowNode[]; edges: Edge[] }>(
      automation?.flowGraph,
      { nodes: [], edges: [] }
    );
    const graph = stored.nodes?.length ? stored : initialGraph();
    if (!stored.nodes?.length && automation) {
      const trigger = graph.nodes.find((n) => n.data.kind === 'trigger');
      if (trigger)
        trigger.data = {
          ...trigger.data,
          triggerType: automation.triggerType,
          keywords: automation.keywords,
          targetMediaId: automation.targetMediaId,
          triggers: [
            {
              id: crypto.randomUUID(),
              type: automation.triggerType,
              matchMode: automation.keywords ? 'keywords' : 'any',
              keywords: automation.keywords,
              targetMediaId: automation.targetMediaId,
            },
          ],
        };
      const message = graph.nodes.find((n) => n.data.kind === 'message');
      if (message)
        message.data = {
          ...message.data,
          text: automation.replyText,
          contentBlocks: [
            {
              id: crypto.randomUUID(),
              type: 'text',
              text: automation.replyText,
            },
          ],
        };
    }
    return {
      nodes: graph.nodes.map((node) => {
        node = { ...node, deletable: node.data.kind !== 'trigger' };
        if (node.data.kind === 'message' && !node.data.contentBlocks?.length) {
          return {
            ...node,
            data: {
              ...node.data,
              contentBlocks: [
                {
                  id: crypto.randomUUID(),
                  type: 'text' as const,
                  text: node.data.text || '',
                },
              ],
              buttons: (node.data.buttons || []).map((button) => ({
                ...button,
                type: button.type || ('url' as const),
              })),
            },
          };
        }
        if (node.data.kind === 'message') {
          return {
            ...node,
            data: {
              ...node.data,
              buttons: (node.data.buttons || []).map((button) => ({
                ...button,
                type: button.type || ('url' as const),
              })),
            },
          };
        }
        if (node.data.kind === 'trigger') {
          const configs = triggerConfigs(
            node.data,
            automation?.triggerType || 'message_keyword'
          ).map((config) => ({
            ...config,
            id: config.id || crypto.randomUUID(),
          }));
          return {
            ...node,
            data: { ...node.data, title: 'Quando...', triggers: configs },
          };
        }
        if (node.data.kind === 'delay') {
          const seconds = Math.min(
            30,
            Math.max(0, Number(node.data.seconds ?? node.data.minutes ?? 10))
          );
          return {
            ...node,
            data: {
              ...node.data,
              seconds,
              minutes: undefined,
              subtitle: `${seconds} segundos`,
            },
          };
        }
        return node;
      }),
      edges: graph.edges.map((edge) => ({ ...edge, type: 'removable' })),
    };
  }, [automation]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(
    starter.nodes
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(starter.edges);
  const [propertiesId, setPropertiesId] = useState<string | null>(null);
  const [name, setName] = useState(automation?.name || 'Nova automação');
  const [accountId, setAccountId] = useState(
    automation?.instagramAccountId || accounts[0]?.id || ''
  );
  const [triggerPicker, setTriggerPicker] = useState(!automation);
  const [editingTriggerId, setEditingTriggerId] = useState<string | null>(null);
  const [nodePicker, setNodePicker] = useState<NodePickerState | null>(null);
  const [buttonActionPicker, setButtonActionPicker] =
    useState<ButtonActionPickerState | null>(null);
  const [triggerSearch, setTriggerSearch] = useState('');
  const [nodeSearch, setNodeSearch] = useState('');
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [uploadingBlockId, setUploadingBlockId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<
    FlowNode,
    Edge
  > | null>(null);

  const selected = nodes.find((node) => node.id === propertiesId) || null;
  const triggerNode = nodes.find((node) => node.data.kind === 'trigger');
  const selectedTriggers = useMemo(
    () =>
      triggerConfigs(
        triggerNode?.data,
        automation?.triggerType || 'message_keyword'
      ),
    [triggerNode?.data, automation?.triggerType]
  );
  const editingTrigger =
    selectedTriggers.find((item) => item.id === editingTriggerId) || null;
  const triggerType = selectedTriggers[0]?.type || 'message_keyword';
  const filteredTriggers = TRIGGERS.filter((item) =>
    `${item[1]} ${item[2]}`.toLowerCase().includes(triggerSearch.toLowerCase())
  );
  const filteredNodes = Object.entries(NODE_CATALOG).filter(([, item]) =>
    `${item.label} ${item.description}`
      .toLowerCase()
      .includes(nodeSearch.toLowerCase())
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) => addEdge(makeEdge(connection), current));
    },
    [setEdges]
  );

  function updateNode(patch: Partial<FlowNodeData>) {
    if (!propertiesId) return;
    setNodes((current) =>
      current.map((node) =>
        node.id === propertiesId
          ? { ...node, data: { ...node.data, ...patch } }
          : node
      )
    );
  }

  const removeNode = useCallback(
    (id: string) => {
      const target = nodes.find((node) => node.id === id);
      if (!target || target.data.kind === 'trigger') return;
      setNodes((current) => current.filter((node) => node.id !== id));
      setEdges((current) =>
        current.filter((edge) => edge.source !== id && edge.target !== id)
      );
      setPropertiesId((current) => (current === id ? null : current));
    },
    [nodes, setEdges, setNodes]
  );

  const duplicateNode = useCallback(
    (id: string) => {
      const target = nodes.find((node) => node.id === id);
      if (!target || target.data.kind === 'trigger') return;
      const nextId = `${target.data.kind}-${crypto.randomUUID()}`;
      const copy: FlowNode = {
        ...target,
        id: nextId,
        selected: false,
        position: { x: target.position.x + 42, y: target.position.y + 42 },
        data: {
          ...target.data,
          title: `${target.data.title} (cópia)`,
          contentBlocks: target.data.contentBlocks?.map((block) => ({
            ...block,
            id: crypto.randomUUID(),
          })),
          buttons: target.data.buttons?.map((button) => ({
            ...button,
            id: crypto.randomUUID(),
            targetNodeId: undefined,
          })),
        },
      };
      setNodes((current) => [...current, copy]);
      setPropertiesId(nextId);
    },
    [nodes, setNodes]
  );

  function addNode(
    kind: Exclude<NodeKind, 'trigger'>,
    picker: NodePickerState
  ) {
    const descriptor = NODE_CATALOG[kind];
    const id = `${kind}-${crypto.randomUUID()}`;
    const node: FlowNode = {
      id,
      type: 'flowNode',
      position: picker.position,
      data: {
        kind,
        title: descriptor.label,
        subtitle:
          kind === 'condition'
            ? 'A pessoa segue o perfil?'
            : kind === 'delay'
              ? '10 segundos'
              : 'Clique para configurar',
        ...descriptor.defaults,
      },
    };
    setNodes((current) => [...current, node]);
    if (picker.source)
      setEdges((current) =>
        addEdge(
          makeEdge({
            source: picker.source!,
            target: id,
            sourceHandle: picker.sourceHandle,
          }),
          current
        )
      );
    setNodePicker(null);
    setNodeSearch('');
    setPropertiesId(id);
  }

  function openNodePickerFromButton() {
    if (!flowInstance || !wrapperRef.current) return;
    const bounds = wrapperRef.current.getBoundingClientRect();
    setNodePicker({
      position: flowInstance.screenToFlowPosition({
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      }),
    });
  }

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (!flowInstance || !state.fromNode || state.isValid) return;
      const point = pointerPosition(event);
      const nodeElement = document
        .elementsFromPoint(point.x, point.y)
        .map((element) => element.closest<HTMLElement>('.react-flow__node'))
        .find((element): element is HTMLElement => Boolean(element));
      const target = nodeElement?.dataset.id;
      if (target && target !== state.fromNode.id) {
        setEdges((current) =>
          addEdge(
            makeEdge({
              source: state.fromNode!.id,
              target,
              sourceHandle: state.fromHandle?.id,
            }),
            current
          )
        );
        return;
      }
      setNodePicker({
        position: flowInstance.screenToFlowPosition(point),
        source: state.fromNode.id,
        sourceHandle: state.fromHandle?.id,
      });
    },
    [flowInstance, setEdges]
  );

  useEffect(() => {
    const nodeAction = (event: Event) => {
      const detail = (event as CustomEvent<NodeAction>).detail;
      if (detail.action === 'duplicate') duplicateNode(detail.id);
      else removeNode(detail.id);
    };
    const edgeDelete = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      setEdges((current) => current.filter((edge) => edge.id !== id));
    };
    window.addEventListener('organizap-instagram:node-action', nodeAction);
    window.addEventListener('organizap-instagram:edge-delete', edgeDelete);
    return () => {
      window.removeEventListener('organizap-instagram:node-action', nodeAction);
      window.removeEventListener('organizap-instagram:edge-delete', edgeDelete);
    };
  }, [duplicateNode, removeNode, setEdges]);

  useEffect(() => {
    const addTrigger = () => {
      setPropertiesId('trigger');
      setEditingTriggerId(null);
      setTriggerPicker(true);
    };
    window.addEventListener('organizap-instagram:trigger-add', addTrigger);
    return () =>
      window.removeEventListener('organizap-instagram:trigger-add', addTrigger);
  }, []);

  useEffect(() => {
    let active = true;
    const kinds = selectedTriggers.map((item) => item.type);
    const kind = kinds.some((item) =>
      ['comment_keyword', 'live_comment', 'share_to_dm'].includes(item)
    )
      ? 'media'
      : kinds.some((item) => ['story_reply', 'story_mention'].includes(item))
        ? 'stories'
        : null;
    if (!kind || !accountId) {
      queueMicrotask(() => {
        if (active) {
          setMedia([]);
          setMediaLoading(false);
        }
      });
      return () => {
        active = false;
      };
    }
    queueMicrotask(() => {
      if (active) setMediaLoading(true);
    });
    setMediaError('');
    void fetch(
      `/api/instagram/media?channel=${encodeURIComponent(accountId)}&kind=${kind}`
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            'Não foi possível carregar as publicações. Confira a conexão do perfil.'
          );
        const result = await response.json();
        return result.media.map(
          (item: {
            id: string;
            caption: string;
            type: string;
            image: string;
            timestamp: string;
          }) => ({ ...item, mediaType: item.type, imageUrl: item.image })
        ) as MediaItem[];
      })
      .then((items) => {
        if (active) {
          setMedia(items);
          setMediaLoading(false);
        }
      })
      .catch((error) => {
        if (active) {
          setMedia([]);
          setMediaLoading(false);
          setMediaError(
            error instanceof Error
              ? error.message
              : 'Falha ao carregar conteúdo.'
          );
        }
      });
    return () => {
      active = false;
    };
  }, [triggerNode?.data.triggers, triggerType, accountId, selectedTriggers]);

  function addTrigger(value: string) {
    const id = crypto.randomUUID();
    setNodes((current) =>
      current.map((node) => {
        if (node.data.kind !== 'trigger') return node;
        const configs = triggerConfigs(
          node.data,
          automation?.triggerType || 'message_keyword'
        );
        const freshConfig = {
          id,
          type: value,
          matchMode: 'any' as const,
          keywords: '',
          excludedKeywords: '',
          targetMediaId: null,
          publicRepliesEnabled: value === 'comment_keyword',
          publicReplies:
            value === 'comment_keyword'
              ? [
                  'Maravilha, confere no seu direct 😉',
                  'Prontinho! Te enviei os detalhes no Direct ✨',
                  'Boa! Dá uma olhadinha nas suas mensagens 💜',
                ]
              : undefined,
          autoLike: false,
        };
        const isUntouchedStarter =
          !automation &&
          configs.length === 1 &&
          configs[0].type === 'message_keyword' &&
          !configs[0].keywords &&
          !configs[0].excludedKeywords &&
          configs[0].matchMode === 'any';
        const next = isUntouchedStarter
          ? [freshConfig]
          : [...configs, freshConfig];
        return {
          ...node,
          data: {
            ...node.data,
            triggers: next,
            triggerType: next[0].type,
            title: 'Quando...',
            subtitle: `${next.length} ${next.length === 1 ? 'gatilho configurado' : 'gatilhos configurados'}`,
          },
        };
      })
    );
    setTriggerPicker(false);
    setTriggerSearch('');
    setPropertiesId('trigger');
    setEditingTriggerId(id);
  }

  function removeTrigger(id: string) {
    setNodes((current) =>
      current.map((node) => {
        if (node.data.kind !== 'trigger') return node;
        const configs = triggerConfigs(
          node.data,
          automation?.triggerType || 'message_keyword'
        );
        if (configs.length === 1) return node;
        const next = configs.filter((config) => config.id !== id);
        return {
          ...node,
          data: {
            ...node.data,
            triggers: next,
            triggerType: next[0].type,
            title: 'Quando...',
            subtitle: `${next.length} ${next.length === 1 ? 'gatilho configurado' : 'gatilhos configurados'}`,
          },
        };
      })
    );
    setEditingTriggerId(null);
  }

  function updateTriggerConfig(id: string, patch: Partial<TriggerConfig>) {
    setNodes((current) =>
      current.map((node) => {
        if (node.data.kind !== 'trigger') return node;
        const configs = triggerConfigs(
          node.data,
          automation?.triggerType || 'message_keyword'
        ).map((config) =>
          config.id === id ? { ...config, ...patch } : config
        );
        const primary = configs[0];
        return {
          ...node,
          data: {
            ...node.data,
            triggers: configs,
            triggerType: primary.type,
            keywords: primary.keywords || '',
            targetMediaId: primary.targetMediaId || null,
            title: 'Quando...',
            subtitle: `${configs.length} ${configs.length === 1 ? 'gatilho configurado' : 'gatilhos configurados'}`,
          },
        };
      })
    );
  }

  function updateContentBlock(id: string, patch: Partial<ContentBlock>) {
    if (!selected || selected.data.kind !== 'message') return;
    updateNode({
      contentBlocks: (selected.data.contentBlocks || []).map((block) =>
        block.id === id ? { ...block, ...patch } : block
      ),
    });
  }

  function addContentBlock(type: ContentBlock['type']) {
    if (!selected || selected.data.kind !== 'message') return;
    const block: ContentBlock = { id: crypto.randomUUID(), type };
    if (type === 'text') block.text = '';
    if (type === 'delay') block.seconds = 2;
    updateNode({
      contentBlocks: [...(selected.data.contentBlocks || []), block],
    });
  }

  function removeContentBlock(id: string) {
    if (!selected || selected.data.kind !== 'message') return;
    updateNode({
      contentBlocks: (selected.data.contentBlocks || []).filter(
        (block) => block.id !== id
      ),
    });
  }

  function updateMessageButton(id: string, patch: Partial<MessageButton>) {
    if (!selected || selected.data.kind !== 'message') return;
    updateNode({
      buttons: (selected.data.buttons || []).map((button) =>
        button.id === id ? { ...button, ...patch } : button
      ),
    });
    if (patch.type === 'url') {
      setEdges((current) =>
        current.filter(
          (edge) =>
            !(
              edge.source === selected.id &&
              edge.sourceHandle === `button:${id}`
            )
        )
      );
    }
  }

  async function uploadContentBlock(id: string, file: File) {
    if (file.size > 10 * 1024 * 1024) {
      showToast('O arquivo deve ter até 10 MB.');
      return;
    }
    setUploadingBlockId(id);
    try {
      const response = await fetch('/api/instagram/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          type: file.type,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.uploadUrl)
        throw new Error(result.error || 'Não foi possível preparar o envio.');
      const uploaded = await fetch(result.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type, 'x-upsert': 'false' },
        body: file,
      });
      if (!uploaded.ok) throw new Error('Não foi possível enviar o arquivo.');
      updateContentBlock(id, {
        url: result.url,
        fileName: file.name,
        fileSize: file.size,
      });
      showToast('Arquivo carregado.');
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : 'Não foi possível enviar o arquivo.'
      );
    } finally {
      setUploadingBlockId(null);
    }
  }

  function setButtonTarget(buttonId: string, targetNodeId: string) {
    if (!selected || selected.data.kind !== 'message') return;
    setEdges((current) => {
      const withoutPrevious = current.filter(
        (edge) =>
          !(
            edge.source === selected.id &&
            edge.sourceHandle === `button:${buttonId}`
          )
      );
      return targetNodeId
        ? addEdge(
            makeEdge({
              source: selected.id,
              target: targetNodeId,
              sourceHandle: `button:${buttonId}`,
            }),
            withoutPrevious
          )
        : withoutPrevious;
    });
    updateMessageButton(buttonId, {
      type: 'flow',
      targetNodeId: targetNodeId || undefined,
      url: undefined,
    });
    setButtonActionPicker(null);
    if (targetNodeId) setPropertiesId(targetNodeId);
  }

  function createButtonTarget(
    buttonId: string,
    kind: 'message' | 'condition' | 'action'
  ) {
    if (!selected || selected.data.kind !== 'message') return;
    const descriptor = NODE_CATALOG[kind];
    const id = `${kind}-${crypto.randomUUID()}`;
    const existingBranches = (selected.data.buttons || []).filter(
      (button) => (button.type || 'url') === 'flow'
    ).length;
    const node: FlowNode = {
      id,
      type: 'flowNode',
      position: {
        x: selected.position.x + 330,
        y: selected.position.y + Math.max(0, existingBranches - 1) * 170,
      },
      data: {
        kind,
        title: descriptor.label,
        subtitle:
          kind === 'condition'
            ? 'A pessoa segue o perfil?'
            : 'Clique para configurar',
        ...descriptor.defaults,
      },
    };
    setNodes((current) => [...current, node]);
    setEdges((current) => {
      const withoutPrevious = current.filter(
        (edge) =>
          !(
            edge.source === selected.id &&
            edge.sourceHandle === `button:${buttonId}`
          )
      );
      return addEdge(
        makeEdge({
          source: selected.id,
          target: id,
          sourceHandle: `button:${buttonId}`,
        }),
        withoutPrevious
      );
    });
    updateMessageButton(buttonId, {
      type: 'flow',
      targetNodeId: id,
      url: undefined,
    });
    setButtonActionPicker(null);
    setPropertiesId(id);
  }

  function setButtonToUrl(buttonId: string) {
    if (!selected || selected.data.kind !== 'message') return;
    updateMessageButton(buttonId, {
      type: 'url',
      url:
        selected.data.buttons?.find((button) => button.id === buttonId)?.url ||
        'https://',
      targetNodeId: undefined,
    });
    setButtonActionPicker(null);
  }

  function removeMessageButton(buttonId: string) {
    if (!selected || selected.data.kind !== 'message') return;
    updateNode({
      buttons: (selected.data.buttons || []).filter(
        (item) => item.id !== buttonId
      ),
    });
    setEdges((current) =>
      current.filter(
        (edge) =>
          !(
            edge.source === selected.id &&
            edge.sourceHandle === `button:${buttonId}`
          )
      )
    );
  }

  async function save() {
    if (!name.trim()) {
      showToast('Dê um nome ao fluxo.');
      return;
    }
    const trigger = nodes.find((node) => node.data.kind === 'trigger')?.data;
    const firstMessageNode = nodes.find(
      (node) => node.data.kind === 'message'
    )?.data;
    const firstMessage =
      firstMessageNode?.contentBlocks
        ?.find((block) => block.type === 'text' && block.text?.trim())
        ?.text?.trim() ||
      firstMessageNode?.text?.trim() ||
      'Automação iniciada.';
    const configs = triggerConfigs(
      trigger,
      automation?.triggerType || 'message_keyword'
    );
    const primary = configs[0];
    const tags = nodes
      .filter((node) => node.data.kind === 'tag')
      .flatMap((node) =>
        (node.data.tags || '')
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      );
    const flowSteps = nodes
      .filter((node) => node.data.kind !== 'trigger')
      .map((node) => ({
        type: node.data.kind,
        value: node.data.text || node.data.tags || undefined,
        delaySeconds: node.data.seconds,
      }));
    setSaving(true);
    try {
      const response = await fetch('/api/instagram/automations', {
        method: automation?.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: automation?.id,
          name: name.trim(),
          triggerType: primary.type,
          keywords: primary.keywords || '',
          targetMediaId: primary.targetMediaId || null,
          instagramAccountId: accountId,
          replyText: firstMessage,
          flowSteps,
          flowGraph: { nodes, edges },
          conditions: [],
          tagsToAdd: tags,
          status: 'paused',
        }),
      });
      setSaving(false);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        showToast(body.error || 'Não foi possível salvar o fluxo.');
        return;
      }
      showToast('Fluxo visual salvo.');
      await onSaved();
      onClose();
    } catch {
      showToast('Não foi possível salvar. Sua edição continua aberta.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="visual-builder"
      role="dialog"
      aria-label="Editor visual de automação"
    >
      <header className="vf-toolbar">
        <button className="vf-back" onClick={onClose}>
          ← Automações
        </button>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="Nome da automação"
        />
        <span>As alterações são salvas como pausadas</span>
        <button
          className="vf-save"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? 'Salvando…' : 'Salvar fluxo'}
        </button>
      </header>
      <div className="vf-layout">
        <div ref={wrapperRef} className="vf-canvas">
          <ReactFlow<FlowNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            onInit={setFlowInstance}
            onNodeClick={(_, node) => {
              setPropertiesId(node.id);
              if (node.data.kind === 'trigger') setEditingTriggerId(null);
            }}
            onPaneClick={() => {
              setPropertiesId(null);
              setEditingTriggerId(null);
            }}
            connectionMode={ConnectionMode.Strict}
            connectionRadius={48}
            defaultEdgeOptions={{
              type: 'removable',
              markerEnd: { type: MarkerType.ArrowClosed },
            }}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
            fitViewOptions={{ maxZoom: 0.5, padding: 0.22 }}
            minZoom={0.25}
            maxZoom={2}
            panOnDrag
            selectionOnDrag
            edgesReconnectable
          >
            <Background gap={22} size={1.2} color="rgba(138,91,181,.22)" />
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) =>
                node.data.kind === 'condition'
                  ? '#27bda8'
                  : node.data.kind === 'trigger'
                    ? '#a847f4'
                    : '#715083'
              }
            />
            <Controls position="bottom-left" />
          </ReactFlow>
          <button
            className="vf-floating-add"
            onClick={openNodePickerFromButton}
            title="Adicionar nó"
            aria-label="Adicionar nó"
          >
            <Plus size={24} />
          </button>
          <div className="vf-canvas-hint">
            Arraste uma saída e solte no canvas para criar a próxima etapa
          </div>
        </div>
      </div>

      {propertiesId && selected && (
        <div
          className="vf-properties-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPropertiesId(null);
          }}
        >
          <section
            className="vf-properties-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Propriedades de ${selected.data.title}`}
          >
            <header>
              <div>
                <strong>Propriedades</strong>
                <small>{selected.data.title}</small>
              </div>
              <span>
                {selected.data.kind !== 'trigger' && (
                  <button
                    onClick={() => duplicateNode(selected.id)}
                    title="Duplicar nó"
                  >
                    <Copy size={16} />
                  </button>
                )}
                {selected.data.kind !== 'trigger' && (
                  <button
                    className="danger"
                    onClick={() => removeNode(selected.id)}
                    title="Excluir nó"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
                <button onClick={() => setPropertiesId(null)} title="Fechar">
                  <X size={17} />
                </button>
              </span>
            </header>
            <div className="vf-properties-body">
              <label>
                Perfil do Instagram
                <select
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                >
                  <option value="">Selecione</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      @{account.username}
                    </option>
                  ))}
                </select>
              </label>
              {selected.data.kind === 'trigger' && (
                <>
                  {!editingTrigger ? (
                    <div className="vf-trigger-list-editor">
                      <div className="vf-editor-title">
                        <strong>Quando...</strong>
                        <small>
                          Cada gatilho tem sua própria configuração.
                        </small>
                      </div>
                      {selectedTriggers.map((config, index) => {
                        const item = TRIGGERS.find(
                          (trigger) => trigger[0] === config.type
                        );
                        return (
                          <button
                            key={config.id || `${config.type}-${index}`}
                            onClick={() =>
                              setEditingTriggerId(config.id || null)
                            }
                          >
                            <Instagram size={17} />
                            <span>
                              <strong>{item?.[1] || config.type}</strong>
                              <small>
                                {config.matchMode === 'keywords' &&
                                config.keywords
                                  ? config.keywords
                                  : item?.[2]}
                              </small>
                            </span>
                            <span>Editar</span>
                          </button>
                        );
                      })}
                      <button
                        className="vf-new-trigger"
                        onClick={() => setTriggerPicker(true)}
                      >
                        <Plus size={14} />
                        Novo gatilho
                      </button>
                    </div>
                  ) : (
                    <section className="vf-trigger-config">
                      {['comment_keyword', 'live_comment'].includes(
                        editingTrigger.type
                      ) && (
                        <p className="vf-platform-note">
                          A Meta permite uma resposta privada por comentário.
                          Use botões para continuar o fluxo depois que a pessoa
                          interagir no Direct.
                        </p>
                      )}
                      {editingTrigger.type === 'follow_to_dm' && (
                        <p className="vf-platform-note">
                          A Meta não disponibiliza o evento de novo seguidor
                          nesta conexão. Este gatilho pode ser salvo como
                          rascunho; use uma mensagem ou comentário para ativar.
                        </p>
                      )}
                      <header>
                        <button
                          className="vf-inline-back"
                          onClick={() => setEditingTriggerId(null)}
                          title="Voltar"
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <Instagram size={15} />
                        <strong>
                          {TRIGGERS.find(
                            (item) => item[0] === editingTrigger.type
                          )?.[1] || editingTrigger.type}
                        </strong>
                        {selectedTriggers.length > 1 && (
                          <button
                            className="vf-inline-delete"
                            onClick={() => removeTrigger(editingTrigger.id!)}
                            title="Excluir gatilho"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </header>
                      {[
                        'message_keyword',
                        'comment_keyword',
                        'live_comment',
                        'ref_url',
                        'story_reply',
                      ].includes(editingTrigger.type) && (
                        <>
                          <label>
                            Ativar com
                            <select
                              value={editingTrigger.matchMode || 'any'}
                              onChange={(event) =>
                                updateTriggerConfig(editingTrigger.id!, {
                                  matchMode: event.target.value as
                                    'any' | 'keywords',
                                })
                              }
                            >
                              <option value="any">
                                {editingTrigger.type === 'comment_keyword'
                                  ? 'Qualquer comentário'
                                  : ['story_reply', 'story_mention'].includes(
                                        editingTrigger.type
                                      )
                                    ? 'Qualquer resposta'
                                    : 'Qualquer mensagem'}
                              </option>
                              <option value="keywords">
                                Palavras-chave específicas
                              </option>
                            </select>
                          </label>
                          {editingTrigger.matchMode === 'keywords' && (
                            <label>
                              Palavras-chave
                              <input
                                value={editingTrigger.keywords || ''}
                                onChange={(event) =>
                                  updateTriggerConfig(editingTrigger.id!, {
                                    keywords: event.target.value,
                                  })
                                }
                                placeholder="quero, cupom, informações"
                              />
                            </label>
                          )}
                        </>
                      )}
                      {editingTrigger.type === 'comment_keyword' && (
                        <label>
                          Não contém
                          <input
                            value={editingTrigger.excludedKeywords || ''}
                            onChange={(event) =>
                              updateTriggerConfig(editingTrigger.id!, {
                                excludedKeywords: event.target.value,
                              })
                            }
                            placeholder="spam, cancelar, não quero"
                          />
                        </label>
                      )}
                      {['story_reply', 'story_mention'].includes(
                        editingTrigger.type
                      ) && (
                        <label className="vf-check-row">
                          <input
                            type="checkbox"
                            checked={editingTrigger.autoLike === true}
                            onChange={(event) =>
                              updateTriggerConfig(editingTrigger.id!, {
                                autoLike: event.target.checked,
                              })
                            }
                          />
                          <span>Curtir a resposta automaticamente</span>
                        </label>
                      )}
                      {[
                        'comment_keyword',
                        'live_comment',
                        'share_to_dm',
                        'story_reply',
                        'story_mention',
                      ].includes(editingTrigger.type) && (
                        <div className="vf-content-picker">
                          {mediaError && <p role="alert">{mediaError}</p>}
                          <strong>
                            {['story_reply', 'story_mention'].includes(
                              editingTrigger.type
                            )
                              ? 'Story'
                              : 'Publicação ou Reel'}
                          </strong>
                          <button
                            className={
                              !editingTrigger.targetMediaId ? 'selected' : ''
                            }
                            onClick={() =>
                              updateTriggerConfig(editingTrigger.id!, {
                                targetMediaId: null,
                              })
                            }
                          >
                            <span>Todos os conteúdos</span>
                            <Check size={14} />
                          </button>
                          {mediaLoading ? (
                            <small>Carregando conteúdos…</small>
                          ) : (
                            media.map((item) => (
                              <button
                                key={item.id}
                                className={
                                  editingTrigger.targetMediaId === item.id
                                    ? 'selected'
                                    : ''
                                }
                                onClick={() =>
                                  updateTriggerConfig(editingTrigger.id!, {
                                    targetMediaId: item.id,
                                  })
                                }
                              >
                                {item.imageUrl ? (
                                  <>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={item.imageUrl} alt="" />
                                  </>
                                ) : (
                                  <Instagram size={22} />
                                )}
                                <span>
                                  {item.caption ||
                                    `${item.mediaType} sem legenda`}
                                </span>
                                {editingTrigger.targetMediaId === item.id && (
                                  <Check size={14} />
                                )}
                              </button>
                            ))
                          )}
                          {!mediaLoading && media.length === 0 && (
                            <small>
                              Nenhum conteúdo encontrado. “Todos” continuará
                              ativo.
                            </small>
                          )}
                        </div>
                      )}
                      {editingTrigger.type === 'comment_keyword' && (
                        <>
                          <label className="vf-check-row">
                            <input
                              type="checkbox"
                              checked={
                                editingTrigger.publicRepliesEnabled !== false
                              }
                              onChange={(event) =>
                                updateTriggerConfig(editingTrigger.id!, {
                                  publicRepliesEnabled: event.target.checked,
                                })
                              }
                            />
                            <span>Responder publicamente ao comentário</span>
                          </label>
                          {editingTrigger.publicRepliesEnabled !== false && (
                            <div className="vf-random-replies">
                              <strong>Respostas aleatórias</strong>
                              {(editingTrigger.publicReplies || []).map(
                                (reply, index) => (
                                  <div key={`${index}-${reply}`}>
                                    <input
                                      value={reply}
                                      onChange={(event) =>
                                        updateTriggerConfig(
                                          editingTrigger.id!,
                                          {
                                            publicReplies: (
                                              editingTrigger.publicReplies || []
                                            ).map((item, replyIndex) =>
                                              replyIndex === index
                                                ? event.target.value
                                                : item
                                            ),
                                          }
                                        )
                                      }
                                    />
                                    <button
                                      onClick={() =>
                                        updateTriggerConfig(
                                          editingTrigger.id!,
                                          {
                                            publicReplies: (
                                              editingTrigger.publicReplies || []
                                            ).filter(
                                              (_, replyIndex) =>
                                                replyIndex !== index
                                            ),
                                          }
                                        )
                                      }
                                      title="Excluir resposta"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                )
                              )}
                              <button
                                onClick={() =>
                                  updateTriggerConfig(editingTrigger.id!, {
                                    publicReplies: [
                                      ...(editingTrigger.publicReplies || []),
                                      'Confira no seu Direct 😉',
                                    ],
                                  })
                                }
                              >
                                <Plus size={14} />
                                Adicionar resposta
                              </button>
                              <small>
                                Uma das respostas será escolhida aleatoriamente
                                a cada comentário.
                              </small>
                            </div>
                          )}
                        </>
                      )}
                    </section>
                  )}
                </>
              )}
              {selected.data.kind === 'message' && (
                <div className="vf-message-editor">
                  <div className="vf-editor-title">
                    <strong>Blocos de conteúdo</strong>
                    <small>Serão enviados na ordem abaixo.</small>
                  </div>
                  {(selected.data.contentBlocks?.length
                    ? selected.data.contentBlocks
                    : [
                        {
                          id: 'legacy',
                          type: 'text' as const,
                          text: selected.data.text || '',
                        },
                      ]
                  ).map((block, index) => (
                    <section className="vf-content-block" key={block.id}>
                      <header>
                        <span>
                          {block.type === 'text' ? (
                            <MessageCircle size={14} />
                          ) : block.type === 'image' ? (
                            <ImageIcon size={14} />
                          ) : block.type === 'pdf' ? (
                            <FileText size={14} />
                          ) : (
                            <Clock3 size={14} />
                          )}
                          {block.type === 'text'
                            ? 'Texto'
                            : block.type === 'image'
                              ? 'Imagem'
                              : block.type === 'pdf'
                                ? 'PDF'
                                : 'Atraso'}
                        </span>
                        <button
                          onClick={() => removeContentBlock(block.id)}
                          title="Excluir bloco"
                        >
                          <Trash2 size={14} />
                        </button>
                      </header>
                      {block.type === 'text' && (
                        <textarea
                          value={block.text || ''}
                          onChange={(event) => {
                            updateContentBlock(block.id, {
                              text: event.target.value,
                            });
                            if (index === 0)
                              updateNode({
                                text: event.target.value,
                                subtitle:
                                  event.target.value.slice(0, 70) ||
                                  'Mensagem em blocos',
                              });
                          }}
                          placeholder="Digite a mensagem…"
                        />
                      )}
                      {(block.type === 'image' || block.type === 'pdf') && (
                        <div className="vf-upload-field">
                          {block.url && (
                            <div className="vf-upload-preview">
                              {block.type === 'image' ? (
                                <>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={block.url}
                                    alt={block.fileName || 'Imagem carregada'}
                                  />
                                </>
                              ) : (
                                <FileText size={26} />
                              )}
                              <span>
                                <strong>
                                  {block.fileName || 'Arquivo carregado'}
                                </strong>
                                <small>
                                  {block.fileSize
                                    ? `${(block.fileSize / 1024 / 1024).toFixed(1)} MB`
                                    : block.type.toUpperCase()}
                                </small>
                              </span>
                            </div>
                          )}
                          <label className="vf-upload-button">
                            <Upload size={15} />
                            <span>
                              {uploadingBlockId === block.id
                                ? 'Enviando...'
                                : block.url
                                  ? 'Substituir arquivo'
                                  : block.type === 'image'
                                    ? 'Carregar imagem'
                                    : 'Carregar PDF'}
                            </span>
                            <input
                              type="file"
                              accept={
                                block.type === 'image'
                                  ? 'image/jpeg,image/png,image/gif'
                                  : 'application/pdf'
                              }
                              disabled={uploadingBlockId === block.id}
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file)
                                  void uploadContentBlock(block.id, file);
                                event.currentTarget.value = '';
                              }}
                            />
                          </label>
                        </div>
                      )}
                      {block.type === 'delay' && (
                        <label>
                          Segundos
                          <input
                            type="number"
                            min="0"
                            max="30"
                            value={block.seconds || 0}
                            onChange={(event) =>
                              updateContentBlock(block.id, {
                                seconds: Number(event.target.value),
                              })
                            }
                          />
                        </label>
                      )}
                    </section>
                  ))}
                  <div className="vf-add-blocks">
                    <button onClick={() => addContentBlock('text')}>
                      <MessageCircle size={14} />
                      Texto
                    </button>
                    <button onClick={() => addContentBlock('image')}>
                      <ImageIcon size={14} />
                      Imagem
                    </button>
                    <button onClick={() => addContentBlock('pdf')}>
                      <FileText size={14} />
                      PDF
                    </button>
                    <button onClick={() => addContentBlock('delay')}>
                      <Clock3 size={14} />
                      Atraso
                    </button>
                  </div>
                  <div className="vf-buttons-editor">
                    <div className="vf-editor-title">
                      <strong>Botões</strong>
                      <small>
                        Abra um link ou continue por outra saída do fluxo.
                      </small>
                    </div>
                    {(selected.data.buttons || []).map((button) => {
                      const targetId =
                        edges.find(
                          (edge) =>
                            edge.source === selected.id &&
                            edge.sourceHandle === `button:${button.id}`
                        )?.target ||
                        button.targetNodeId ||
                        '';
                      const targetNode = nodes.find(
                        (node) => node.id === targetId
                      );
                      const ButtonActionIcon =
                        (button.type || 'url') === 'url'
                          ? Link2
                          : targetNode?.data.kind === 'condition'
                            ? GitBranch
                            : targetNode?.data.kind === 'action'
                              ? Zap
                              : MessageCircle;
                      const actionLabel =
                        (button.type || 'url') === 'url'
                          ? 'Abrir site'
                          : targetNode?.data.title || 'Escolher destino';
                      return (
                        <section className="vf-message-button" key={button.id}>
                          <header>
                            <input
                              value={button.text}
                              onChange={(event) =>
                                updateMessageButton(button.id, {
                                  text: event.target.value,
                                })
                              }
                              placeholder="Texto do botão"
                            />
                            <button
                              onClick={() => removeMessageButton(button.id)}
                              title="Excluir botão"
                            >
                              <Trash2 size={14} />
                            </button>
                          </header>
                          <button
                            className="vf-button-action"
                            onClick={() =>
                              setButtonActionPicker({
                                nodeId: selected.id,
                                buttonId: button.id,
                                view: 'actions',
                              })
                            }
                          >
                            <ButtonActionIcon size={17} />
                            <span>
                              <small>Quando este botão for pressionado</small>
                              <strong>{actionLabel}</strong>
                            </span>
                            <ChevronRight size={16} />
                          </button>
                          {(button.type || 'url') === 'url' ? (
                            <label className="vf-button-url">
                              Endereço
                              <span>
                                <Link2 size={14} />
                                <input
                                  value={button.url || ''}
                                  onChange={(event) =>
                                    updateMessageButton(button.id, {
                                      url: event.target.value,
                                    })
                                  }
                                  placeholder="https://…"
                                />
                              </span>
                            </label>
                          ) : (
                            targetNode && (
                              <div className="vf-button-target">
                                <span>Ligado a</span>
                                <strong>{targetNode.data.title}</strong>
                                <small>
                                  {targetNode.data.subtitle ||
                                    'Clique para configurar'}
                                </small>
                              </div>
                            )
                          )}
                        </section>
                      );
                    })}
                    <button
                      className="vf-add-button"
                      disabled={(selected.data.buttons || []).length >= 3}
                      onClick={() =>
                        updateNode({
                          buttons: [
                            ...(selected.data.buttons || []),
                            {
                              id: crypto.randomUUID(),
                              text: 'Saiba mais',
                              type: 'url',
                              url: 'https://',
                            },
                          ],
                        })
                      }
                    >
                      <Plus size={14} />
                      Adicionar botão
                    </button>
                  </div>
                </div>
              )}
              {selected.data.kind === 'condition' && (
                <>
                  <label>
                    Condição
                    <select
                      value={selected.data.condition || 'follows_profile'}
                      onChange={(event) =>
                        updateNode({
                          condition: event.target.value,
                          subtitle:
                            event.target.options[event.target.selectedIndex]
                              .text,
                        })
                      }
                    >
                      <option value="follows_profile">
                        Segue o perfil do Instagram
                      </option>
                      <option value="has_tag">Possui uma tag</option>
                      <option value="not_has_tag">Não possui uma tag</option>
                      <option value="last_interaction">Última interação</option>
                      <option value="last_seen">Visto por último</option>
                      <option value="followers_count">
                        Número de seguidores
                      </option>
                      <option value="verified_profile">
                        Perfil verificado
                      </option>
                    </select>
                  </label>
                  {['last_interaction', 'last_seen'].includes(
                    selected.data.condition || ''
                  ) && (
                    <>
                      <label>
                        Comparação
                        <select
                          value={selected.data.conditionOperator || 'within'}
                          onChange={(event) =>
                            updateNode({
                              conditionOperator: event.target.value,
                            })
                          }
                        >
                          <option value="within">Nos últimos</option>
                          <option value="before">Há mais de</option>
                        </select>
                      </label>
                      <label>
                        Dias
                        <input
                          type="number"
                          min="0"
                          value={selected.data.conditionValue || '7'}
                          onChange={(event) =>
                            updateNode({ conditionValue: event.target.value })
                          }
                        />
                      </label>
                    </>
                  )}
                  {selected.data.condition === 'followers_count' && (
                    <>
                      <label>
                        Comparação
                        <select
                          value={selected.data.conditionOperator || 'gte'}
                          onChange={(event) =>
                            updateNode({
                              conditionOperator: event.target.value,
                            })
                          }
                        >
                          <option value="gte">Maior ou igual</option>
                          <option value="lte">Menor ou igual</option>
                        </select>
                      </label>
                      <label>
                        Quantidade
                        <input
                          type="number"
                          min="0"
                          value={selected.data.conditionValue || '1000'}
                          onChange={(event) =>
                            updateNode({ conditionValue: event.target.value })
                          }
                        />
                      </label>
                    </>
                  )}
                  {selected.data.condition === 'verified_profile' && (
                    <label>
                      Valor
                      <select
                        value={selected.data.conditionValue || 'true'}
                        onChange={(event) =>
                          updateNode({ conditionValue: event.target.value })
                        }
                      >
                        <option value="true">É verificado</option>
                        <option value="false">Não é verificado</option>
                      </select>
                    </label>
                  )}
                  {['has_tag', 'not_has_tag'].includes(
                    selected.data.condition || ''
                  ) && (
                    <label>
                      Nome da tag
                      <input
                        value={selected.data.conditionValue || ''}
                        onChange={(event) =>
                          updateNode({ conditionValue: event.target.value })
                        }
                        placeholder="lead"
                      />
                    </label>
                  )}
                  <div className="vf-branches">
                    <span className="true">Verdadeiro</span>
                    <span className="false">Falso</span>
                    <small>
                      Use as duas saídas do nó para criar caminhos diferentes.
                    </small>
                  </div>
                </>
              )}
              {selected.data.kind === 'delay' && (
                <label>
                  Segundos de espera
                  <input
                    type="number"
                    min="0"
                    max="30"
                    value={selected.data.seconds ?? 10}
                    onChange={(event) => {
                      const seconds = Math.min(
                        30,
                        Math.max(0, Number(event.target.value))
                      );
                      updateNode({
                        seconds,
                        minutes: undefined,
                        subtitle: `${seconds} segundos`,
                      });
                    }}
                  />
                </label>
              )}
              {selected.data.kind === 'tag' && (
                <label>
                  Tags
                  <input
                    value={selected.data.tags || ''}
                    onChange={(event) =>
                      updateNode({
                        tags: event.target.value,
                        subtitle: event.target.value || 'Adicionar tags',
                      })
                    }
                    placeholder="lead, cliente"
                  />
                </label>
              )}
              {selected.data.kind === 'action' && (
                <div>
                  <label>
                    Ação
                    <select
                      value={selected.data.actionType || 'none'}
                      onChange={(event) =>
                        updateNode({
                          actionType: event.target.value,
                          subtitle:
                            event.target.options[event.target.selectedIndex]
                              .text,
                        })
                      }
                    >
                      <option value="none">Continuar fluxo</option>
                      <option value="open">Abrir conversa</option>
                      <option value="close">Encerrar conversa</option>
                      <option value="human">
                        Pausar automação e passar para humano
                      </option>
                      <option value="remove_tag">Remover tags</option>
                    </select>
                  </label>
                  {selected.data.actionType === 'remove_tag' && (
                    <label>
                      Tags a remover
                      <input
                        value={selected.data.tags || ''}
                        onChange={(event) =>
                          updateNode({ tags: event.target.value })
                        }
                        placeholder="lead, cliente"
                      />
                    </label>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {buttonActionPicker &&
        (() => {
          const sourceNode = nodes.find(
            (node) => node.id === buttonActionPicker.nodeId
          );
          const sourceButton = sourceNode?.data.buttons?.find(
            (button) => button.id === buttonActionPicker.buttonId
          );
          if (
            !sourceNode ||
            !sourceButton ||
            sourceNode.data.kind !== 'message'
          )
            return null;
          return (
            <div
              className="vf-button-action-overlay"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget)
                  setButtonActionPicker(null);
              }}
            >
              <section
                className="vf-button-action-picker"
                role="dialog"
                aria-modal="true"
                aria-label="Escolher ação do botão"
              >
                <header>
                  {buttonActionPicker.view === 'existing' ? (
                    <button
                      onClick={() =>
                        setButtonActionPicker({
                          ...buttonActionPicker,
                          view: 'actions',
                        })
                      }
                      title="Voltar"
                    >
                      <ChevronLeft size={18} />
                    </button>
                  ) : (
                    <span />
                  )}
                  <div>
                    <h2>
                      {buttonActionPicker.view === 'existing'
                        ? 'Selecionar nó'
                        : 'Ação do botão'}
                    </h2>
                    <p>{sourceButton.text || 'Botão sem título'}</p>
                  </div>
                  <button
                    onClick={() => setButtonActionPicker(null)}
                    title="Fechar"
                  >
                    <X size={18} />
                  </button>
                </header>
                {buttonActionPicker.view === 'actions' ? (
                  <div className="vf-button-action-options">
                    <button
                      onClick={() =>
                        createButtonTarget(sourceButton.id, 'message')
                      }
                    >
                      <span className="message">
                        <MessageCircle size={21} />
                      </span>
                      <span>
                        <strong>Enviar mensagem</strong>
                        <small>
                          Cria uma nova mensagem ligada a este botão
                        </small>
                      </span>
                      <Plus size={17} />
                    </button>
                    <button onClick={() => setButtonToUrl(sourceButton.id)}>
                      <span className="link">
                        <Link2 size={21} />
                      </span>
                      <span>
                        <strong>Abrir site</strong>
                        <small>
                          Direciona a pessoa para um endereço externo
                        </small>
                      </span>
                      <ChevronRight size={17} />
                    </button>
                    <button
                      onClick={() =>
                        createButtonTarget(sourceButton.id, 'condition')
                      }
                    >
                      <span className="condition">
                        <GitBranch size={21} />
                      </span>
                      <span>
                        <strong>Condição</strong>
                        <small>Cria dois caminhos para continuar o fluxo</small>
                      </span>
                      <Plus size={17} />
                    </button>
                    <button
                      onClick={() =>
                        createButtonTarget(sourceButton.id, 'action')
                      }
                    >
                      <span className="action">
                        <Zap size={21} />
                      </span>
                      <span>
                        <strong>Executar ação</strong>
                        <small>Cria um nó de ação ligado a este botão</small>
                      </span>
                      <Plus size={17} />
                    </button>
                    <button
                      onClick={() =>
                        setButtonActionPicker({
                          ...buttonActionPicker,
                          view: 'existing',
                        })
                      }
                    >
                      <span className="existing">
                        <Workflow size={21} />
                      </span>
                      <span>
                        <strong>Selecionar nó existente</strong>
                        <small>Conecta este botão a uma etapa já criada</small>
                      </span>
                      <ChevronRight size={17} />
                    </button>
                  </div>
                ) : (
                  <div className="vf-existing-node-options">
                    {nodes
                      .filter(
                        (node) =>
                          node.id !== sourceNode.id &&
                          node.data.kind !== 'trigger'
                      )
                      .map((node) => {
                        const descriptor =
                          NODE_CATALOG[
                            node.data.kind as Exclude<NodeKind, 'trigger'>
                          ];
                        const NodeIcon = descriptor.icon;
                        return (
                          <button
                            key={node.id}
                            onClick={() =>
                              setButtonTarget(sourceButton.id, node.id)
                            }
                          >
                            <span style={{ color: descriptor.color }}>
                              <NodeIcon size={19} />
                            </span>
                            <span>
                              <strong>{node.data.title}</strong>
                              <small>
                                {node.data.subtitle || descriptor.description}
                              </small>
                            </span>
                            <ChevronRight size={16} />
                          </button>
                        );
                      })}
                    {nodes.filter(
                      (node) =>
                        node.id !== sourceNode.id &&
                        node.data.kind !== 'trigger'
                    ).length === 0 && (
                      <div className="vf-existing-empty">
                        <Workflow size={28} />
                        <p>Nenhum outro nó disponível.</p>
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          );
        })()}

      {nodePicker && (
        <div
          className="vf-node-picker-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setNodePicker(null);
          }}
        >
          <section
            className="vf-node-picker"
            role="dialog"
            aria-modal="true"
            aria-label="Adicionar etapa"
          >
            <header>
              <div>
                <h2>Adicionar uma etapa</h2>
                <p>Escolha o próximo nó da automação.</p>
              </div>
              <button onClick={() => setNodePicker(null)}>
                <X size={19} />
              </button>
            </header>
            <label>
              <Search size={17} />
              <input
                value={nodeSearch}
                onChange={(event) => setNodeSearch(event.target.value)}
                placeholder="Pesquisar etapa"
                autoFocus
              />
            </label>
            <div>
              {filteredNodes.map(([kind, item]) => {
                const Icon = item.icon;
                return (
                  <button
                    key={kind}
                    onClick={() =>
                      addNode(kind as Exclude<NodeKind, 'trigger'>, nodePicker)
                    }
                  >
                    <span
                      style={{
                        color: item.color,
                        background: `color-mix(in srgb, ${item.color} 13%, transparent)`,
                      }}
                    >
                      <Icon size={20} />
                    </span>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                    <Plus size={16} />
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {triggerPicker && (
        <div className="vf-trigger-overlay">
          <div className="vf-trigger-modal">
            <header>
              <h2>Iniciar automação quando…</h2>
              <label>
                <Search size={17} />
                <input
                  value={triggerSearch}
                  onChange={(event) => setTriggerSearch(event.target.value)}
                  placeholder="Pesquisar gatilhos"
                />
              </label>
              <button onClick={() => setTriggerPicker(false)}>
                <X size={19} />
              </button>
            </header>
            <div className="vf-trigger-scroll">
              <h3>Escolha o gatilho que deseja adicionar</h3>
              {filteredTriggers.map(([value, title, description]) => (
                <button key={value} onClick={() => addTrigger(value)}>
                  <Instagram size={22} />
                  <span>
                    <small>{title}</small>
                    <strong>{description}</strong>
                  </span>
                  <Plus size={17} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function VisualAutomationWorkspace({
  automations,
  accounts,
  loading,
  onChanged,
  onToggle,
  showToast,
  startCreating = false,
}: {
  automations: AutomationRecord[];
  accounts: Account[];
  loading: boolean;
  onChanged: () => Promise<void>;
  onToggle: (automation: AutomationRecord) => void;
  showToast: (value: string) => void;
  startCreating?: boolean;
}) {
  const [editing, setEditing] = useState<AutomationRecord | null | undefined>(
    startCreating ? null : undefined
  );
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const filtered = automations.filter((item) =>
    item.name.toLowerCase().includes(query.toLowerCase())
  );

  async function remove(item: AutomationRecord) {
    if (!window.confirm(`Excluir “${item.name}”?`)) return;
    const response = await fetch(
      `/api/instagram/automations?id=${encodeURIComponent(item.id)}`,
      { method: 'DELETE' }
    );
    if (response.ok) {
      showToast('Automação excluída.');
      await onChanged();
    } else showToast('Não foi possível excluir.');
    setMenu(null);
  }

  async function duplicate(item: AutomationRecord) {
    const response = await fetch('/api/instagram/automations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${item.name.slice(0, 142)} (cópia)`,
        triggerType: item.triggerType,
        keywords: item.keywords,
        targetMediaId: item.targetMediaId || null,
        instagramAccountId: item.instagramAccountId || accounts[0]?.id || '',
        replyText: item.replyText,
        flowSteps: safeParse(item.flowSteps, []),
        flowGraph: safeParse(item.flowGraph, initialGraph()),
        conditions: safeParse(item.conditions, []),
        tagsToAdd: safeParse(item.tagsToAdd, []),
        status: 'paused',
      }),
    });
    if (response.ok) {
      showToast('Automação duplicada como pausada.');
      await onChanged();
    } else showToast('Não foi possível duplicar a automação.');
    setMenu(null);
  }

  if (editing !== undefined)
    return (
      <div className="instagram-visual-workspace">
        <ReactFlowProvider>
          <FlowEditor
            automation={editing}
            accounts={accounts}
            onClose={() => setEditing(undefined)}
            onSaved={onChanged}
            showToast={showToast}
          />
        </ReactFlowProvider>
      </div>
    );

  return (
    <div className="instagram-visual-workspace">
      <section className="page-heading">
        <div>
          <p className="eyebrow">AUTOMAÇÃO VISUAL</p>
          <h1>Automações</h1>
          <p>
            Crie jornadas com nós conectados, condições e caminhos inteligentes.
          </p>
        </div>
        <button className="primary-button" onClick={() => setEditing(null)}>
          <Plus size={18} />
          Nova automação
        </button>
      </section>
      <section className="summary-strip">
        <div>
          <span className="summary-icon">
            <Zap size={20} />
          </span>
          <span>
            <small>Fluxos ativos</small>
            <strong>
              {automations.filter((item) => item.status === 'active').length}
            </strong>
          </span>
        </div>
        <i />
        <div>
          <span className="summary-icon magenta">
            <Workflow size={20} />
          </span>
          <span>
            <small>Execuções</small>
            <strong>
              {automations.reduce((sum, item) => sum + item.runs, 0)}
            </strong>
          </span>
        </div>
        <i />
        <div>
          <span className="summary-icon green">
            <GitBranch size={20} />
          </span>
          <span>
            <small>Gatilhos disponíveis</small>
            <strong>{TRIGGERS.length}</strong>
          </span>
        </div>
      </section>
      <section className="panel list-page-panel">
        <div className="list-toolbar">
          <label>
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar automação..."
            />
          </label>
          <span className="record-count">{filtered.length} fluxos</span>
        </div>
        <div className="table-head">
          <span>Automação</span>
          <span>Gatilho</span>
          <span>Execuções</span>
          <span>Status</span>
          <span />
        </div>
        <div className="full-automation-list">
          {filtered.map((item) => (
            <div className="automation-row" key={item.id}>
              <span className="automation-symbol">
                <Bot size={19} />
              </span>
              <button
                className="automation-name automation-link"
                onClick={() => setEditing(item)}
              >
                <strong>{item.name}</strong>
                <small>{item.keywords || 'Fluxo visual'}</small>
              </button>
              <span className="automation-trigger">
                <small>
                  {TRIGGERS.find(
                    (trigger) => trigger[0] === item.triggerType
                  )?.[1] || item.triggerType}
                </small>
              </span>
              <span className="automation-runs">
                <strong>{item.runs}</strong>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={item.status === 'active'}
                className={item.status === 'active' ? 'toggle on' : 'toggle'}
                onClick={() => onToggle(item)}
              >
                <i />
              </button>
              <span className="menu-wrap">
                <button
                  className="icon-button"
                  onClick={() => setMenu(menu === item.id ? null : item.id)}
                >
                  <MoreHorizontal size={18} />
                </button>
                {menu === item.id && (
                  <span className="flow-menu">
                    <button onClick={() => setEditing(item)}>
                      Editar no construtor
                    </button>
                    <button onClick={() => void duplicate(item)}>
                      Duplicar automação
                    </button>
                    <button
                      className="danger"
                      onClick={() => void remove(item)}
                    >
                      Excluir fluxo
                    </button>
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
        {!loading && !filtered.length && (
          <div className="vf-list-empty">
            <Workflow size={34} />
            <h3>Nenhuma automação</h3>
            <p>Comece com um gatilho e construa o fluxo no canvas.</p>
            <button className="primary-button" onClick={() => setEditing(null)}>
              Criar automação
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
