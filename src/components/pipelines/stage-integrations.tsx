'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
export function StageIntegrations() {
  const [pixelId, setPixelId] = useState('');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('Carregando integrações…');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch('/api/pipelines/stage-integrations')
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error);
        return b;
      })
      .then((b) => {
        if (alive) {
          setPixelId(b.pixelId);
          setStatus(
            `${b.configured ? 'Pixel configurado.' : 'Pixel não configurado.'} ${b.emailReady ? 'Envio de e-mail disponível.' : 'Envio de e-mail pendente de configuração no servidor.'} ${b.cronReady ? '' : 'Agendador pendente de configuração.'}`
          );
        }
      })
      .catch(() => {
        if (alive) setStatus('Não foi possível consultar as integrações.');
      });
    return () => {
      alive = false;
    };
  }, []);
  async function save() {
    setSaving(true);
    try {
      const response = await fetch('/api/pipelines/stage-integrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pixelId, token }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setToken('');
      setStatus('Pixel configurado para esta conta.');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <details className="rounded border p-3">
      <summary className="cursor-pointer font-medium">
        Integrações da conta
      </summary>
      <p role="status" className="my-3 text-xs">
        {status}
      </p>
      <label className="block">
        ID do pixel
        <input
          className="my-1 w-full rounded border p-2"
          value={pixelId}
          onChange={(e) => setPixelId(e.target.value)}
        />
      </label>
      <label className="block">
        Token da API de Conversões
        <input
          type="password"
          autoComplete="off"
          className="my-1 w-full rounded border p-2"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </label>
      <p className="text-muted-foreground my-2 text-xs">
        Esta integração vale para todas as etapas da conta. O token é armazenado
        criptografado.
      </p>
      <Button
        variant="outline"
        disabled={saving || !pixelId || !token}
        onClick={() => void save()}
      >
        {saving ? 'Salvando…' : 'Salvar integração'}
      </Button>
    </details>
  );
}
