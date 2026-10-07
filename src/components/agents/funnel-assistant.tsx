'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  CircleAlert,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  UserCircle2,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Turn {
  role: 'user' | 'assistant'
  content: string
}

interface FunnelSummary {
  openDeals: number
  totalOpenValue: number
  unassignedDeals: number
  staleDeals: number
  overdueTasks: number
  openTasks: number
  unreadConversations: number
}

interface Highlight {
  id: string
  title: string
  detail: string
  severity: 'warning' | 'attention'
}

interface FunnelData {
  summary: FunnelSummary
  highlights: Highlight[]
}

const STARTER_QUESTIONS = [
  'Quais oportunidades devo priorizar hoje?',
  'Quais cards estão parados?',
  'Quais tarefas estão vencidas?',
]

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(value)
}

export function FunnelAssistant({ onGoToSetup }: { onGoToSetup: () => void }) {
  const [data, setData] = useState<FunnelData | null>(null)
  const [loadingData, setLoadingData] = useState(true)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  async function loadOverview() {
    setLoadingData(true)
    try {
      const response = await fetch('/api/ai/funnel', { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error ?? 'Falha ao carregar o funil.')
      setData({ summary: payload.summary, highlights: payload.highlights ?? [] })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao carregar o funil.')
    } finally {
      setLoadingData(false)
    }
  }

  useEffect(() => {
    void loadOverview()
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [turns, sending])

  async function send(question = input) {
    const text = question.trim()
    if (!text || sending) return

    const next: Turn[] = [...turns, { role: 'user', content: text }]
    setTurns(next)
    setInput('')
    setSending(true)
    try {
      const response = await fetch('/api/ai/funnel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        if (payload?.code === 'ai_not_configured') {
          toast.error('Configure a IA antes de usar o assistente do funil.')
          onGoToSetup()
        } else {
          toast.error(payload?.error ?? 'Não foi possível consultar o assistente.')
        }
        setTurns(turns)
        setInput(text)
        return
      }
      setTurns([
        ...next,
        { role: 'assistant', content: typeof payload?.reply === 'string' ? payload.reply : '' },
      ])
      if (payload?.snapshot) setData(payload.snapshot as FunnelData)
    } catch {
      toast.error('Não foi possível acessar o assistente.')
      setTurns(turns)
      setInput(text)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Sparkles className="size-5 text-primary" /> Assistente do funil
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Analisa conversas, oportunidades e tarefas da empresa. Quando você pedir uma ação clara, ele pode executá-la no CRM.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadOverview()} disabled={loadingData}>
          <RefreshCw className={cn('mr-1.5 size-3.5', loadingData && 'animate-spin')} /> Atualizar análise
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Negócios abertos" value={data ? String(data.summary.openDeals) : '—'} detail={data ? formatCurrency(data.summary.totalOpenValue) : undefined} />
        <Metric label="Sem responsável" value={data ? String(data.summary.unassignedDeals) : '—'} tone="attention" />
        <Metric label="Cards parados" value={data ? String(data.summary.staleDeals) : '—'} detail="mais de 7 dias" tone="attention" />
        <Metric label="Tarefas vencidas" value={data ? String(data.summary.overdueTasks) : '—'} detail={data ? `${data.summary.openTasks} em aberto` : undefined} tone="warning" />
      </div>

      {data?.highlights.length ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <CircleAlert className="size-4 text-primary" /> Pontos que pedem atenção
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {data.highlights.map((highlight) => (
              <div key={`${highlight.severity}-${highlight.id}`} className="rounded-lg border border-border bg-muted/35 px-3 py-2.5">
                <div className="flex gap-2">
                  {highlight.severity === 'warning' ? (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                  ) : (
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-primary" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{highlight.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{highlight.detail}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex h-[min(62vh,620px)] min-h-[440px] flex-col overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Converse sobre sua operação</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Exemplos: priorize oportunidades, mova um card, atribua um responsável ou crie uma tarefa.
          </p>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          {turns.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Bot className="mb-3 size-9 text-primary/80" />
              <p className="text-sm font-medium text-foreground">O que você quer entender ou organizar?</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                O assistente usa os dados compartilhados da sua conta para sugerir prioridades e executar pedidos objetivos.
              </p>
              <div className="mt-4 flex max-w-xl flex-wrap justify-center gap-2">
                {STARTER_QUESTIONS.map((question) => (
                  <Button key={question} type="button" variant="outline" size="sm" onClick={() => void send(question)}>
                    {question}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {turns.map((turn, index) => (
            <div key={`${turn.role}-${index}`} className={cn('flex gap-2', turn.role === 'user' ? 'justify-end' : 'justify-start')}>
              {turn.role === 'assistant' && <Bot className="mt-1 size-5 shrink-0 text-primary" />}
              <div className={cn('max-w-[86%] rounded-2xl px-3.5 py-2.5 text-sm', turn.role === 'user' ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-muted text-foreground')}>
                <p className="whitespace-pre-wrap">{turn.content}</p>
              </div>
              {turn.role === 'user' && <UserCircle2 className="mt-1 size-5 shrink-0 text-muted-foreground" />}
            </div>
          ))}

          {sending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-primary" /> Analisando o CRM…
            </div>
          )}
        </div>

        <div className="flex items-end gap-2 border-t border-border p-3">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            placeholder="Ex.: mova o negócio da Maria para Proposta e atribua para João"
            rows={1}
            className="flex-1 resize-none rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50"
          />
          <Button type="button" size="sm" onClick={() => void send()} disabled={!input.trim() || sending} className="size-9 shrink-0 p-0">
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string
  value: string
  detail?: string
  tone?: 'default' | 'attention' | 'warning'
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className={cn('text-2xl font-semibold tabular-nums text-foreground', tone === 'warning' && 'text-amber-500', tone === 'attention' && 'text-primary')}>
          {value}
        </p>
        {detail ? <span className="pb-1 text-xs text-muted-foreground">{detail}</span> : null}
      </div>
    </div>
  )
}
