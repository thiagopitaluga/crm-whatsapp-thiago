'use client';
import { useEffect, useState } from 'react';
type Channel = {
  id: string;
  username: string;
  instagram_id: string;
  token_expires_at: string | null;
  lead_pipeline_id: string | null;
  lead_stage_id: string | null;
};
export function InstagramIntegration() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [pipelines, setPipelines] = useState<
    {
      id: string;
      name: string;
      pipeline_stages: { id: string; name: string; position: number }[];
    }[]
  >([]);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [configured, setConfigured] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [automationEnabled, setAutomationEnabled] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('connection');
    if (result === 'connected') setStatus('Perfil conectado.');
    if (result === 'cancelled') setStatus('Autorização cancelada.');
    if (result === 'error')
      setError(
        'A conexão não foi concluída. Verifique a configuração e tente novamente.'
      );
    if (result === 'not-configured')
      setError(
        'O aplicativo do Instagram ainda precisa ser configurado no servidor.'
      );
    const controller = new AbortController();
    fetch('/api/instagram/channels', { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error('Não foi possível carregar os perfis.');
        return r.json();
      })
      .then((data) => {
        setChannels(data.channels);
        setPipelines(data.pipelines ?? []);
        setConfigured(data.configured);
        setCanManage(data.canManage);
        setAutomationEnabled(data.automationEnabled);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  async function save(channel: Channel) {
    setSaving(channel.id);
    setError('');
    setStatus('');
    try {
      const r = await fetch('/api/instagram/channels', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: channel.id,
          pipelineId: channel.lead_pipeline_id,
          stageId: channel.lead_stage_id,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setStatus('Destino dos novos leads salvo.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar.');
    } finally {
      setSaving('');
    }
  }
  return (
    <section className="border-border bg-card space-y-4 rounded-xl border p-5">
      <div>
        <h2 className="font-semibold">Perfis do Instagram</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Conecte contas comerciais ou de criador para receber e responder
          mensagens nesta empresa. O Instagram pedirá um novo login para você
          escolher o perfil.
        </p>
      </div>
      {canManage && configured ? (
        <a
          className="bg-primary text-primary-foreground inline-block rounded-lg px-4 py-2 text-sm"
          href="/api/instagram/connect"
        >
          {channels.length ? 'Conectar outro perfil' : 'Conectar perfil'}
        </a>
      ) : (
        <p className="text-muted-foreground text-sm">
          {configured
            ? 'Um administrador pode conectar o perfil.'
            : 'Aguardando configuração do aplicativo do Instagram no servidor.'}
        </p>
      )}
      <p className="text-muted-foreground text-sm">
        Automações:{' '}
        {automationEnabled
          ? 'habilitadas no servidor'
          : 'aguardando configuração e validação da conexão'}
        .
      </p>
      {channels.length ? (
        channels.map((channel) => (
          <div
            key={channel.id}
            className="border-border rounded-lg border p-3 text-sm"
          >
            <strong>@{channel.username}</strong>
            <p className="text-muted-foreground">ID {channel.instagram_id}</p>
            {channel.token_expires_at && (
              <p className="text-muted-foreground">
                Autorização válida até{' '}
                {new Date(channel.token_expires_at).toLocaleDateString('pt-BR')}
              </p>
            )}
            <div className="mt-4 space-y-3 border-t pt-4">
              <h3 className="font-medium">Entrada de leads no Kanban</h3>
              <p className="text-muted-foreground text-xs">
                Escolha onde os novos leads que enviarem um Direct entrarão.
                Negócios já existentes mantêm a etapa atual.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span>Funil</span>
                  <select
                    aria-label={'Funil de @' + channel.username}
                    disabled={!canManage || !!saving}
                    value={channel.lead_pipeline_id ?? ''}
                    className="bg-background w-full rounded-lg border p-2"
                    onChange={(e) =>
                      setChannels((items) =>
                        items.map((c) =>
                          c.id === channel.id
                            ? {
                                ...c,
                                lead_pipeline_id: e.target.value || null,
                                lead_stage_id: null,
                              }
                            : c
                        )
                      )
                    }
                  >
                    <option value="">Não criar negócio automaticamente</option>
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span>Etapa de entrada</span>
                  <select
                    aria-label={'Etapa de @' + channel.username}
                    disabled={
                      !canManage || !channel.lead_pipeline_id || !!saving
                    }
                    value={channel.lead_stage_id ?? ''}
                    className="bg-background w-full rounded-lg border p-2"
                    onChange={(e) =>
                      setChannels((items) =>
                        items.map((c) =>
                          c.id === channel.id
                            ? { ...c, lead_stage_id: e.target.value || null }
                            : c
                        )
                      )
                    }
                  >
                    <option value="">Selecione uma etapa</option>
                    {[
                      ...(pipelines.find(
                        (p) => p.id === channel.lead_pipeline_id
                      )?.pipeline_stages ?? []),
                    ]
                      .sort((a, b) => a.position - b.position)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              {canManage && (
                <button
                  disabled={
                    !!saving ||
                    (!!channel.lead_pipeline_id && !channel.lead_stage_id)
                  }
                  onClick={() => void save(channel)}
                  className="bg-primary text-primary-foreground rounded-lg px-4 py-2 disabled:opacity-50"
                >
                  {saving === channel.id
                    ? 'Salvando…'
                    : 'Salvar destino dos leads'}
                </button>
              )}
            </div>
          </div>
        ))
      ) : (
        <p className="text-muted-foreground text-sm">
          Nenhum perfil conectado.
        </p>
      )}
      {status && (
        <p role="status" className="text-sm">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </section>
  );
}
