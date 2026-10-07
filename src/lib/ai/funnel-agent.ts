import type { SupabaseClient } from '@supabase/supabase-js'

type Row = Record<string, unknown>

const MAX_DEALS = 250
const MAX_TASKS = 250
const MAX_CONVERSATIONS = 300
const STALE_DEAL_DAYS = 7

export type FunnelAction =
  | { type: 'move_deal'; deal_id: string; stage_id: string }
  | { type: 'assign_deal'; deal_id: string; assignee_id: string | null }
  | {
      type: 'create_task'
      contact_id: string
      deal_id?: string | null
      assignee_id?: string | null
      title: string
      due_at: string
      description?: string | null
    }
  | { type: 'assign_task'; task_id: string; assignee_id: string | null }
  | { type: 'complete_task'; task_id: string }

export interface FunnelSnapshot {
  generatedAt: string
  summary: {
    openDeals: number
    totalOpenValue: number
    unassignedDeals: number
    staleDeals: number
    overdueTasks: number
    openTasks: number
    unreadConversations: number
  }
  highlights: Array<{ id: string; title: string; detail: string; severity: 'warning' | 'attention' }>
  modelContext: Record<string, unknown>
}

/** Load only conversations of a contact already visible to the caller. */
export async function loadFunnelContactHistory(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
) {
  const { data: contact, error: contactError } = await db
    .from('contacts')
    .select('id, name, company')
    .eq('account_id', accountId)
    .eq('id', contactId)
    .maybeSingle()
  if (contactError) throw contactError
  if (!contact) return null

  const { data: conversations, error: conversationsError } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
  if (conversationsError) throw conversationsError
  const conversationIds = (conversations ?? []).map((row) => row.id)
  if (!conversationIds.length) {
    return { contact, recent_messages: [] }
  }

  const { data: messages, error: messagesError } = await db
    .from('messages')
    .select('id, sender_type, content_type, content_text, created_at')
    .in('conversation_id', conversationIds)
    .order('created_at', { ascending: false })
    .limit(80)
  if (messagesError) throw messagesError
  return {
    contact,
    recent_messages: [...(messages ?? [])].reverse().map((message) => ({
      id: message.id,
      sender: message.sender_type,
      type: message.content_type,
      text: clip(message.content_text, 800),
      at: message.created_at,
    })),
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function relatedName(value: unknown): string | null {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null
  const row = value as Row
  return stringValue(row.name) || stringValue(row.full_name) || null
}

function clip(value: unknown, limit = 260): string | null {
  const text = stringValue(value).replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

function isOlderThan(value: unknown, days: number, now: number): boolean {
  const timestamp = Date.parse(stringValue(value))
  return Number.isFinite(timestamp) && timestamp < now - days * 86_400_000
}

/**
 * Produces a bounded, account-scoped snapshot for the CRM funnel assistant.
 * It deliberately sends summaries and the latest conversation previews to the
 * model, not an unbounded raw message archive. A user can still ask about a
 * specific lead and the assistant sees its current deal, tasks and preview.
 */
export async function loadFunnelSnapshot(
  db: SupabaseClient,
  accountId: string,
): Promise<FunnelSnapshot> {
  const [pipelinesResult, dealsResult, tasksResult, conversationsResult, membershipsResult] =
    await Promise.all([
      db
        .from('pipelines')
        .select('id, name, stages:pipeline_stages(id, name, position)')
        .eq('account_id', accountId)
        .order('name'),
      db
        .from('deals')
        .select(
          'id, title, value, currency, contact_id, pipeline_id, stage_id, assigned_to, status, notes, created_at, updated_at, contact:contacts(id, name, phone), stage:pipeline_stages(id, name), assignee:profiles(id, full_name, email)',
        )
        .eq('account_id', accountId)
        .neq('status', 'archived')
        .order('updated_at', { ascending: false })
        .limit(MAX_DEALS),
      db
        .from('tasks')
        .select(
          'id, title, description, due_at, status, contact_id, deal_id, assigned_to, created_at, contact:contacts(id, name, phone), deal:deals(id, title), assignee:profiles(id, full_name, email)',
        )
        .eq('account_id', accountId)
        .order('due_at', { ascending: true })
        .limit(MAX_TASKS),
      db
        .from('conversations')
        .select(
          'id, contact_id, status, assigned_agent_id, last_message_text, last_message_at, unread_count, updated_at, contact:contacts(id, name, phone)',
        )
        .eq('account_id', accountId)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(MAX_CONVERSATIONS),
      db
        .from('account_memberships')
        .select('user_id')
        .eq('account_id', accountId)
    ])

  const failures = [
    pipelinesResult.error,
    dealsResult.error,
    tasksResult.error,
    conversationsResult.error,
    membershipsResult.error,
  ].filter(Boolean)
  if (failures.length) throw failures[0]

  const memberUserIds = (membershipsResult.data ?? []).map((member) => member.user_id)
  const membersResult = memberUserIds.length
    ? await db.from('profiles').select('id, full_name, email').in('user_id', memberUserIds).order('full_name')
    : { data: [], error: null }
  if (membersResult.error) throw membersResult.error

  const pipelines = (pipelinesResult.data ?? []) as Row[]
  const deals = (dealsResult.data ?? []) as Row[]
  const tasks = (tasksResult.data ?? []) as Row[]
  const conversations = (conversationsResult.data ?? []) as Row[]
  const members = (membersResult.data ?? []) as Row[]
  const now = Date.now()

  const openDeals = deals.filter((deal) => stringValue(deal.status) === 'open')
  const staleDeals = openDeals.filter((deal) =>
    isOlderThan(deal.updated_at ?? deal.created_at, STALE_DEAL_DAYS, now),
  )
  const openTasks = tasks.filter((task) => stringValue(task.status) === 'open')
  const overdueTasks = openTasks.filter((task) => isOlderThan(task.due_at, 0, now))
  const unreadConversations = conversations.reduce(
    (total, conversation) => total + numberValue(conversation.unread_count),
    0,
  )

  const highlights: FunnelSnapshot['highlights'] = [
    ...overdueTasks.slice(0, 5).map((task) => ({
      id: stringValue(task.id),
      title: stringValue(task.title) || 'Tarefa sem título',
      detail: `Tarefa vencida · ${relatedName(task.contact) ?? 'Contato não identificado'}`,
      severity: 'warning' as const,
    })),
    ...staleDeals.slice(0, 5).map((deal) => ({
      id: stringValue(deal.id),
      title: stringValue(deal.title) || relatedName(deal.contact) || 'Negócio sem título',
      detail: `Sem atualização há mais de ${STALE_DEAL_DAYS} dias · ${relatedName(deal.stage) ?? 'Sem etapa'}`,
      severity: 'attention' as const,
    })),
  ]

  const modelContext = {
    generated_at: new Date(now).toISOString(),
    limits: {
      deals_loaded: deals.length,
      tasks_loaded: tasks.length,
      conversations_loaded: conversations.length,
    },
    pipelines: pipelines.map((pipeline) => ({
      id: stringValue(pipeline.id),
      name: stringValue(pipeline.name),
      stages: Array.isArray(pipeline.stages)
        ? pipeline.stages.map((stage) => ({
            id: stringValue((stage as Row).id),
            name: stringValue((stage as Row).name),
            position: numberValue((stage as Row).position),
          }))
        : [],
    })),
    members: members.map((member) => ({
      id: stringValue(member.id),
      name: stringValue(member.full_name) || stringValue(member.email),
    })),
    deals: deals.map((deal) => ({
      id: stringValue(deal.id),
      title: stringValue(deal.title),
      contact: relatedName(deal.contact),
      contact_id: stringValue(deal.contact_id),
      stage: relatedName(deal.stage),
      stage_id: stringValue(deal.stage_id),
      pipeline_id: stringValue(deal.pipeline_id),
      assignee: relatedName(deal.assignee),
      assignee_id: deal.assigned_to ?? null,
      status: stringValue(deal.status),
      value: numberValue(deal.value),
      currency: stringValue(deal.currency),
      last_updated_at: stringValue(deal.updated_at ?? deal.created_at),
      notes: clip(deal.notes, 180),
    })),
    tasks: tasks.map((task) => ({
      id: stringValue(task.id),
      title: stringValue(task.title),
      contact: relatedName(task.contact),
      contact_id: stringValue(task.contact_id),
      deal: relatedName(task.deal),
      deal_id: task.deal_id ?? null,
      assignee: relatedName(task.assignee),
      assignee_id: task.assigned_to ?? null,
      due_at: stringValue(task.due_at),
      status: stringValue(task.status),
      description: clip(task.description, 180),
    })),
    conversations: conversations.map((conversation) => ({
      id: stringValue(conversation.id),
      contact: relatedName(conversation.contact),
      contact_id: stringValue(conversation.contact_id),
      status: stringValue(conversation.status),
      unread_count: numberValue(conversation.unread_count),
      last_message_at: stringValue(conversation.last_message_at),
      last_message: clip(conversation.last_message_text),
    })),
  }

  return {
    generatedAt: modelContext.generated_at,
    summary: {
      openDeals: openDeals.length,
      totalOpenValue: openDeals.reduce((total, deal) => total + numberValue(deal.value), 0),
      unassignedDeals: openDeals.filter((deal) => !deal.assigned_to).length,
      staleDeals: staleDeals.length,
      overdueTasks: overdueTasks.length,
      openTasks: openTasks.length,
      unreadConversations,
    },
    highlights,
    modelContext,
  }
}

export function parseFunnelAction(value: unknown): FunnelAction | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const action = value as Record<string, unknown>
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const id = (key: string) =>
    typeof action[key] === 'string' && action[key].trim() ? action[key].trim() : null
  const uuid = (key: string) => {
    const value = id(key)
    return value && uuidPattern.test(value) ? value : null
  }
  const nullableId = (key: string): string | null | undefined => {
    if (action[key] === null) return null
    return uuid(key) ?? undefined
  }

  switch (action.type) {
    case 'move_deal': {
      const dealId = uuid('deal_id')
      const stageId = uuid('stage_id')
      return dealId && stageId ? { type: 'move_deal', deal_id: dealId, stage_id: stageId } : null
    }
    case 'assign_deal': {
      const dealId = uuid('deal_id')
      const assigneeId = nullableId('assignee_id')
      return dealId && assigneeId !== undefined
        ? { type: 'assign_deal', deal_id: dealId, assignee_id: assigneeId }
        : null
    }
    case 'create_task': {
      const contactId = uuid('contact_id')
      const title = id('title')
      const dueAt = id('due_at')
      const dealId = nullableId('deal_id')
      const assigneeId = nullableId('assignee_id')
      const description = typeof action.description === 'string' ? action.description.trim() || null : null
      return contactId && title && dueAt && dealId !== undefined && assigneeId !== undefined
        ? {
            type: 'create_task',
            contact_id: contactId,
            deal_id: dealId,
            assignee_id: assigneeId,
            title: title.slice(0, 300),
            due_at: dueAt,
            description,
          }
        : null
    }
    case 'assign_task': {
      const taskId = uuid('task_id')
      const assigneeId = nullableId('assignee_id')
      return taskId && assigneeId !== undefined
        ? { type: 'assign_task', task_id: taskId, assignee_id: assigneeId }
        : null
    }
    case 'complete_task': {
      const taskId = uuid('task_id')
      return taskId ? { type: 'complete_task', task_id: taskId } : null
    }
    default:
      return null
  }
}

async function belongsToAccount(
  db: SupabaseClient,
  accountId: string,
  table: 'contacts' | 'profiles',
  id: string | null,
): Promise<boolean> {
  if (!id) return true
  if (table === 'profiles') {
    const { data: profile, error: profileError } = await db
      .from('profiles').select('user_id').eq('id', id).maybeSingle()
    if (profileError) throw profileError
    if (!profile) return false
    const { data: membership, error: membershipError } = await db
      .from('account_memberships').select('user_id')
      .eq('account_id', accountId).eq('user_id', profile.user_id).maybeSingle()
    if (membershipError) throw membershipError
    return Boolean(membership)
  }
  const { data, error } = await db
    .from(table)
    .select('id')
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  return Boolean(data?.id)
}

/** Execute a validated, account-scoped action requested in the assistant chat. */
export async function executeFunnelAction(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  action: FunnelAction,
): Promise<string> {
  if (action.type === 'move_deal') {
    const { data: deal, error: dealError } = await db
      .from('deals')
      .select('id, pipeline_id, title')
      .eq('id', action.deal_id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (dealError) throw dealError
    if (!deal) throw new Error('Negócio não encontrado nesta conta.')
    const { data: stage, error: stageError } = await db
      .from('pipeline_stages')
      .select('id, name')
      .eq('id', action.stage_id)
      .eq('pipeline_id', deal.pipeline_id)
      .maybeSingle()
    if (stageError) throw stageError
    if (!stage) throw new Error('A etapa escolhida não pertence ao funil deste negócio.')
    const { error } = await db.from('deals').update({ stage_id: stage.id }).eq('id', deal.id)
    if (error) throw error
    return `Negócio “${deal.title}” movido para ${stage.name}.`
  }

  if (action.type === 'assign_deal') {
    const { data: deal, error: dealError } = await db
      .from('deals')
      .select('id, title')
      .eq('id', action.deal_id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (dealError) throw dealError
    if (!deal) throw new Error('Negócio não encontrado nesta conta.')
    if (!(await belongsToAccount(db, accountId, 'profiles', action.assignee_id))) {
      throw new Error('O responsável escolhido não pertence a esta conta.')
    }
    const { error } = await db
      .from('deals')
      .update({ assigned_to: action.assignee_id })
      .eq('id', deal.id)
    if (error) throw error
    return action.assignee_id
      ? `Responsável atualizado para o negócio “${deal.title}”.`
      : `O negócio “${deal.title}” ficou sem responsável.`
  }

  if (action.type === 'create_task') {
    if (!(await belongsToAccount(db, accountId, 'contacts', action.contact_id))) {
      throw new Error('O contato escolhido não pertence a esta conta.')
    }
    if (!(await belongsToAccount(db, accountId, 'profiles', action.assignee_id ?? null))) {
      throw new Error('O responsável escolhido não pertence a esta conta.')
    }
    const dueAt = new Date(action.due_at)
    if (Number.isNaN(dueAt.getTime())) throw new Error('A data da tarefa é inválida.')
    if (action.deal_id) {
      const { data: deal, error: dealError } = await db
        .from('deals')
        .select('id, contact_id')
        .eq('id', action.deal_id)
        .eq('account_id', accountId)
        .maybeSingle()
      if (dealError) throw dealError
      if (!deal || deal.contact_id !== action.contact_id) {
        throw new Error('O negócio informado não corresponde ao contato da tarefa.')
      }
    }
    const { error } = await db.from('tasks').insert({
      account_id: accountId,
      user_id: userId,
      contact_id: action.contact_id,
      deal_id: action.deal_id ?? null,
      assigned_to: action.assignee_id ?? null,
      title: action.title,
      description: action.description ?? null,
      due_at: dueAt.toISOString(),
      status: 'open',
    })
    if (error) throw error
    return `Tarefa “${action.title}” criada para ${dueAt.toLocaleString('pt-BR')}.`
  }

  if (action.type === 'assign_task') {
    const { data: task, error: taskError } = await db
      .from('tasks')
      .select('id, title')
      .eq('id', action.task_id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (taskError) throw taskError
    if (!task) throw new Error('Tarefa não encontrada nesta conta.')
    if (!(await belongsToAccount(db, accountId, 'profiles', action.assignee_id))) {
      throw new Error('O responsável escolhido não pertence a esta conta.')
    }
    const { error } = await db
      .from('tasks')
      .update({ assigned_to: action.assignee_id })
      .eq('id', task.id)
    if (error) throw error
    return action.assignee_id
      ? `Responsável atualizado para a tarefa “${task.title}”.`
      : `A tarefa “${task.title}” ficou sem responsável.`
  }

  const { data: task, error: taskError } = await db
    .from('tasks')
    .select('id, title')
    .eq('id', action.task_id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (taskError) throw taskError
  if (!task) throw new Error('Tarefa não encontrada nesta conta.')
  const { error } = await db
    .from('tasks')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', task.id)
  if (error) throw error
  return `Tarefa “${task.title}” marcada como concluída.`
}

export function isExplicitActionRequest(message: string): boolean {
  const normalized = message.trim().toLocaleLowerCase('pt-BR')
  if (/\b(?:não|nao|nunca|jamais)\s+(?:(?:quero|deve|pode|faça|fazer)\s+)?(?:que\s+)?(?:(?:você|voce)\s+)?(?:mova|mover|atribua|atribuir|crie|criar|conclua|concluir|marque|marcar)\b/.test(normalized)) {
    return false
  }
  if (/\b(?:como|quando|por que|é possível|e possivel|posso)\b/.test(normalized) && normalized.endsWith('?')) {
    return false
  }
  return /\b(?:mova|atribua|crie|conclua|marque|pode\s+(?:mover|atribuir|criar|concluir|marcar)|quero\s+que\s+(?:mova|atribua|crie|conclua|marque))\b/.test(normalized)
}
