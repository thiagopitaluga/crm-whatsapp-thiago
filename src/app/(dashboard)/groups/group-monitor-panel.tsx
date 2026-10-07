'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Group = { group_jid: string; subject: string; last_message_at?: string | null }
type Message = { id: string; participant_name: string | null; from_me: boolean; content_text: string; created_at: string }
type Insight = { summary: string; opportunities: string[]; questions: string[]; risks: string[]; suggested_tasks: string[]; message_count: number; created_at: string }
type ActionItem = { id: string; title: string; status: string }

export function GroupMonitorPanel({ groups }: { groups: Group[] }) {
  const [jid, setJid] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [insight, setInsight] = useState<Insight | null>(null)
  const [tasks, setTasks] = useState<ActionItem[]>([])
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!jid) return
    setLoading(true)
    try {
      const response = await fetch(`/api/whatsapp/group-monitor?group_jid=${encodeURIComponent(jid)}`, { cache: 'no-store' })
      const data = await response.json() as { messages?: Message[]; insight?: Insight | null; tasks?: ActionItem[]; error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Falha ao carregar grupo.')
      setMessages(data.messages ?? []); setInsight(data.insight ?? null); setTasks(data.tasks ?? [])
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha ao carregar grupo.') }
    finally { setLoading(false) }
  }, [jid])
  useEffect(() => { void load() }, [load])

  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (!jid) return
    setBusy(true)
    try {
      const response = await fetch('/api/whatsapp/group-monitor', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ group_jid: jid, action, ...extra }) })
      const data = await response.json() as { answer?: string; insight?: Insight; error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível concluir.')
      if (data.answer) setAnswer(data.answer)
      if (data.insight) setInsight(data.insight)
      if (action === 'task' || action === 'complete_task') await load()
      if (action === 'analyze') toast.success('Análise atualizada.')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível concluir.') }
    finally { setBusy(false) }
  }

  const sections: Array<[string, string[] | undefined]> = [
    ['Oportunidades', insight?.opportunities], ['Dúvidas', insight?.questions],
    ['Riscos / alertas', insight?.risks], ['Próximas ações sugeridas', insight?.suggested_tasks],
  ]
  return <section className="rounded-xl border border-border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-primary" />Monitoramento dos grupos</h2><p className="mt-1 text-xs text-muted-foreground">Mensagens novas recebidas pela conexão QR, resumo e perguntas para a IA.</p></div>
      <Button variant="outline" size="sm" onClick={() => void load()} disabled={!jid || loading}><RefreshCw className={loading ? 'animate-spin' : ''} />Atualizar</Button></div>
    <div className="mt-4 flex flex-wrap items-center gap-2"><select aria-label="Grupo para monitorar" value={jid} onChange={(event) => { setJid(event.target.value); setAnswer('') }} className="h-9 min-w-56 flex-1 rounded-md border border-input bg-background px-3 text-sm"><option value="">Escolha um grupo</option>{groups.map((group) => <option key={group.group_jid} value={group.group_jid}>{group.subject}</option>)}</select>
      <Button size="sm" disabled={!jid || busy || messages.length === 0} onClick={() => void act('analyze')}>{busy ? <Loader2 className="animate-spin" /> : <Sparkles />}Analisar agora</Button></div>
    {jid ? <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="space-y-3"><h3 className="text-sm font-semibold">Conversa recente · {messages.length} mensagens</h3><div className="max-h-80 space-y-2 overflow-y-auto rounded-md border border-border p-3">{messages.length ? messages.map((message) => <div key={message.id} className="text-xs"><span className="font-semibold">{message.from_me ? 'Você' : message.participant_name || 'Participante'}</span><span className="ml-2 text-muted-foreground">{new Date(message.created_at).toLocaleString('pt-BR')}</span><p className="mt-0.5 whitespace-pre-wrap break-words">{message.content_text}</p></div>) : <p className="text-xs text-muted-foreground">Sem mensagens monitoradas ainda. O histórico anterior à ativação não está disponível aqui.</p>}</div></div>
      <div className="space-y-3"><h3 className="text-sm font-semibold">Leitura da IA</h3>{insight ? <div className="space-y-3 rounded-md border border-border p-3 text-sm"><p className="whitespace-pre-wrap">{insight.summary}</p>{sections.map(([title, items]) => items?.length ? <div key={title}><h4 className="text-xs font-semibold text-primary">{title}</h4><ul className="mt-1 list-inside list-disc space-y-1 text-xs">{items.map((item, index) => <li key={`${title}-${index}`}>{item}{title === 'Próximas ações sugeridas' ? <button type="button" className="ml-2 text-primary underline" onClick={() => void act('task', { title: item })}>Criar tarefa</button> : null}</li>)}</ul></div> : null)}<p className="text-xs text-muted-foreground">Base: {insight.message_count} mensagens · {new Date(insight.created_at).toLocaleString('pt-BR')}</p></div> : <p className="text-xs text-muted-foreground">Clique em “Analisar agora” para gerar a primeira leitura.</p>}
        <div className="flex gap-2"><Input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Pergunte sobre o andamento..." onKeyDown={(event) => { if (event.key === 'Enter' && question.trim()) void act('question', { question }) }} /><Button variant="outline" size="sm" disabled={!question.trim() || busy || messages.length === 0} onClick={() => void act('question', { question })}>Perguntar</Button></div>{answer ? <p className="whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-sm">{answer}</p> : null}
        {tasks.length ? <div><h4 className="text-xs font-semibold">Tarefas do grupo</h4><ul className="mt-1 space-y-1">{tasks.map((task) => <li key={task.id} className="flex items-center justify-between gap-2 text-xs"><span className={task.status === 'completed' ? 'text-muted-foreground line-through' : ''}>{task.title}</span>{task.status === 'open' ? <button type="button" className="text-primary underline" onClick={() => void act('complete_task', { task_id: task.id })}>Concluir</button> : null}</li>)}</ul></div> : null}
      </div>
    </div> : null}
  </section>
}

