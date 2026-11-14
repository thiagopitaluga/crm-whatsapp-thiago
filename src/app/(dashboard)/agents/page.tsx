'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Bot, UserRound, Brain, Clock3, Shield, GraduationCap, Zap,
  Package, Radio, Lightbulb, BarChart3, Plus, Trash2, Loader2,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { AiPlayground } from '@/components/agents/ai-playground';
import { AiUsageCard } from '@/components/agents/ai-usage';
import { FunnelAssistant } from '@/components/agents/funnel-assistant';
import { AiConfig, type AiConfigSection } from '@/components/settings/ai-config';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';

const configTabs: { id: AiConfigSection; label: string; icon: typeof Bot }[] = [
  { id: 'agents', label: 'Agentes', icon: Bot },
  { id: 'persona', label: 'Persona', icon: UserRound },
  { id: 'behavior', label: 'Comportamento', icon: Brain },
  { id: 'followup', label: 'Follow-up', icon: Clock3 },
  { id: 'rules', label: 'Regras', icon: Shield },
  { id: 'training', label: 'Treinamentos', icon: GraduationCap },
  { id: 'triggers', label: 'Gatilhos', icon: Zap },
  { id: 'products', label: 'Produtos', icon: Package },
  { id: 'channels', label: 'Canais', icon: Radio },
];

export default function AgentsPage() {
  const { accountRole } = useAuth();
  const canViewUsage = accountRole ? canEditSettings(accountRole) : false;
  const [tab, setTab] = useState<string>('agents');
  const [agents, setAgents] = useState<{ id: string; name: string; is_default: boolean; is_active: boolean; channel_keys: string[] }[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [agentBusy, setAgentBusy] = useState(false);

  const refreshAgents = useCallback(async () => {
    try {
      const response = await fetch('/api/ai/agents', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Não foi possível carregar os agentes.');
      const next = Array.isArray(payload.agents) ? payload.agents : [];
      setAgents(next);
      setSelectedAgentId((current) => next.some((agent: { id: string }) => agent.id === current)
        ? current
        : (next.find((agent: { is_default: boolean }) => agent.is_default)?.id ?? next[0]?.id ?? ''));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível carregar os agentes.');
    }
  }, []);

  useEffect(() => { void refreshAgents(); }, [refreshAgents]);

  const createAgent = async () => {
    setAgentBusy(true);
    try {
      const response = await fetch('/api/ai/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Agente ${agents.length + 1}` }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Não foi possível criar o agente.');
      await refreshAgents();
      if (payload.agent?.id) setSelectedAgentId(payload.agent.id);
      setTab('agents');
      toast.success('Agente criado. Configure o perfil e conecte um WhatsApp.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível criar o agente.');
    } finally { setAgentBusy(false); }
  };

  const deleteAgent = async () => {
    if (agents.length <= 1 || !selectedAgentId) return;
    const selected = agents.find((agent) => agent.id === selectedAgentId);
    if (!window.confirm(`Excluir o agente “${selected?.name}”? Os gatilhos deste agente também serão removidos.`)) return;
    setAgentBusy(true);
    try {
      const response = await fetch(`/api/ai/agents/${selectedAgentId}`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Não foi possível excluir o agente.');
      await refreshAgents();
      toast.success('Agente excluído.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível excluir o agente.');
    } finally { setAgentBusy(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <Bot className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Agentes de IA</h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Configure identidade, atendimento, canais e aprendizado do agente em áreas separadas.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
        <div className="mr-auto min-w-36">
          <p className="text-sm font-semibold">Agentes ({agents.length})</p>
          <p className="text-xs text-muted-foreground">Selecione um perfil para editar</p>
        </div>
        <Select value={selectedAgentId} onValueChange={(value) => setSelectedAgentId(value ?? '')}>
          <SelectTrigger className="min-w-52 flex-1 sm:flex-none"><SelectValue placeholder="Selecione um agente" /></SelectTrigger>
          <SelectContent>
            {agents.map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.name}{agent.is_default ? ' · padrão' : ''}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={createAgent} disabled={agentBusy}>
          {agentBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Novo agente
        </Button>
        <Button variant="ghost" onClick={deleteAgent} disabled={agentBusy || agents.length <= 1} aria-label="Excluir agente selecionado">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList variant="line" className="h-auto w-full flex-wrap justify-start gap-x-5 gap-y-1 rounded-none border-b bg-transparent p-0">
          {configTabs.map(({ id, label, icon: Icon }) => (
            <TabsTrigger key={id} value={id} className="h-auto flex-none rounded-none px-1.5 py-3 text-sm data-[state=active]:text-primary after:bg-primary">
              <Icon className="mr-1.5 h-4 w-4" />{label}
            </TabsTrigger>
          ))}
          <TabsTrigger value="suggestions" className="h-auto flex-none rounded-none px-1.5 py-3 text-sm data-[state=active]:text-primary after:bg-primary">
            <Lightbulb className="mr-1.5 h-4 w-4" />Sugestões
          </TabsTrigger>
          {canViewUsage && (
            <TabsTrigger value="usage" className="h-auto flex-none rounded-none px-1.5 py-3 text-sm data-[state=active]:text-primary after:bg-primary">
              <BarChart3 className="mr-1.5 h-4 w-4" />Uso
            </TabsTrigger>
          )}
        </TabsList>

        {configTabs.map(({ id }) => (
          <TabsContent key={id} value={id} className="mt-4">
            <AiConfig section={id} agentId={selectedAgentId || undefined} onAgentSaved={refreshAgents} />
          </TabsContent>
        ))}
        <TabsContent value="suggestions" className="mt-4 space-y-6">
          <AiPlayground agentId={selectedAgentId || undefined} onGoToSetup={() => setTab('agents')} />
          <FunnelAssistant agentId={selectedAgentId || undefined} onGoToSetup={() => setTab('agents')} />
        </TabsContent>
        {canViewUsage && (
          <TabsContent value="usage" className="mt-4"><AiUsageCard /></TabsContent>
        )}
      </Tabs>
    </div>
  );
}
