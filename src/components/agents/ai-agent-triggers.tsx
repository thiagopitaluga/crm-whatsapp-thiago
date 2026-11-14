'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Bell, Check, ChevronLeft, ChevronRight, Clock3, Loader2, MessageSquare, Plus, Send, ShieldCheck, Sparkles, Tag, Trash2, Truck, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type TriggerType = 'new_message' | 'keyword' | 'no_response' | 'stage_changed' | 'tag_added' | 'custom_instruction' | 'order_paid' | 'order_shipped';
type ActionType = 'send_message' | 'send_media' | 'add_tag' | 'remove_tag' | 'notify_user' | 'notify_whatsapp' | 'assign_conversation' | 'webhook' | 'move_stage';
type TriggerFilter = { field: string; operator: string; value: string };
type AgentTrigger = { id: string; name: string; trigger_type: TriggerType; trigger_config: Record<string, unknown>; filters: TriggerFilter[]; action_type: ActionType; action_config: Record<string, unknown>; is_active: boolean; execution_count: number };

const TRIGGERS: { id: TriggerType; name: string; description: string; icon: typeof Zap }[] = [
  { id: 'new_message', name: 'Nova mensagem', description: 'Quando o lead envia uma mensagem.', icon: MessageSquare },
  { id: 'keyword', name: 'Palavra-chave', description: 'Quando a mensagem contém uma palavra ou frase.', icon: Sparkles },
  { id: 'no_response', name: 'Sem resposta do lead', description: 'Quando o lead fica sem responder por um período.', icon: Clock3 },
  { id: 'stage_changed', name: 'Mudança de estágio', description: 'Quando o lead entra em um estágio do funil.', icon: ChevronRight },
  { id: 'tag_added', name: 'Tag adicionada', description: 'Quando uma tag é aplicada ao lead/contato.', icon: Tag },
  { id: 'custom_instruction', name: 'Instrução customizada', description: 'A IA avalia uma instrução em texto a cada mensagem recebida.', icon: Sparkles },
  { id: 'order_paid', name: 'Pedido pago', description: 'Disponível após conectar uma integração de pedidos.', icon: Check },
  { id: 'order_shipped', name: 'Pedido enviado', description: 'Disponível após conectar uma integração de pedidos.', icon: Truck },
];

const ACTIONS: { id: ActionType; name: string; description: string; icon: typeof Zap }[] = [
  { id: 'send_message', name: 'Enviar mensagem', description: 'Envia um texto para o próprio lead.', icon: MessageSquare },
  { id: 'send_media', name: 'Enviar mídia', description: 'Envia imagem, vídeo, áudio ou documento.', icon: Send },
  { id: 'add_tag', name: 'Adicionar tag', description: 'Marca o contato/lead com uma tag.', icon: Tag },
  { id: 'remove_tag', name: 'Remover tag', description: 'Remove uma tag do contato/lead.', icon: Tag },
  { id: 'notify_user', name: 'Notificar usuário (in-app)', description: 'Cria uma notificação dentro do OrganiZAP.', icon: Bell },
  { id: 'notify_whatsapp', name: 'Notificar via WhatsApp', description: 'Envia uma notificação para um número definido.', icon: MessageSquare },
  { id: 'assign_conversation', name: 'Atribuir conversa', description: 'Encaminha a conversa para uma pessoa da equipe.', icon: ShieldCheck },
  { id: 'webhook', name: 'Enviar webhook', description: 'Envia os dados do evento a uma URL externa.', icon: Zap },
  { id: 'move_stage', name: 'Mover de estágio', description: 'Move o lead para um estágio do pipeline.', icon: ChevronRight },
];

const FILTER_FIELDS = [
  { value: 'origin', label: 'Origem' },
  { value: 'campaign', label: 'Campanha' },
  { value: 'channel', label: 'Canal' },
  { value: 'message', label: 'Texto da mensagem' },
  { value: 'stage', label: 'Estágio do funil' },
  { value: 'tag', label: 'Tag do contato' },
  { value: 'contact_name', label: 'Nome do contato' },
];

const defaultConfig = (type: TriggerType) => type === 'custom_instruction'
  ? { instruction: '' }
  : type === 'keyword' ? { keywords: '' }
    : type === 'no_response' ? { hours: 24 }
      : type === 'stage_changed' ? { stage_id: '' }
        : type === 'tag_added' ? { tag_id: '' } : {};

