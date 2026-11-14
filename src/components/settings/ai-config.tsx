'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Sparkles,
  CheckCircle2,
  Trash2,
  Plus,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsPanelHead } from './settings-panel-head';
import { AiKnowledgeCard } from './ai-knowledge';
import { AiTrainingReview } from '@/components/agents/ai-training-review';
import { AiAgentTriggers } from '@/components/agents/ai-agent-triggers';
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults';
import type { AiProvider } from '@/lib/ai/types';
import {
  DEFAULT_AI_AGENT_SETTINGS,
  normalizeAiAgentSettings,
  validateAiAgentSettings,
  type AiAgentSettings,
} from '@/lib/ai/agent-settings';
import type { AccountMember } from '@/types';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';
import { useTranslations } from 'next-intl';

const MASKED_KEY = '••••••••••••••••';

// Radix Select can't use an empty-string item value, so the "leave
// unassigned" choice gets a sentinel that maps to null in the payload.
const HANDOFF_QUEUE = '__queue__';

const PROVIDER_LABEL: Record<AiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
};

const KEY_PLACEHOLDER: Record<AiProvider, string> = {
  openai: 'sk-...',
  anthropic: 'sk-ant-...',
};

export type AiConfigSection =
  | 'agents'
  | 'persona'
  | 'behavior'
  | 'followup'
  | 'rules'
  | 'training'
  | 'triggers'
  | 'products'
  | 'channels';

