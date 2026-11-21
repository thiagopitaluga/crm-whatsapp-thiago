'use client';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  VisualAutomationWorkspace,
  type AutomationRecord,
  type Account,
} from '@/components/instagram/visual-flow-builder';
export function InstagramAutomations() {
  const [items, setItems] = useState<AutomationRecord[]>([]),
    [accounts, setAccounts] = useState<Account[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [canManage, setCanManage] = useState(false);
  const load = useCallback(async () => {
    try {
      const [a, c] = await Promise.all([
        fetch('/api/instagram/automations'),
        fetch('/api/instagram/channels'),
      ]);
      if (!a.ok || !c.ok)
        throw new Error('Não foi possível carregar os fluxos.');
      const data = await a.json(),
        channels = await c.json();
      setItems(data.automations || []);
      setCanManage(data.canManage);
      setAccounts(
        (channels.channels || []).map(
          (v: {
            id: string;
            username: string;
            token_expires_at: string | null;
          }) => ({
            id: v.id,
            username: v.username,
            accountType: 'BUSINESS',
            tokenExpiresAt: v.token_expires_at,
          })
        )
      );
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function toggle(item: AutomationRecord) {
    try {
      const r = await fetch('/api/instagram/automations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          active: item.status !== 'active',
          channelId: item.instagramAccountId,
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Falha ao alterar status.');
      toast.success(
        item.status === 'active' ? 'Automação pausada.' : 'Automação ativada.'
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao alterar.');
    }
  }
  if (loading)
    return <p className="text-muted-foreground p-6">Carregando automações…</p>;
  if (error)
    return (
      <div role="alert" className="text-destructive">
        <p>{error}</p>
        <button onClick={() => void load()}>Tentar novamente</button>
      </div>
    );
  if (!canManage)
    return (
      <p>Peça a um administrador ou atendente para configurar as automações.</p>
    );
  return (
    <VisualAutomationWorkspace
      automations={items}
      accounts={accounts}
      loading={loading}
      onChanged={load}
      onToggle={(item) => void toggle(item)}
      showToast={(message) => toast(message)}
    />
  );
}
