'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  CircleAlert,
  Link2,
  Loader2,
  MousePointerClick,
  Plug,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';

import { RequireRole } from '@/components/auth/require-role';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Provider = 'meta' | 'google_ads';

interface Integration {
  id: string;
  provider: Provider;
  external_account_id: string;
  manager_account_id: string | null;
  display_name: string | null;
  connection_status: 'not_connected' | 'connected' | 'error';
  is_active: boolean;
  last_sync_at: string | null;
  last_error: string | null;
}

interface AttributionOverview {
  integrations: Integration[];
  summary: {
    activeLinks: number;
    trackedClicks: number;
    attributedConversations: number;
    lastInsightDate: string | null;
  };
  providerReadiness: { meta: boolean; googleAds: boolean };
}

const providerCopy: Record<Provider, { label: string; accountLabel: string }> = {
  meta: { label: 'Meta Ads', accountLabel: 'ID da conta de anúncios' },
  google_ads: { label: 'Google Ads', accountLabel: 'ID do cliente' },
};

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: typeof MousePointerClick;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs">{label}</p>
          <p className="text-foreground text-xl font-semibold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function AdvertisingAttributionHub() {
  const [overview, setOverview] = useState<AttributionOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState<Provider>('meta');
  const [externalAccountId, setExternalAccountId] = useState('');
  const [managerAccountId, setManagerAccountId] = useState('');
  const [displayName, setDisplayName] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/account/advertising-integrations', {
        cache: 'no-store',
      });
      const payload = (await response.json().catch(() => ({}))) as AttributionOverview & {
        error?: string;
      };
      if (!response.ok) {
        toast.error(payload.error ?? 'Não foi possível carregar o painel.');
        return;
      }
      setOverview(payload);
    } catch (error) {
      console.error('[AdvertisingAttributionHub] load error:', error);
      toast.error('Não foi possível carregar o painel.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addIntegration() {
    setSaving(true);
    try {
      const response = await fetch('/api/account/advertising-integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          externalAccountId,
          managerAccountId,
          displayName,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        toast.error(payload.error ?? 'Não foi possível preparar a conexão.');
        return;
      }
      setExternalAccountId('');
      setManagerAccountId('');
      setDisplayName('');
      toast.success('Conta preparada. Falta apenas conectar as credenciais no servidor.');
      await load();
    } catch (error) {
      console.error('[AdvertisingAttributionHub] save error:', error);
      toast.error('Não foi possível preparar a conexão.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleIntegration(integration: Integration) {
    try {
      const response = await fetch(
        `/api/account/advertising-integrations/${integration.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: !integration.is_active }),
        }
      );
      if (!response.ok) throw new Error('update failed');
      toast.success(integration.is_active ? 'Integração pausada.' : 'Integração ativada.');
      await load();
    } catch (error) {
      console.error('[AdvertisingAttributionHub] toggle error:', error);
      toast.error('Não foi possível atualizar a integração.');
    }
  }

  const configured = overview
    ? overview.integrations.filter((integration) => integration.is_active).length
    : 0;

  return (
    <section className="space-y-5">
      <div className="rounded-xl border border-primary/15 bg-primary/5 p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-primary flex items-center gap-2 text-sm font-semibold">
              <BarChart3 className="size-4" />
              Atribuição e desempenho de anúncios
            </div>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-6">
              Organize a origem de cada contato, conecte contas de Meta Ads e
              Google Ads por CRM e acompanhe campanhas sem misturar os dados
              entre empresas.
            </p>
          </div>
          <Badge variant="outline" className="w-fit border-primary/20 bg-background">
            <ShieldCheck className="mr-1 size-3.5" />
            Acesso somente leitura
          </Badge>
        </div>
      </div>

      {loading || !overview ? (
        <div className="flex justify-center py-8">
          <Loader2 className="text-primary size-6 animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Links ativos" value={overview.summary.activeLinks} icon={Link2} />
            <Metric label="Cliques rastreados" value={overview.summary.trackedClicks} icon={MousePointerClick} />
            <Metric label="Conversas atribuídas" value={overview.summary.attributedConversations} icon={CheckCircle2} />
            <Metric label="Contas preparadas" value={configured} icon={Plug} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,.9fr)]">
            <Card>
              <CardContent className="space-y-4 p-5">
                <div>
                  <h3 className="text-sm font-semibold">Contas de anúncios</h3>
                  <p className="text-muted-foreground mt-1 text-xs leading-5">
                    Cada conta é vinculada a apenas um CRM. Credenciais nunca
                    aparecem na tela e serão adicionadas somente no servidor.
                  </p>
                </div>

                {overview.integrations.length === 0 ? (
                  <div className="border-border bg-muted/30 rounded-lg border border-dashed p-5 text-center">
                    <Plug className="text-muted-foreground mx-auto size-5" />
                    <p className="mt-2 text-sm font-medium">Nenhuma conta preparada</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      Adicione o identificador da conta para deixar o CRM pronto
                      antes de conectar as permissões da plataforma.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {overview.integrations.map((integration) => {
                      const isReady =
                        integration.provider === 'meta'
                          ? overview.providerReadiness.meta
                          : overview.providerReadiness.googleAds;
                      return (
                        <div key={integration.id} className="border-border flex flex-wrap items-center gap-3 rounded-lg border p-3">
                          <div className="bg-muted flex size-9 items-center justify-center rounded-lg text-xs font-bold">
                            {integration.provider === 'meta' ? 'M' : 'G'}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">
                              {integration.display_name || providerCopy[integration.provider].label}
                            </p>
                            <p className="text-muted-foreground truncate text-xs">
                              {providerCopy[integration.provider].label} · {integration.external_account_id}
                            </p>
                          </div>
                          <Badge variant="outline" className={isReady && integration.is_active ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : ''}>
                            {integration.is_active
                              ? isReady
                                ? 'Pronta para conectar'
                                : 'Aguardando credencial'
                              : 'Pausada'}
                          </Badge>
                          <Button variant="ghost" size="sm" onClick={() => void toggleIntegration(integration)}>
                            {integration.is_active ? 'Pausar' : 'Ativar'}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <RequireRole min="admin">
              <Card>
                <CardContent className="space-y-4 p-5">
                  <div>
                    <h3 className="text-sm font-semibold">Preparar nova conta</h3>
                    <p className="text-muted-foreground mt-1 text-xs leading-5">
                      Salve o ID agora. A sincronização só começa depois de a
                      plataforma e o token correspondente serem conectados.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ads-provider">Plataforma</Label>
                    <select
                      id="ads-provider"
                      value={provider}
                      onChange={(event) => setProvider(event.target.value as Provider)}
                      className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                    >
                      <option value="meta">Meta Ads</option>
                      <option value="google_ads">Google Ads</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ads-account-id">{providerCopy[provider].accountLabel}</Label>
                    <Input
                      id="ads-account-id"
                      value={externalAccountId}
                      onChange={(event) => setExternalAccountId(event.target.value)}
                      placeholder={provider === 'meta' ? '23845963072290549' : '123-456-7890'}
                      inputMode="numeric"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ads-account-name">Nome para identificação</Label>
                    <Input
                      id="ads-account-name"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      placeholder="Ex.: Campanhas imobiliárias"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ads-manager-id">Conta gerenciadora (opcional)</Label>
                    <Input
                      id="ads-manager-id"
                      value={managerAccountId}
                      onChange={(event) => setManagerAccountId(event.target.value)}
                      placeholder={provider === 'meta' ? 'ID do portfólio empresarial' : 'ID do MCC'}
                      inputMode="numeric"
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => void addIntegration()}
                    disabled={saving || !externalAccountId.trim()}
                  >
                    {saving ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
                    Preparar integração
                  </Button>
                </CardContent>
              </Card>
            </RequireRole>
          </div>

          <Card>
            <CardContent className="grid gap-4 p-5 md:grid-cols-3">
              <div className="space-y-1.5">
                <p className="text-sm font-semibold">Dados por contato</p>
                <p className="text-muted-foreground text-xs leading-5">
                  A ficha do contato mostra origem, UTMs, IDs de clique,
                  campanha, conjunto/grupo e anúncio quando estiverem disponíveis.
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-semibold">Meta Ads</p>
                <p className="text-muted-foreground text-xs leading-5">
                  Usa CTWA, UTMs e <code>fbclid</code>; com <code>ads_read</code>,
                  resolve nomes e métricas da campanha.
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-semibold">Google Ads</p>
                <p className="text-muted-foreground text-xs leading-5">
                  Já armazena <code>gclid</code>, UTMs e página de entrada;
                  ficará pronto para enriquecer campanhas após a conexão OAuth/MCC.
                </p>
              </div>
            </CardContent>
          </Card>

          {!overview.summary.lastInsightDate && (
            <div className="text-muted-foreground flex items-start gap-2 rounded-lg border border-dashed p-3 text-xs leading-5">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              Métricas de investimento aparecerão aqui após a primeira
              sincronização. Enquanto isso, o CRM já registra a origem e os
              identificadores de cada nova conversa.
            </div>
          )}
        </>
      )}
    </section>
  );
}