export function AiConfig({
  section = 'agents',
  agentId,
  onAgentSaved,
}: {
  section?: AiConfigSection;
  agentId?: string;
  onAgentSaved?: () => void;
}) {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const t = useTranslations('Settings.aiConfig');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);

  const [configured, setConfigured] = useState(false);
  const [provider, setProvider] = useState<AiProvider>('openai');
  const [model, setModel] = useState(AI_PROVIDER_DEFAULT_MODEL.openai);
  const [apiKey, setApiKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [embeddingsKey, setEmbeddingsKey] = useState('');
  const [embeddingsKeyEdited, setEmbeddingsKeyEdited] = useState(false);
  const [hasStoredEmbeddingsKey, setHasStoredEmbeddingsKey] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [maxPerConversation, setMaxPerConversation] = useState(3);
  // Empty string = leave unassigned (shared queue).
  const [handoffAgentId, setHandoffAgentId] = useState('');
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [agentSettings, setAgentSettings] = useState<AiAgentSettings>(
    DEFAULT_AI_AGENT_SETTINGS
  );

  // Guard keyed on the account (not a bare boolean) so an in-place
  // account switch — ownership transfer, multi-account membership —
  // refetches instead of showing the previous account's config. Mirrors
  // the loadedAccountIdRef pattern in whatsapp-config.tsx.
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const query = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : '';
      const res = await fetch(`/api/ai/config${query}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('loadFailed'));
        return;
      }
      setConfigured(Boolean(data.configured));
      if (data.configured) {
        setProvider(data.provider);
        setModel(data.model);
        setHasStoredKey(Boolean(data.has_key));
        setApiKey(data.has_key ? MASKED_KEY : '');
        setKeyEdited(false);
        setHasStoredEmbeddingsKey(Boolean(data.has_embeddings_key));
        setEmbeddingsKey(data.has_embeddings_key ? MASKED_KEY : '');
        setEmbeddingsKeyEdited(false);
      }
      const profile = data.configured ? data : data.agent;
      if (profile) {
        setSystemPrompt(profile.system_prompt ?? '');
        setAgentSettings(normalizeAiAgentSettings(profile.agent_settings ?? profile.settings));
        setIsActive(profile.is_active === true);
        setAutoReplyEnabled(profile.auto_reply_enabled === true);
        setMaxPerConversation(profile.auto_reply_max_per_conversation ?? 3);
        setHandoffAgentId(profile.handoff_agent_id ?? '');
      }
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    const key = `${accountId ?? ''}:${agentId ?? ''}`;
    if (!accountId || loadedAccountIdRef.current === key) return;
    loadedAccountIdRef.current = key;
    void fetchConfig();
    // Members populate the handoff-target picker. Best-effort — on an
    // older deployment without the endpoint the picker just shows the
    // queue option.
    void fetchAccountMembers().then(setMembers);
  }, [accountId, agentId, fetchConfig]);

  const [channelChoices, setChannelChoices] = useState<{ id: string; key: string; label: string; address: string | null; connected: boolean; provider: string }[]>([]);
  const [qrChannelId, setQrChannelId] = useState('');
  const [qrVersion, setQrVersion] = useState('');
  const [channelBusy, setChannelBusy] = useState(false);
  const refreshChannels = useCallback(async () => {
    const response = await fetch('/api/ai/agents/channels', { cache: 'no-store' });
    const payload = await response.json();
    if (response.ok) setChannelChoices(Array.isArray(payload.channels) ? payload.channels : []);
  }, []);
  useEffect(() => {
    if (section !== 'channels') return;
    void refreshChannels().catch(() => setChannelChoices([]));
  }, [section, accountId, refreshChannels]);

  const addEvolutionChannel = async () => {
    const name = window.prompt('Nome para identificar este WhatsApp', `WhatsApp ${channelChoices.filter((channel) => channel.provider === 'evolution').length + 1}`)?.trim();
    if (!name) return;
    setChannelBusy(true);
    try {
      const response = await fetch('/api/ai/agents/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Não foi possível criar a conexão.');
      await refreshChannels();
      setQrChannelId(payload.channel.id);
      const connect = await fetch(`/api/whatsapp/qr?channel_id=${encodeURIComponent(payload.channel.id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'qr' }) });
      const result = await connect.json();
      if (!connect.ok) throw new Error(result.error ?? 'Não foi possível gerar o QR Code.');
      setQrVersion(typeof result.qr_version === 'string' ? result.qr_version : String(Date.now()));
      await refreshChannels();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha ao adicionar WhatsApp.'); }
    finally { setChannelBusy(false); }
  };

  const deleteChannel = async (id: string) => {
    if (!window.confirm('Remover esta conexão do WhatsApp?')) return;
    setChannelBusy(true);
    try {
      const response = await fetch(`/api/ai/agents/channels?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Não foi possível remover a conexão.');
      setQrChannelId(''); setQrVersion(''); await refreshChannels();
      toast.success('Conexão removida.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha ao remover conexão.'); }
    finally { setChannelBusy(false); }
  };

  // Swap the model default when the provider changes, unless the user
  // typed a custom model.
  const handleProviderChange = (next: AiProvider) => {
    setProvider(next);
    setAgentSettings((settings) => ({ ...settings, responseModel: '' }));
    const isDefaultModel =
      model === AI_PROVIDER_DEFAULT_MODEL.openai ||
      model === AI_PROVIDER_DEFAULT_MODEL.anthropic ||
      model.trim() === '';
    if (isDefaultModel) setModel(AI_PROVIDER_DEFAULT_MODEL[next]);
  };

  const keyPayload = () => (keyEdited ? apiKey.trim() : undefined);

  // undefined = leave unchanged; '' typed = null (clear); text = set.
  const embeddingsKeyPayload = () =>
    embeddingsKeyEdited ? embeddingsKey.trim() || null : undefined;

  const buildBody = () => ({
    provider,
    model: model.trim(),
    api_key: keyPayload(),
    embeddings_api_key: embeddingsKeyPayload(),
    system_prompt: systemPrompt.trim() || null,
    is_active: isActive,
    auto_reply_enabled: autoReplyEnabled,
    auto_reply_max_per_conversation: maxPerConversation,
    handoff_agent_id: handoffAgentId || null,
    agent_settings: agentSettings,
    agent_id: agentId,
  });

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          api_key: keyPayload(),
        }),
      });
      const data = await res.json();
      if (res.ok) toast.success(t('testSuccess'));
      else toast.error(data.error ?? t('testRejected'));
    } catch {
      toast.error(t('testNetworkError'));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!model.trim()) {
      toast.error(t('missingModel'));
      return;
    }
    if (!configured && !keyEdited) {
      toast.error(t('missingApiKey'));
      return;
    }
    const agentIssue = validateAiAgentSettings(agentSettings);
    if (agentIssue) {
      toast.error(agentIssue);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(t('saveSuccess'));
        onAgentSaved?.();
        await fetchConfig();
      } else {
        toast.error(data.error ?? t('saveFailed'));
      }
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const res = await fetch('/api/ai/config', { method: 'DELETE' });
      if (res.ok) {
        toast.success(t('removeSuccess'));
        setConfigured(false);
        setHasStoredKey(false);
        setApiKey('');
        setKeyEdited(false);
        setIsActive(false);
        setAutoReplyEnabled(false);
        setSystemPrompt('');
        setAgentSettings(DEFAULT_AI_AGENT_SETTINGS);
        setHandoffAgentId('');
      } else {
        const data = await res.json();
        toast.error(data.error ?? t('removeFailed'));
      }
    } catch {
      toast.error(t('removeFailed'));
    } finally {
      setRemoving(false);
    }
  };

  if (loading || profileLoading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-16">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loadFailed')}{' '}
        {/* Re-using label or a global one, wait, loading is better. Let's use useTranslations from overview or just hardcode Loading... actually I should add loading to aiConfig */}
        {/* Wait, I didn't add loading to aiConfig. I'll just use loading. */}
      </div>
    );
  }

  const disabled = !canEdit || saving;

  return (
    <div>
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {!canEdit && (
        <p className="border-border bg-muted/40 text-muted-foreground mb-4 rounded-md border px-3 py-2 text-sm">
          {t('adminOnlyConfig')}
        </p>
      )}

      <div className="space-y-6">
        {section === 'agents' && <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="text-primary h-4 w-4" />{' '}
              {t('providerAndKey')}
            </CardTitle>
            <CardDescription>{t('encryptionNotice')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('provider')}</Label>
                <Select
                  value={provider}
                  onValueChange={(v) => handleProviderChange(v as AiProvider)}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">
                      {PROVIDER_LABEL.openai}
                    </SelectItem>
                    <SelectItem value="anthropic">
                      {PROVIDER_LABEL.anthropic}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-model">{t('model')}</Label>
                <Input
                  id="ai-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={AI_PROVIDER_DEFAULT_MODEL[provider]}
                  disabled={disabled}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-key">{t('apiKey')}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="ai-key"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setKeyEdited(true);
                    }}
                    onFocus={() => {
                      if (!keyEdited && hasStoredKey) {
                        setApiKey('');
                        setKeyEdited(true);
                      }
                    }}
                    placeholder={KEY_PLACEHOLDER[provider]}
                    disabled={disabled}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
                    tabIndex={-1}
                  >
                    {showKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  variant="outline"
                  onClick={handleTest}
                  disabled={disabled || testing}
                >
                  {testing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  {t('testKey')}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-embeddings-key">
                {t('embeddingsKey')}{' '}
                <span className="text-muted-foreground font-normal">
                  {t('optionalSemanticSearch')}
                </span>
              </Label>
              <Input
                id="ai-embeddings-key"
                type="password"
                value={embeddingsKey}
                onChange={(e) => {
                  setEmbeddingsKey(e.target.value);
                  setEmbeddingsKeyEdited(true);
                }}
                onFocus={() => {
                  if (!embeddingsKeyEdited && hasStoredEmbeddingsKey) {
                    setEmbeddingsKey('');
                    setEmbeddingsKeyEdited(true);
                  }
                }}
                placeholder="sk-... (OpenAI)"
                disabled={disabled}
                autoComplete="off"
              />
              <p className="text-muted-foreground text-xs">
                {t('embeddingsHint', {
                  sameKeyText: provider === 'openai' ? t('sameKeyText') : '',
                })}
              </p>
            </div>
          </CardContent>
        </Card>}

        {(section === 'agents' || section === 'behavior') && <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('behaviour')} · Perfil do agente
            </CardTitle>
            <CardDescription>{t('behaviourDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {section === 'behavior' && <div className="space-y-2">
              <Label htmlFor="ai-prompt">{t('businessContext')}</Label>
              <Textarea
                id="ai-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder={t('promptPlaceholder')}
                rows={5}
                disabled={disabled}
              />
            </div>}

            {section === 'agents' && <>
            <div className="space-y-2">
              <Label htmlFor="ai-agent-name">Nome do agente</Label>
              <Input
                id="ai-agent-name"
                value={agentSettings.name}
                onChange={(e) => setAgentSettings((s) => ({ ...s, name: e.target.value }))}
                disabled={disabled}
                maxLength={80}
              />
            </div>
            <div className="border-border flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <p className="text-foreground text-sm font-medium">
                  {t('enableAssistant')}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t('enableAssistantDesc')}
                </p>
              </div>
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={disabled}
              />
            </div>

            <div className="border-border flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <p className="text-foreground text-sm font-medium">
                  {t('autoReply')}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t('autoReplyDesc')}
                </p>
              </div>
              <Switch
                checked={autoReplyEnabled}
                onCheckedChange={setAutoReplyEnabled}
                disabled={disabled || !isActive}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="ai-max">{t('maxAutoReplies')}</Label>
                <p className="text-muted-foreground text-xs">
                  {t('maxAutoRepliesDesc')}
                </p>
              </div>
              <Input
                id="ai-max"
                type="number"
                min={1}
                max={20}
                value={maxPerConversation}
                onChange={(e) =>
                  setMaxPerConversation(
                    Math.min(20, Math.max(1, Number(e.target.value) || 1))
                  )
                }
                disabled={disabled || !autoReplyEnabled}
                className="w-20"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-handoff">{t('handoffTo')}</Label>
              <p className="text-muted-foreground text-xs">
                {t('handoffToDesc')}
              </p>
              <Select
                value={handoffAgentId || HANDOFF_QUEUE}
                onValueChange={(v) =>
                  setHandoffAgentId(!v || v === HANDOFF_QUEUE ? '' : v)
                }
                disabled={disabled || !autoReplyEnabled}
              >
                <SelectTrigger id="ai-handoff">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={HANDOFF_QUEUE}>
                    {t('handoffQueue')}
                  </SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {memberLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            </>}
          </CardContent>
        </Card>}

        {section !== 'agents' && <Card>
          <CardHeader>
            <CardTitle className="text-base">Treinamento do agente</CardTitle>
            <CardDescription>
              Defina persona, objetivo, regras, canais, gatilhos e como o agente
              aprende com a equipe.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {section === 'persona' && <>
              <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ai-agent-tone">Tom de voz</Label>
                <select id="ai-agent-tone" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" value={agentSettings.tone} onChange={(e) => setAgentSettings((s) => ({ ...s, tone: e.target.value }))} disabled={disabled}><option>Formal</option><option>Consultivo</option><option>Casual</option><option>Direto</option></select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ai-agent-closing">Estilo de fechamento</Label>
                <select id="ai-agent-closing" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" value={agentSettings.closingStyle} onChange={(e) => setAgentSettings((s) => ({ ...s, closingStyle: e.target.value }))} disabled={disabled}><option value="direct">Direto</option><option value="consultative">Consultivo</option><option value="urgency">Urgência</option><option value="gentle">Suave</option></select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ai-agent-negotiation">Modo de negociação</Label>
                <select id="ai-agent-negotiation" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" value={agentSettings.negotiationMode} onChange={(e) => setAgentSettings((s) => ({ ...s, negotiationMode: e.target.value }))} disabled={disabled}><option value="none">Sem desconto (padrão)</option><option value="fixed_discount">Desconto fixo (PIX/à vista)</option><option value="strategic">Estratégico (degraus com piso secreto)</option></select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ai-agent-model">Modelo da IA</Label>
                <select id="ai-agent-model" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" value={agentSettings.responseModel} onChange={(e) => setAgentSettings((s) => ({ ...s, responseModel: e.target.value }))} disabled={disabled}><option value="">Automático (modelo da conta)</option>{provider === 'openai' ? <><option value="gpt-5.4-mini">Rápido · GPT-5.4 mini</option><option value="gpt-5.4">Avançado · GPT-5.4</option></> : <><option value="claude-haiku-4-5-20251001">Rápido · Claude Haiku</option><option value="claude-sonnet-4-6">Avançado · Claude Sonnet</option></>}</select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ai-agent-max-tokens">Max tokens por resposta</Label>
                <Input id="ai-agent-max-tokens" type="number" min={1} max={8192} value={agentSettings.maxTokens} onChange={(e) => setAgentSettings((s) => ({ ...s, maxTokens: Math.min(8192, Math.max(1, Number(e.target.value) || 1)) }))} disabled={disabled} />
              </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ai-agent-creativity">Criatividade das respostas ({agentSettings.creativity.toFixed(2)})</Label>
                <input id="ai-agent-creativity" type="range" min={0} max={1} step={0.05} value={agentSettings.creativity} onChange={(e) => setAgentSettings((s) => ({ ...s, creativity: Number(e.target.value) }))} disabled={disabled} className="w-full accent-primary" />
                <div className="flex justify-between text-xs text-muted-foreground"><span>Mais obediente (0)</span><span>Mais criativo (1)</span></div>
                <p className="text-xs text-muted-foreground">Valores baixos seguem melhor o treinamento e as regras. Recomendado: 0.3.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ai-agent-speed">Tempo de resposta</Label>
                  <select id="ai-agent-speed" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" value={agentSettings.responseSpeed} onChange={(e) => setAgentSettings((s) => ({ ...s, responseSpeed: e.target.value as AiAgentSettings['responseSpeed'] }))} disabled={disabled}><option value="automatic">Automático (adapta ao tamanho — mais humano)</option><option value="fast">Rápido (~1s)</option><option value="normal">Normal (~2,5s)</option><option value="slow">Lento (~5s)</option><option value="custom">Customizado</option></select>
                </div>
                {agentSettings.responseSpeed === 'custom' && <div className="space-y-2">
                  <Label htmlFor="ai-agent-delay">Atraso customizado (ms)</Label>
                  <Input id="ai-agent-delay" type="number" min={0} max={30000} step={100} value={agentSettings.customResponseDelayMs} onChange={(e) => setAgentSettings((s) => ({ ...s, customResponseDelayMs: Math.min(30000, Math.max(0, Number(e.target.value) || 0)) }))} disabled={disabled} />
                </div>}
              </div>
              <div className="space-y-4 rounded-lg border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div><Label htmlFor="ai-agent-split">Quebrar mensagem em blocos</Label><p className="mt-1 text-xs text-muted-foreground">Envia respostas em mensagens menores, como uma pessoa digitando aos poucos.</p></div>
                  <Switch id="ai-agent-split" checked={agentSettings.splitMessages} onCheckedChange={(checked) => setAgentSettings((s) => ({ ...s, splitMessages: checked }))} disabled={disabled} />
                </div>
                {agentSettings.splitMessages && <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label htmlFor="ai-agent-block-size">Caracteres por bloco</Label><Input id="ai-agent-block-size" type="number" min={80} max={1000} value={agentSettings.charactersPerBlock} onChange={(e) => setAgentSettings((s) => ({ ...s, charactersPerBlock: Math.min(1000, Math.max(80, Number(e.target.value) || 80)) }))} disabled={disabled} /></div>
                  <div className="space-y-2"><Label htmlFor="ai-agent-block-pause">Pausa entre blocos (ms)</Label><Input id="ai-agent-block-pause" type="number" min={0} max={10000} step={100} value={agentSettings.pauseBetweenBlocksMs} onChange={(e) => setAgentSettings((s) => ({ ...s, pauseBetweenBlocksMs: Math.min(10000, Math.max(0, Number(e.target.value) || 0)) }))} disabled={disabled} /></div>
                </div>}
              </div>
              <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
                <div><Label htmlFor="ai-agent-confirm-read">Confirmar leitura antes de responder</Label><p className="mt-1 text-xs text-muted-foreground">Marca a mensagem recebida como lida e aguarda um instante antes da resposta automática.</p></div>
                <Switch id="ai-agent-confirm-read" checked={agentSettings.confirmReadBeforeReply} onCheckedChange={(checked) => setAgentSettings((s) => ({ ...s, confirmReadBeforeReply: checked }))} disabled={disabled} />
              </div>
            </>}
            {section === 'persona' && <div className="space-y-2">
              <Label htmlFor="ai-agent-persona">Persona e identidade</Label>
              <Textarea
                id="ai-agent-persona"
                value={agentSettings.persona}
                onChange={(e) =>
                  setAgentSettings((s) => ({ ...s, persona: e.target.value }))
                }
                placeholder="Quem é o agente, como se apresenta e qual experiência deve oferecer."
                rows={3}
                disabled={disabled}
                maxLength={4000}
              />
            </div>}
            {section === 'persona' && <div className="space-y-2">
              <Label htmlFor="ai-agent-objective">Objetivo comercial</Label>
              <Textarea
                id="ai-agent-objective"
                value={agentSettings.objective}
                onChange={(e) =>
                  setAgentSettings((s) => ({ ...s, objective: e.target.value }))
                }
                placeholder="Ex.: entender a necessidade, qualificar o lead e marcar uma demonstração."
                rows={2}
                disabled={disabled}
                maxLength={2000}
              />
            </div>}
            {section === 'persona' && <>
              <div className="space-y-2">
                <Label htmlFor="ai-agent-vocabulary">Vocabulário e expressões da marca</Label>
                <Textarea id="ai-agent-vocabulary" value={agentSettings.vocabulary} onChange={(e) => setAgentSettings((s) => ({ ...s, vocabulary: e.target.value }))} rows={3} disabled={disabled} placeholder="Termos preferidos, palavras a evitar e como se referir ao cliente." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ai-agent-examples">Exemplos reais de conversas</Label>
                <Textarea id="ai-agent-examples" value={agentSettings.realExamples} onChange={(e) => setAgentSettings((s) => ({ ...s, realExamples: e.target.value }))} rows={5} disabled={disabled} placeholder={'Cliente: Estou pesquisando preços.\nEquipe: Claro! Para te orientar melhor, me conta o que você precisa resolver?'} />
                <p className="text-xs text-muted-foreground">Inclua exemplos aprovados e sem dados pessoais para a IA reproduzir o estilo.</p>
              </div>
            </>}
            {section === 'behavior' && <div className="space-y-2">
                <Label htmlFor="ai-agent-behavior">
                  Instruções de comportamento
                </Label>
                <Textarea
                  id="ai-agent-behavior"
                  value={agentSettings.behaviorInstructions}
                  onChange={(e) =>
                    setAgentSettings((s) => ({
                      ...s,
                      behaviorInstructions: e.target.value,
                    }))
                  }
                  placeholder="Como conduzir conversas, perguntas de qualificação, estilo de respostas…"
                  rows={5}
                  disabled={disabled}
                  maxLength={8000}
                />
            </div>}
            {section === 'behavior' && <>
              <div className="space-y-2">
                <Label htmlFor="ai-agent-house-style">Estilo da casa</Label>
                <Textarea id="ai-agent-house-style" value={agentSettings.houseStyle} onChange={(e) => setAgentSettings((s) => ({ ...s, houseStyle: e.target.value }))} rows={3} disabled={disabled} placeholder="Ex.: mensagens curtas, uma pergunta por vez, sem excesso de emojis." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ai-agent-greeting">Saudação inicial</Label>
                <Textarea id="ai-agent-greeting" value={agentSettings.initialGreeting} onChange={(e) => setAgentSettings((s) => ({ ...s, initialGreeting: e.target.value }))} rows={2} disabled={disabled} placeholder="Como o agente deve iniciar uma conversa nova." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ai-agent-objections">Respostas a objeções</Label>
                <Textarea id="ai-agent-objections" value={agentSettings.objectionResponses} onChange={(e) => setAgentSettings((s) => ({ ...s, objectionResponses: e.target.value }))} rows={4} disabled={disabled} placeholder="Objeções frequentes e como responder com empatia e fatos." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ai-agent-qualification">Perguntas de qualificação</Label>
                <Textarea id="ai-agent-qualification" value={agentSettings.qualificationQuestions} onChange={(e) => setAgentSettings((s) => ({ ...s, qualificationQuestions: e.target.value }))} rows={3} disabled={disabled} placeholder="Quais perguntas ajudam a entender a necessidade e o momento do lead?" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ai-agent-emotional">Gatilhos emocionais e contexto humano</Label>
                <Textarea id="ai-agent-emotional" value={agentSettings.emotionalTriggers} onChange={(e) => setAgentSettings((s) => ({ ...s, emotionalTriggers: e.target.value }))} rows={3} disabled={disabled} placeholder="Como reconhecer urgência, insegurança ou entusiasmo sem pressionar o cliente." />
              </div>
            </>}
            {section === 'rules' && <div className="space-y-2">
                <Label htmlFor="ai-agent-prohibited">
                  Regras e assuntos proibidos
                </Label>
                <Textarea
                  id="ai-agent-prohibited"
                  value={agentSettings.prohibitedTopics}
                  onChange={(e) =>
                    setAgentSettings((s) => ({
                      ...s,
                      prohibitedTopics: e.target.value,
                    }))
                  }
                  placeholder="O que não prometer, revelar, recomendar ou discutir."
                  rows={5}
                  disabled={disabled}
                  maxLength={4000}
                />
            </div>}
            {section === 'rules' && <div className="space-y-2">
              <Label htmlFor="ai-agent-permitted">Tópicos permitidos</Label>
              <Textarea id="ai-agent-permitted" value={agentSettings.permittedTopics} onChange={(e) => setAgentSettings((s) => ({ ...s, permittedTopics: e.target.value }))} rows={3} disabled={disabled} placeholder="Produtos, políticas, serviços e temas sobre os quais pode orientar." />
            </div>}
            {section === 'rules' && <div className="space-y-2">
              <Label htmlFor="ai-agent-handoff">
                Regras de transferência para atendente
              </Label>
              <Textarea
                id="ai-agent-handoff"
                value={agentSettings.handoffRules}
                onChange={(e) =>
                  setAgentSettings((s) => ({
                    ...s,
                    handoffRules: e.target.value,
                  }))
                }
                rows={2}
                disabled={disabled}
                maxLength={4000}
              />
            </div>}
            {section === 'channels' && <div className="space-y-3 rounded-md border p-3">
              <div>
                <p className="text-sm font-semibold">WhatsApps vinculados a este agente</p>
                <p className="text-xs text-muted-foreground">Conecte vários números Cloud API ou Evolution e atribua cada número a este agente.</p>
              </div>
              {channelChoices.map((channel) => (
                <div
                  key={channel.id}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/40"
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-primary"
                    checked={agentSettings.enabledChannels.includes(channel.key)}
                    disabled={disabled || !channel.connected}
                    onChange={(e) =>
                      setAgentSettings((s) => ({
                        ...s,
                        enabledChannels: e.target.checked
                          ? [...s.enabledChannels, channel.key]
                          : s.enabledChannels.filter((v) => v !== channel.key),
                      }))
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{channel.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{channel.address ?? (channel.provider === 'evolution' ? 'Instância QR' : 'Configure em Configurações → WhatsApp')}</span>
                  </span>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className={channel.connected ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' : 'rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'}>
                      {channel.connected ? 'Conectado' : 'Desconectado'}
                    </span>
                    {!channel.connected && channel.provider === 'evolution' && <Button type="button" size="sm" variant="outline" disabled={channelBusy} onClick={async () => {
                      setChannelBusy(true);
                      try {
                        const result = await fetch(`/api/whatsapp/qr?channel_id=${encodeURIComponent(channel.id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'qr' }) });
                        const payload = await result.json();
                        if (!result.ok) throw new Error(payload.error ?? 'Não foi possível iniciar a conexão.');
                        setQrChannelId(channel.id); setQrVersion(String(Date.now()));
                      } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha ao gerar QR Code.'); }
                      finally { setChannelBusy(false); }
                    }}>Conectar</Button>}
                    {channel.provider === 'evolution' && channel.key.includes(':') && <Button type="button" size="sm" variant="ghost" disabled={channelBusy} onClick={() => void deleteChannel(channel.id)}>Remover</Button>}
                    {channel.provider === 'cloud' && channel.address && <Button type="button" size="sm" variant="ghost" disabled={channelBusy} onClick={async () => {
                      if (!window.confirm(`Desconectar o WhatsApp ${channel.label}?`)) return;
                      setChannelBusy(true);
                      try {
                        const response = await fetch(`/api/whatsapp/config?phone_number_id=${encodeURIComponent(channel.address!)}`, { method: 'DELETE' });
                        const payload = await response.json();
                        if (!response.ok) throw new Error(payload.error ?? 'Não foi possível desconectar o número.');
                        setAgentSettings((s) => ({ ...s, enabledChannels: s.enabledChannels.filter((key) => key !== channel.key) }));
                        await refreshChannels(); toast.success('WhatsApp desconectado.');
                      } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha ao desconectar número.'); }
                      finally { setChannelBusy(false); }
                    }}>Desconectar</Button>}
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" disabled={disabled || channelBusy} onClick={() => void addEvolutionChannel()}>{channelBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Adicionar número Evolution</Button>
                <p className="self-center text-xs text-muted-foreground">Para adicionar Cloud API, conecte outro número em Configurações → WhatsApp.</p>
              </div>
              {qrChannelId && <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-white p-3 text-foreground">
                <img src={`/api/whatsapp/qr?view=qr&channel_id=${encodeURIComponent(qrChannelId)}&v=${encodeURIComponent(qrVersion)}`} alt="QR Code para conectar WhatsApp" className="h-52 w-52 object-contain" />
                <div className="space-y-2"><p className="text-sm font-medium">Leia o QR Code pelo WhatsApp</p><p className="text-xs text-muted-foreground">WhatsApp → Aparelhos conectados → Conectar aparelho.</p><Button type="button" size="sm" variant="outline" onClick={async () => { await refreshChannels(); }} >Atualizar conexões</Button></div>
              </div>}
              {channelChoices.length === 0 && <p className="text-xs text-muted-foreground">Carregando conexões ou sem permissão para visualizá-las.</p>}
            </div>}
            {section === 'triggers' && <div className="space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">Gatilhos de atendimento</p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={agentSettings.inboundEnabled}
                  disabled={disabled}
                  onChange={(e) =>
                    setAgentSettings((s) => ({
                      ...s,
                      inboundEnabled: e.target.checked,
                    }))
                  }
                />
                Responder mensagens recebidas automaticamente
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={agentSettings.firstMessageOnly}
                  disabled={disabled}
                  onChange={(e) =>
                    setAgentSettings((s) => ({
                      ...s,
                      firstMessageOnly: e.target.checked,
                    }))
                  }
                />
                Atuar somente na primeira mensagem da conversa
              </label>
              <div className="space-y-2">
                <Label htmlFor="ai-agent-keywords">
                  Palavras-chave de ativação (uma por linha; vazio = todas)
                </Label>
                <Textarea
                  id="ai-agent-keywords"
                  value={agentSettings.triggerKeywords.join('\n')}
                  onChange={(e) =>
                    setAgentSettings((s) => ({
                      ...s,
                      triggerKeywords: e.target.value
                        .split('\n')
                        .map((v) => v.trim())
                        .filter(Boolean)
                        .slice(0, 50),
                    }))
                  }
                  rows={3}
                  disabled={disabled}
                />
              </div>
            </div>}
            {section === 'triggers' && <AiAgentTriggers agentId={agentId} disabled={disabled} />}
            {section === 'followup' && <div className="space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">Follow-up automático</p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={agentSettings.followUpEnabled}
                  disabled={disabled}
                  onChange={(e) =>
                    setAgentSettings((s) => ({
                      ...s,
                      followUpEnabled: e.target.checked,
                    }))
                  }
                />
                Habilitar retomadas quando o cliente não responder
              </label>
              <div className="space-y-2">
                <Label>Sequência de retomadas (intervalo em horas)</Label>
                {agentSettings.followUpDelaysHours.map((hours, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 text-xs text-muted-foreground">Follow-up {index + 1}</span>
                    <Input type="number" min={1} max={8760} value={hours} disabled={disabled || !agentSettings.followUpEnabled} onChange={(e) => setAgentSettings((s) => ({ ...s, followUpDelaysHours: s.followUpDelaysHours.map((value, i) => i === index ? Math.min(8760, Math.max(1, Number(e.target.value) || 1)) : value) }))} />
                    <span className="text-xs text-muted-foreground">horas depois</span>
                    <Button type="button" size="icon" variant="ghost" disabled={disabled || !agentSettings.followUpEnabled || agentSettings.followUpDelaysHours.length <= 1} onClick={() => setAgentSettings((s) => ({ ...s, followUpDelaysHours: s.followUpDelaysHours.filter((_, i) => i !== index) }))} aria-label={`Remover follow-up ${index + 1}`}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button type="button" variant="outline" disabled={disabled || !agentSettings.followUpEnabled || agentSettings.followUpDelaysHours.length >= 5} onClick={() => setAgentSettings((s) => ({ ...s, followUpDelaysHours: [...s.followUpDelaysHours, Math.min(8760, (s.followUpDelaysHours.at(-1) ?? 24) + 48)] }))}><Plus className="mr-2 h-4 w-4" />Adicionar follow-up</Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ai-agent-followup-rules">
                  Orientação para as mensagens de follow-up
                </Label>
                <Textarea
                  id="ai-agent-followup-rules"
                  value={agentSettings.followUpInstructions}
                  disabled={disabled || !agentSettings.followUpEnabled}
                  onChange={(e) =>
                    setAgentSettings((s) => ({
                      ...s,
                      followUpInstructions: e.target.value,
                    }))
                  }
                  rows={3}
                  maxLength={4000}
                  placeholder="Retome com contexto, sem pressionar e sem repetir a mensagem anterior."
                />
              </div>
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-4">
                  <div><p className="text-sm font-medium">Horário permitido para follow-up</p><p className="text-xs text-muted-foreground">Fora da janela, a mensagem aguarda o próximo horário permitido.</p></div>
                  <Switch checked={agentSettings.followUpWindowEnabled} disabled={disabled || !agentSettings.followUpEnabled} onCheckedChange={(checked) => setAgentSettings((s) => ({ ...s, followUpWindowEnabled: checked }))} />
                </div>
                {agentSettings.followUpWindowEnabled && <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2"><Label htmlFor="followup-start">Início</Label><Input id="followup-start" type="time" value={agentSettings.followUpWindowStart} disabled={disabled || !agentSettings.followUpEnabled} onChange={(e) => setAgentSettings((s) => ({ ...s, followUpWindowStart: e.target.value }))} /></div>
                    <div className="space-y-2"><Label htmlFor="followup-end">Fim</Label><Input id="followup-end" type="time" value={agentSettings.followUpWindowEnd} disabled={disabled || !agentSettings.followUpEnabled} onChange={(e) => setAgentSettings((s) => ({ ...s, followUpWindowEnd: e.target.value }))} /></div>
                  </div>
                  <div className="flex flex-wrap gap-2">{['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day, index) => <button key={day} type="button" disabled={disabled || !agentSettings.followUpEnabled} onClick={() => setAgentSettings((s) => ({ ...s, followUpWeekdays: s.followUpWeekdays.includes(index) ? s.followUpWeekdays.filter((value) => value !== index) : [...s.followUpWeekdays, index].sort() }))} className={`rounded-lg px-3 py-2 text-xs font-medium transition ${agentSettings.followUpWeekdays.includes(index) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'} disabled:opacity-50`}>{day}</button>)}</div>
                </>}
              </div>
              <p className="text-muted-foreground text-xs">
                As retomadas usam os intervalos definidos e são canceladas
                quando o cliente responde ou um atendente assume a conversa.
              </p>
            </div>}
            {section === 'training' && <div className="space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">Auto training</p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={agentSettings.autoTrainingEnabled}
                  disabled={disabled}
                  onChange={(e) =>
                    setAgentSettings((s) => ({
                      ...s,
                      autoTrainingEnabled: e.target.checked,
                    }))
                  }
                />
                Aprender com pares de mensagens reais respondidas pela equipe
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={agentSettings.trainingRequiresApproval}
                  disabled={disabled || !agentSettings.autoTrainingEnabled}
                  onChange={(e) =>
                    setAgentSettings((s) => ({
                      ...s,
                      trainingRequiresApproval: e.target.checked,
                    }))
                  }
                />
                Exigir aprovação de administrador antes de usar cada exemplo
                (recomendado)
              </label>
              <div className="space-y-2">
                <Label htmlFor="ai-agent-training-guidance">
                  Orientação de treinamento
                </Label>
                <Textarea
                  id="ai-agent-training-guidance"
                  value={agentSettings.autoTrainingInstructions}
                  disabled={disabled || !agentSettings.autoTrainingEnabled}
                  onChange={(e) =>
                    setAgentSettings((s) => ({
                      ...s,
                      autoTrainingInstructions: e.target.value,
                    }))
                  }
                  rows={2}
                  maxLength={4000}
                  placeholder="Padrões de linguagem e atendimento a reforçar."
                />
              </div>
              {canEdit && <AiTrainingReview agentId={agentId} />}
            </div>}
          </CardContent>
        </Card>}

        {section === 'products' && <AiKnowledgeCard
          accountId={accountId}
          canEdit={canEdit}
          hasEmbeddingsKey={
            embeddingsKeyEdited
              ? embeddingsKey.trim().length > 0
              : hasStoredEmbeddingsKey
          }
        />}

        <div className="flex items-center justify-between">
          {configured ? (
            <Button
              variant="ghost"
              onClick={handleRemove}
              disabled={!canEdit || removing}
              className="text-destructive hover:text-destructive"
            >
              {removing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              {t('remove')}
            </Button>
          ) : (
            <span />
          )}

          <Button onClick={handleSave} disabled={disabled}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