export function AiAgentTriggers({ agentId, disabled = false }: { agentId?: string; disabled?: boolean }) {
  const [triggers, setTriggers] = useState<AgentTrigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedType, setSelectedType] = useState<TriggerType | null>(null);
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>({});
  const [filters, setFilters] = useState<TriggerFilter[]>([]);
  const [actionType, setActionType] = useState<ActionType>('send_message');
  const [actionConfig, setActionConfig] = useState<Record<string, unknown>>({ text: '' });
  const [activateOnSave, setActivateOnSave] = useState(false);

  const load = useCallback(async () => {
    if (!agentId) { setTriggers([]); setLoading(false); return; }
    setLoading(true);
    try {
      const response = await fetch(`/api/ai/agents/${agentId}/triggers`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Não foi possível carregar os gatilhos.');
      setTriggers(Array.isArray(payload.triggers) ? payload.triggers : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao carregar gatilhos.');
    } finally { setLoading(false); }
  }, [agentId]);

  useEffect(() => { void load(); }, [load]);

  const selectTemplate = (type: TriggerType) => {
    setSelectedType(type);
    setStep(1);
    setName(TRIGGERS.find((trigger) => trigger.id === type)?.name ?? 'Novo gatilho');
    setTriggerConfig(defaultConfig(type));
    setFilters([]);
    setActionType('send_message');
    setActionConfig({ text: '' });
    setActivateOnSave(false);
  };

  const updateTriggerConfig = (key: string, value: unknown) => setTriggerConfig((config) => ({ ...config, [key]: value }));
  const updateActionConfig = (key: string, value: unknown) => setActionConfig((config) => ({ ...config, [key]: value }));

  const save = async () => {
    if (!agentId || !selectedType) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/ai/agents/${agentId}/triggers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, trigger_type: selectedType, trigger_config: triggerConfig, filters, action_type: actionType, action_config: actionConfig, is_active: activateOnSave }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Não foi possível salvar o gatilho.');
      toast.success(activateOnSave ? 'Gatilho salvo e ativado.' : 'Gatilho salvo como rascunho.');
      setSelectedType(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível salvar o gatilho.');
    } finally { setSaving(false); }
  };

  const toggle = async (item: AgentTrigger, enabled: boolean) => {
    try {
      const response = await fetch(`/api/ai/agents/${agentId}/triggers`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, is_active: enabled }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Não foi possível atualizar o gatilho.');
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha ao atualizar.'); }
  };

  const remove = async (item: AgentTrigger) => {
    try {
      const response = await fetch(`/api/ai/agents/${agentId}/triggers?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Não foi possível excluir o gatilho.');
      toast.success('Gatilho removido.');
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha ao excluir.'); }
  };

  if (!agentId) return <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">Crie ou selecione um agente para configurar gatilhos.</p>;

  return <div className="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle>Gatilhos deste agente</CardTitle>
        <CardDescription>Escolha o evento, defina filtros opcionais (todos precisam corresponder) e configure a ação automática.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!selectedType ? <>
          <div className="grid gap-3 sm:grid-cols-2">
            {TRIGGERS.map(({ id, name: title, description, icon: Icon }) => <button key={id} type="button" disabled={disabled || id === 'order_paid' || id === 'order_shipped'} onClick={() => selectTemplate(id)} className="flex min-h-20 items-start gap-3 rounded-xl border bg-card p-4 text-left transition hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50">
              <span className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary"><Icon className="h-4 w-4" /></span>
              <span><span className="block font-semibold">{title}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{description}</span></span>
            </button>)}
          </div>
          {loading ? <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div> : triggers.length === 0 ? <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">Nenhum gatilho ainda. Escolha um modelo acima para começar.</p> : <div className="space-y-2 pt-3">
            <h3 className="text-sm font-semibold">Gatilhos configurados ({triggers.length})</h3>
            {triggers.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{TRIGGERS.find((entry) => entry.id === item.trigger_type)?.name} → {ACTIONS.find((entry) => entry.id === item.action_type)?.name} · {item.execution_count} execuções</p></div>
              <Switch checked={item.is_active} disabled={disabled} onCheckedChange={(value) => void toggle(item, value)} aria-label={`Ativar ${item.name}`} />
              <Button variant="ghost" size="icon" disabled={disabled} onClick={() => void remove(item)} aria-label={`Excluir ${item.name}`}><Trash2 className="h-4 w-4" /></Button>
            </div>)}
          </div>}
        </> : <div className="space-y-5 rounded-xl border p-4 sm:p-6">
          <div className="flex items-center justify-between border-b pb-3 text-xs font-medium sm:text-sm">
            {['Quando', 'Filtros', 'O que fazer'].map((label, index) => <button key={label} type="button" onClick={() => setStep(index + 1)} className={`flex items-center gap-1.5 ${step === index + 1 ? 'text-foreground' : 'text-muted-foreground'}`}><span className={`grid h-6 w-6 place-items-center rounded-full ${step >= index + 1 ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>{index + 1}</span><span className="hidden sm:inline">{label}</span></button>)}
            <Button variant="ghost" size="sm" onClick={() => setSelectedType(null)}>Cancelar</Button>
          </div>
          {step === 1 && <div className="space-y-4">
            <div className="space-y-2"><Label>Nome do gatilho</Label><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ex.: Qualificar lead interessado" /></div>
            {selectedType === 'custom_instruction' && <div className="space-y-2"><Label>Instrução customizada para a IA</Label><Textarea value={String(triggerConfig.instruction ?? '')} onChange={(e) => updateTriggerConfig('instruction', e.target.value)} rows={5} placeholder="Ex.: Dispare quando o lead demonstrar intenção clara de contratar, mencionar uma data para começar ou pedir condições de pagamento. Não dispare para perguntas gerais." /><p className="text-xs text-muted-foreground">A instrução será avaliada pela IA em cada mensagem recebida antes de executar a ação.</p></div>}
            {selectedType === 'keyword' && <div className="space-y-2"><Label>Palavras ou frases (uma por linha)</Label><Textarea value={String(triggerConfig.keywords ?? '')} onChange={(e) => updateTriggerConfig('keywords', e.target.value)} rows={4} placeholder={'preço\nquero contratar\nagendar uma visita'} /></div>}
            {selectedType === 'no_response' && <div className="space-y-2"><Label>Tempo sem resposta do lead (horas)</Label><Input type="number" min={1} max={8760} value={Number(triggerConfig.hours ?? 24)} onChange={(e) => updateTriggerConfig('hours', Number(e.target.value))} /></div>}
            {selectedType === 'stage_changed' && <div className="space-y-2"><Label>ID do estágio (deixe vazio para qualquer estágio)</Label><Input value={String(triggerConfig.stage_id ?? '')} onChange={(e) => updateTriggerConfig('stage_id', e.target.value)} placeholder="ID da etapa do pipeline" /></div>}
            {selectedType === 'tag_added' && <div className="space-y-2"><Label>ID da tag (deixe vazio para qualquer tag)</Label><Input value={String(triggerConfig.tag_id ?? '')} onChange={(e) => updateTriggerConfig('tag_id', e.target.value)} placeholder="ID da tag" /></div>}
          </div>}
          {step === 2 && <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Adicione filtros opcionais — todos precisam ser verdadeiros (AND). Sem filtros, todo evento deste tipo dispara o gatilho.</p>
            {filters.map((filter, index) => <div key={index} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <select aria-label="Campo do filtro" className="h-10 rounded-md border bg-background px-3 text-sm" value={filter.field} onChange={(e) => setFilters((old) => old.map((f, i) => i === index ? { ...f, field: e.target.value } : f))}>{FILTER_FIELDS.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}</select>
              <select aria-label="Operador do filtro" className="h-10 rounded-md border bg-background px-3 text-sm" value={filter.operator} onChange={(e) => setFilters((old) => old.map((f, i) => i === index ? { ...f, operator: e.target.value } : f))}><option value="equals">é</option><option value="not_equals">não é</option><option value="contains">contém</option><option value="not_contains">não contém</option><option value="starts_with">começa com</option><option value="exists">tem valor</option><option value="not_exists">não tem valor</option></select>
              <Input aria-label="Valor do filtro" value={filter.value} disabled={filter.operator === 'exists' || filter.operator === 'not_exists'} onChange={(e) => setFilters((old) => old.map((f, i) => i === index ? { ...f, value: e.target.value } : f))} placeholder="Valor esperado" />
              <Button variant="ghost" onClick={() => setFilters((old) => old.filter((_, i) => i !== index))} aria-label="Remover filtro"><Trash2 className="h-4 w-4" /></Button>
            </div>)}
            <Button variant="outline" onClick={() => setFilters((old) => [...old, { field: 'origin', operator: 'equals', value: '' }])}><Plus className="mr-2 h-4 w-4" />Adicionar filtro</Button>
          </div>}
          {step === 3 && <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">{ACTIONS.map(({ id, name: title, description, icon: Icon }) => <button key={id} type="button" onClick={() => { setActionType(id); setActionConfig({}); }} className={`flex min-h-16 items-start gap-2 rounded-lg border p-3 text-left transition hover:border-primary/50 ${actionType === id ? 'border-primary bg-primary/5' : ''}`}><Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-muted-foreground">{description}</span></span></button>)}</div>
            {actionType === 'send_message' && <div className="space-y-2"><Label>Texto da mensagem</Label><Textarea value={String(actionConfig.text ?? '')} onChange={(e) => updateActionConfig('text', e.target.value)} rows={4} placeholder="Olá {contact.name}, posso ajudar?" /><p className="text-xs text-muted-foreground">Variáveis: {'{contact.name}'}, {'{contact.phone}'}, {'{contact.email}'}</p></div>}
            {actionType === 'send_media' && <div className="grid gap-3 sm:grid-cols-3"><div className="space-y-2"><Label>Tipo de mídia</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={String(actionConfig.kind ?? 'image')} onChange={(e) => updateActionConfig('kind', e.target.value)}><option value="image">Imagem</option><option value="video">Vídeo</option><option value="document">Documento</option></select></div><div className="space-y-2"><Label>URL pública da mídia</Label><Input value={String(actionConfig.url ?? '')} onChange={(e) => updateActionConfig('url', e.target.value)} placeholder="https://..." /></div><div className="space-y-2"><Label>Legenda (opcional)</Label><Input value={String(actionConfig.caption ?? '')} onChange={(e) => updateActionConfig('caption', e.target.value)} /></div></div>}
            {(actionType === 'add_tag' || actionType === 'remove_tag') && <div className="space-y-2"><Label>ID da tag</Label><Input value={String(actionConfig.tag_id ?? '')} onChange={(e) => updateActionConfig('tag_id', e.target.value)} placeholder="ID da tag existente" /></div>}
            {actionType === 'notify_user' && <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>ID do usuário a notificar</Label><Input value={String(actionConfig.user_id ?? '')} onChange={(e) => updateActionConfig('user_id', e.target.value)} /></div><div className="space-y-2"><Label>Mensagem da notificação</Label><Input value={String(actionConfig.text ?? '')} onChange={(e) => updateActionConfig('text', e.target.value)} /></div></div>}
            {actionType === 'notify_whatsapp' && <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Telefone de destino (com código do país)</Label><Input value={String(actionConfig.phone ?? '')} onChange={(e) => updateActionConfig('phone', e.target.value)} placeholder="5511999999999" /></div><div className="space-y-2"><Label>Mensagem</Label><Input value={String(actionConfig.text ?? '')} onChange={(e) => updateActionConfig('text', e.target.value)} /></div></div>}
            {actionType === 'assign_conversation' && <div className="space-y-2"><Label>ID do usuário responsável</Label><Input value={String(actionConfig.user_id ?? '')} onChange={(e) => updateActionConfig('user_id', e.target.value)} placeholder="ID de um membro da equipe" /></div>}
            {actionType === 'webhook' && <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>URL do webhook</Label><Input type="url" value={String(actionConfig.url ?? '')} onChange={(e) => updateActionConfig('url', e.target.value)} placeholder="https://api.exemplo.com/evento" /></div><div className="space-y-2"><Label>Segredo compartilhado (opcional)</Label><Input type="password" value={String(actionConfig.secret ?? '')} onChange={(e) => updateActionConfig('secret', e.target.value)} autoComplete="new-password" /></div></div>}
            {actionType === 'move_stage' && <div className="space-y-2"><Label>ID da etapa de destino</Label><Input value={String(actionConfig.stage_id ?? '')} onChange={(e) => updateActionConfig('stage_id', e.target.value)} placeholder="ID da etapa do pipeline" /></div>}
            <label className="flex items-center gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={activateOnSave} onChange={(e) => setActivateOnSave(e.target.checked)} />Ativar depois de salvar</label>
          </div>}
          <div className="flex items-center justify-between border-t pt-4"><Button variant="outline" onClick={() => step === 1 ? setSelectedType(null) : setStep((current) => Math.max(1, current - 1))}><ChevronLeft className="mr-1 h-4 w-4" />Voltar</Button><span className="text-xs text-muted-foreground">Etapa {step} de 3</span>{step < 3 ? <Button onClick={() => setStep((current) => Math.min(3, current + 1))}>Próximo<ChevronRight className="ml-1 h-4 w-4" /></Button> : <Button onClick={() => void save()} disabled={saving || !name.trim()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar gatilho</Button>}</div>
        </div>}
      </CardContent>
    </Card>
  </div>;
}
