'use client';
import { useEffect, useState } from 'react';
type Channel = {
  id: string;
  username: string;
  instagram_id: string;
  token_expires_at: string | null;
};
export function InstagramIntegration() {
  const [channels, setChannels] = useState<Channel[]>([]);
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
        setConfigured(data.configured);
        setCanManage(data.canManage);
        setAutomationEnabled(data.automationEnabled);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  return (
    <section className="border-border bg-card space-y-4 rounded-xl border p-5">
      <div>
        <h2 className="font-semibold">Perfis do Instagram</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Conecte um perfil profissional para receber e responder mensagens
          nesta empresa.
        </p>
      </div>
      {canManage && configured ? (
        <a
          className="bg-primary text-primary-foreground inline-block rounded-lg px-4 py-2 text-sm"
          href="/api/instagram/connect"
        >
          Conectar perfil
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
