'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plug, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QrWhatsAppConnector } from '@/components/settings/qr-whatsapp-connector';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import { StageIntegrations } from '@/components/pipelines/stage-integrations';
import { InstagramIntegration } from '../instagram/instagram-integration';

type Channel = {
  id: string;
  key: string;
  label: string;
  address: string | null;
  connected: boolean;
  provider: string;
};
type Section = 'whatsapp' | 'instagram' | 'integrations' | 'pixel' | 'api';

export default function ConnectionsPage() {
  const { accountId, canEditSettings } = useAuth();
  const [section, setSection] = useState<Section>('whatsapp');
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab === 'pixel' || tab === 'instagram') setSection(tab);
  }, []);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/ai/agents/channels', {
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || 'Não foi possível carregar as conexões.');
      const rows: Channel[] = Array.isArray(body.channels) ? body.channels : [];
      setChannels(rows);
      setSelected((current) =>
        rows.some((row) => row.id === current && row.provider === 'evolution')
          ? current
          : (rows.find((row) => row.provider === 'evolution')?.id ?? '')
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Não foi possível carregar as conexões.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (accountId) {
      setSelected('');
      setLoading(true);
      void refresh();
    }
  }, [accountId, refresh]);

  const add = async () => {
    if (!name.trim()) {
      toast.error('Informe um nome para identificar o WhatsApp.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/ai/agents/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || 'Não foi possível adicionar a conexão.');
      setName('');
      await refresh();
      setSelected(body.channel.id);
      toast.success(
        'WhatsApp adicionado. Conecte-o pelo QR Code ou código de pareamento.'
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao adicionar conexão.'
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (channel: Channel) => {
    if (!window.confirm(`Remover a conexão ${channel.label}?`)) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/ai/agents/channels?id=${encodeURIComponent(channel.id)}`,
        { method: 'DELETE' }
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || 'Não foi possível remover a conexão.');
      await refresh();
      toast.success('Conexão removida.');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao remover conexão.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Plug className="text-primary size-6" />
          Conexões
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Gerencie seus números de WhatsApp e as integrações da conta.
        </p>
      </div>
      <div
        className="flex flex-wrap gap-2 border-b pb-3"
        aria-label="Áreas de conexões"
      >
        {(
          [
            ['whatsapp', 'WhatsApp'],
            ['instagram', 'Instagram'],
            ['integrations', 'Integrações'],
            ['pixel', 'Pixel do Meta'],
            ['api', 'Chaves de API'],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            type="button"
            variant={section === id ? 'default' : 'outline'}
            onClick={() => setSection(id)}
          >
            {label}
          </Button>
        ))}
      </div>
      {section === 'whatsapp' && (
        <div className="space-y-5">
          <div className="bg-card rounded-xl border p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Números de WhatsApp</h2>
                <p className="text-muted-foreground text-sm">
                  Selecione uma conexão Evolution para gerenciá-la. Números
                  Cloud são adicionados abaixo.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void refresh()}
              >
                <RefreshCw className="mr-2 size-4" />
                Atualizar
              </Button>
            </div>
            {loading ? (
              <p className="text-muted-foreground mt-4 text-sm">
                Carregando conexões…
              </p>
            ) : (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {channels.map((channel) => (
                  <div
                    key={channel.id}
                    className={`rounded-lg border p-3 ${selected === channel.id ? 'border-primary bg-primary/5' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{channel.label}</p>
                        <p className="text-muted-foreground text-xs">
                          {channel.provider === 'cloud'
                            ? 'Cloud API'
                            : 'Evolution'}
                          {channel.address ? ` · ${channel.address}` : ''}
                        </p>
                      </div>
                      <span
                        className={
                          channel.connected
                            ? 'text-xs text-emerald-600'
                            : 'text-muted-foreground text-xs'
                        }
                      >
                        {channel.connected ? 'Conectado' : 'Desconectado'}
                      </span>
                    </div>
                    {channel.provider === 'evolution' && (
                      <div className="mt-3 flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setSelected(channel.id)}
                        >
                          Gerenciar
                        </Button>
                        {canEditSettings && channel.key.includes(':') && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void remove(channel)}
                          >
                            Remover
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {canEditSettings && (
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1 space-y-1">
                  <label
                    htmlFor="connection-name"
                    className="text-sm font-medium"
                  >
                    Nome do novo WhatsApp Evolution
                  </label>
                  <Input
                    id="connection-name"
                    placeholder="Ex.: Vendas ou Atendimento"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={80}
                  />
                </div>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void add()}
                >
                  <Plus className="mr-2 size-4" />
                  Adicionar WhatsApp
                </Button>
              </div>
            )}
          </div>
          {selected && canEditSettings && (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">
                Conectar{' '}
                {channels.find((channel) => channel.id === selected)?.label}
              </h2>
              <QrWhatsAppConnector
                key={selected}
                channelId={selected}
                disabled={false}
              />
            </div>
          )}
          <details className="bg-card rounded-xl border p-4">
            <summary className="cursor-pointer font-semibold">
              Adicionar ou configurar WhatsApp Cloud API
            </summary>
            <div className="mt-5">
              <WhatsAppConfig />
            </div>
          </details>
        </div>
      )}
      {section === 'integrations' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/meta-ads"
              className="bg-card hover:bg-muted/50 rounded-xl border p-4"
            >
              <span className="font-semibold">Meta Ads</span>
              <p className="text-muted-foreground mt-1 text-sm">
                Conecte e acompanhe suas contas de anúncios.
              </p>
            </Link>
            <Link
              href="/tasks"
              className="bg-card hover:bg-muted/50 rounded-xl border p-4"
            >
              <span className="font-semibold">Google Calendar</span>
              <p className="text-muted-foreground mt-1 text-sm">
                Conecte sua agenda pela página de tarefas.
              </p>
            </Link>
          </div>
        </div>
      )}
      {section === 'instagram' && (
        <InstagramIntegration key={accountId} returnTo="connections" />
      )}
      {section === 'pixel' && <StageIntegrations editable={canEditSettings} />}
      {section === 'api' && <ApiKeysSettings />}
    </div>
  );
}
