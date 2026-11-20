'use client';
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
type Event = {
  id: string;
  created_at: string;
  status: string;
  error: string | null;
  payload: { event?: string };
  stage_id: string;
};
export function StageIntegrations({ editable = true }: { editable?: boolean }) {
  const [pixelId, setPixelId] = useState(''),
    [token, setToken] = useState(''),
    [hint, setHint] = useState(''),
    [testCode, setTestCode] = useState(''),
    [history, setHistory] = useState<Event[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/pipelines/stage-integrations', {
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error || 'Falha ao carregar pixel.');
      setPixelId(body.pixelId || '');
      setHint(body.tokenHint || '');
      setHistory(body.history || []);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao carregar pixel.'
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function submit(method: 'PUT' | 'POST') {
    setBusy(true);
    try {
      const response = await fetch('/api/pipelines/stage-integrations', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          method === 'PUT' ? { pixelId, token } : { testCode }
        ),
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error || 'Falha na integração.');
      toast.success(
        method === 'PUT'
          ? 'Pixel salvo.'
          : `Meta recebeu ${body.received} evento(s) de teste.`
      );
      if (method === 'PUT') setToken('');
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Falha na integração.'
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <section className="bg-card space-y-4 rounded-xl border p-5">
        <div>
          <h2 className="font-semibold">Pixel do Meta (API de Conversões)</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Usado pelos eventos configurados nas etapas do funil. Gere o token
            em Gerenciador de Eventos → Configurações → API de Conversões.
          </p>
        </div>
        {loading ? (
          <p>Carregando…</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                ID do pixel (conjunto de dados)
                <input
                  className="bg-background mt-1 w-full rounded-md border p-2"
                  inputMode="numeric"
                  value={pixelId}
                  disabled={!editable}
                  onChange={(e) => setPixelId(e.target.value)}
                />
              </label>
              <label className="text-sm">
                Token de acesso
                <input
                  className="bg-background mt-1 w-full rounded-md border p-2"
                  type="password"
                  autoComplete="off"
                  placeholder={
                    hint
                      ? `Salvo (${hint}). Preencha só para trocar.`
                      : 'Token da API de Conversões'
                  }
                  value={token}
                  disabled={!editable}
                  onChange={(e) => setToken(e.target.value)}
                />
              </label>
            </div>
            <label className="block max-w-md text-sm">
              Código de teste (só para o botão Testar)
              <input
                className="bg-background mt-1 w-full rounded-md border p-2"
                value={testCode}
                disabled={!editable}
                placeholder="Ex.: TEST12345"
                onChange={(e) => setTestCode(e.target.value)}
              />
            </label>
            <div className="flex gap-2">
              <Button
                disabled={!editable || busy || !pixelId}
                onClick={() => void submit('PUT')}
              >
                Salvar
              </Button>
              <Button
                variant="outline"
                disabled={!editable || busy || !testCode || !hint}
                onClick={() => void submit('POST')}
              >
                <Send className="size-4" />
                Testar evento
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Use o código do Gerenciador de Eventos → Testar eventos para
              separar o teste dos eventos reais.
            </p>
          </>
        )}
      </section>
      <section className="bg-card rounded-xl border p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Histórico de eventos</h2>
          <Button size="sm" variant="outline" onClick={() => void refresh()}>
            <RefreshCw className="size-4" />
            Atualizar
          </Button>
        </div>
        {history.length ? (
          <div className="mt-4 space-y-2">
            {history.map((item) => (
              <div key={item.id} className="rounded-lg border p-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span>
                    {item.payload?.event || 'Evento do Meta'} ·{' '}
                    {item.status === 'done'
                      ? 'Enviado'
                      : item.status === 'failed'
                        ? 'Falhou'
                        : item.status === 'pending'
                          ? 'Na fila'
                          : item.status === 'skipped'
                            ? 'Ignorado'
                            : 'Em execução'}
                  </span>
                  <time
                    className="text-muted-foreground"
                    dateTime={item.created_at}
                  >
                    {new Date(item.created_at).toLocaleString('pt-BR')}
                  </time>
                </div>
                {item.error && (
                  <p className="text-destructive mt-1">{item.error}</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground mt-4 text-sm">
            Nenhum evento enviado ainda.
          </p>
        )}
      </section>
    </div>
  );
}
