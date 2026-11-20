'use client';

import { useEffect, useState } from 'react';

type Account = { id: string; name: string; currency: string; status: number };
type Page = { id: string; name: string };
type Status = {
  canManage: boolean; pending: boolean; accounts: Account[]; pages: Page[]; leadsGranted: boolean;
  missingPermissions: string[];
  pipelines: { id: string; name: string }[];
  credentials: { integration_id: string; token_expires_at: string }[];
};
export default function MetaConnectionPanel({ adAccountId, integrationId, days, active, leadPages, leadsGranted, lastLeadsSync, onChanged }: {
  adAccountId: string; integrationId?: string; days: number; active: boolean;
  leadPages: string[]; leadsGranted: boolean; lastLeadsSync: string | null;
  onChanged: (id: string) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [choice, setChoice] = useState('');
  const [selectedPages, setSelectedPages] = useState<string[]>([]);
  const [pipelineChoice, setPipelineChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/meta-ads/connect/status', { cache: 'no-store', signal: controller.signal });
        const body = await response.json() as Status & { error?: string };
        if (!response.ok) throw new Error(body.error || 'Não foi possível verificar a conexão.');
        setStatus(body);
        setChoice(body.accounts[0]?.id || '');
        setPipelineChoice(body.pipelines?.[0]?.id || '');
        const result = new URLSearchParams(window.location.search).get('meta_connection');
        if (result === 'error') setError('A Meta não concluiu a autorização. Tente conectar novamente.');
        if (result === 'cancelled') setMessage('A autorização foi cancelada. Você pode tentar novamente quando quiser.');
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Falha ao verificar conexão.');
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  async function post(action: string, id: string) {
    const response = await fetch('/api/meta-ads/connect/' + action, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adAccountId: id, days, pageIds: selectedPages, pipelineId: pipelineChoice }),
    });
    const body = await response.json() as { error?: string; insightRows?: number; imported?: number; failed?: number };
    if (!response.ok) throw new Error(body.error || 'Não foi possível concluir a operação.');
    return body;
  }
  async function run(action: 'select' | 'sync' | 'sync-leads' | 'disconnect') {
    const id = action === 'select' ? choice : adAccountId;
    if (!id) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await post(action, id);
      if (action === 'select') {
        setStatus(previous => previous ? { ...previous, pending: false } : previous);
        onChanged(id);
        setMessage('Conta conectada. Buscando métricas e formulários...');
        await post('sync', id);
        if (selectedPages.length) await post('sync-leads', id);
      }
      setMessage(action === 'disconnect' ? 'Conta desconectada. O histórico de métricas foi preservado.'
        : action === 'sync-leads' ? `Formulários sincronizados: ${result.imported ?? 0} novos leads, ${result.failed ?? 0} pendentes de revisão.`
          : action === 'select' && selectedPages.length ? 'Conta conectada. Métricas e formulários sincronizados.' : 'Métricas sincronizadas com a Meta.');
      onChanged(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a operação.');
      onChanged(id);
    } finally { setBusy(false); }
  }
  const credential = status?.credentials.find(item => item.integration_id === integrationId);
  const expiry = credential ? new Date(credential.token_expires_at) : null;
  const expired = expiry ? expiry.getTime() <= Date.now() : false;
  const button = 'inline-flex min-h-9 items-center justify-center rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50';
  return (
    <section className="border-border bg-card space-y-3 rounded-xl border p-4" aria-label="Gerenciar conexão Meta Ads">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Conectar contas de anúncios</h2>
          <p className="text-muted-foreground mt-1 text-sm">Autorize a leitura na Meta, escolha a conta e acompanhe as métricas nesta empresa.</p>
        </div>
        {status?.canManage && <a href="/api/meta-ads/connect/begin" className={button} aria-disabled={busy}
          onClick={event => { if (busy) event.preventDefault(); }}>
          {active ? 'Reconectar ou adicionar conta' : 'Conectar conta Meta'}
        </a>}
      </div>
      {!status && !error && <p className="text-muted-foreground text-sm">Verificando conexão...</p>}
      {status && !status.canManage && <p className="text-muted-foreground text-sm">Um administrador pode conectar e sincronizar as contas desta empresa.</p>}
      {status?.canManage && status.pending && (
        <div className="bg-muted/40 space-y-3 rounded-lg p-3">
          {status.accounts.length ? <>
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">Conta autorizada na Meta
              <select value={choice} onChange={event => setChoice(event.target.value)} disabled={busy}
                className="border-border bg-background min-h-10 max-w-full rounded-lg border px-3">
                {status.accounts.map(account => <option key={account.id} value={account.id}>
                  {account.name} · act_{account.id}{account.currency ? ' · ' + account.currency : ''}
                </option>)}
              </select>
            </label>
            <fieldset className="space-y-2 text-sm">
              <legend className="font-medium">Páginas dos formulários desta empresa</legend>
              {status.pages.map(page => <label key={page.id} className="border-border bg-background flex items-center gap-2 rounded-lg border p-2">
                <input type="checkbox" checked={selectedPages.includes(page.id)} disabled={busy}
                  onChange={event => setSelectedPages(previous => event.target.checked ? [...previous, page.id] : previous.filter(id => id !== page.id))} />
                <span>{page.name} · {page.id}</span>
              </label>)}
              {status.missingPermissions.length > 0 && <p className="text-amber-600">Permissões ainda não concedidas por esta conta Meta: {status.missingPermissions.join(', ')}. É possível conectar anúncios, mas os formulários só poderão ser importados após conceder o acesso à Página.</p>}
              {!status.missingPermissions.length && !status.pages.length && <p className="text-amber-600">Nenhuma Página com token foi disponibilizada. Confira o acesso à Página no Meta Business.</p>}
              <p className="text-muted-foreground text-xs">Selecione apenas as Páginas ligadas a esta empresa. As respostas dos formulários dessas Páginas serão importadas para o CRM.</p>
            </fieldset>
            {selectedPages.length > 0 && <label className="flex flex-col gap-1 text-sm">Funil para os leads de formulário
              <select value={pipelineChoice} onChange={event => setPipelineChoice(event.target.value)} disabled={busy}
                className="border-border bg-background min-h-10 max-w-full rounded-lg border px-3">
                {status.pipelines.map(pipeline => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}
              </select>
              {!status.pipelines.length && <span className="text-amber-600">Crie um funil antes de importar leads de formulários.</span>}
            </label>}
            <button type="button" className={button} disabled={busy || !choice || (selectedPages.length > 0 && !pipelineChoice)} onClick={() => void run('select')}>Conectar e buscar métricas</button>
          </> : <p className="text-sm">Nenhuma conta de anúncios foi disponibilizada pela Meta. Confira seu acesso às contas e tente autorizar novamente.</p>}
        </div>
      )}
      {status?.canManage && adAccountId && active && <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={button} disabled={busy || expired} onClick={() => void run('sync')}>
          {busy ? 'Aguarde, processando...' : 'Sincronizar ' + days + ' dias'}
        </button>
        <button type="button" className={button} disabled={busy || expired || !leadsGranted || !leadPages.length} onClick={() => void run('sync-leads')}>
          Sincronizar leads de formulários
        </button>
        <button type="button" className={button} disabled={busy} onClick={() => void run('disconnect')}>Desconectar conta</button>
        {leadsGranted && leadPages.length > 0 && <span className="text-muted-foreground text-xs">{leadPages.length} Página(s) · Última coleta: {lastLeadsSync ? new Date(lastLeadsSync).toLocaleString('pt-BR') : 'ainda não realizada'}</span>}
        {!leadsGranted && <span className="text-muted-foreground text-xs">Reconecte a Meta e selecione a Página para habilitar a importação dos formulários.</span>}
        {expiry && <span className="text-muted-foreground text-xs">{expired ? 'Autorização expirada. Reconecte a conta.' : 'Autorização válida até ' + expiry.toLocaleDateString('pt-BR')}</span>}
      </div>}
      {busy && <p className="text-muted-foreground text-sm" role="status">Buscando os dados oficiais. Períodos maiores podem levar alguns minutos.</p>}
      {error && <p className="text-destructive rounded-lg bg-destructive/10 p-3 text-sm" role="alert">{error}</p>}
      {message && <p className="rounded-lg bg-emerald-500/10 p-3 text-sm" role="status">{message}</p>}
    </section>
  );
}
