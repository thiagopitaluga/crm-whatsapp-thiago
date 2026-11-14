'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, RefreshCw, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type Example = {
  id: string;
  customer_message: string;
  agent_reply: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
};

export function AiTrainingReview({ agentId }: { agentId?: string }) {
  const [examples, setExamples] = useState<Example[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : '';
      const response = await fetch(`/api/ai/training${query}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.error ?? 'Falha ao carregar exemplos de treinamento.'
        );
      setExamples(data.examples ?? []);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao carregar treinamento.'
      );
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(example: Example, status: 'approved' | 'rejected') {
    setPendingId(example.id);
    try {
      const response = await fetch('/api/ai/training', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: example.id, status, agent_id: agentId }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? 'Não foi possível revisar este exemplo.');
      setExamples((current) =>
        current.map((item) =>
          item.id === example.id ? { ...item, status } : item
        )
      );
      toast.success(
        status === 'approved'
          ? 'Exemplo aprovado para o treinamento.'
          : 'Exemplo descartado.'
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao revisar exemplo.'
      );
    } finally {
      setPendingId(null);
    }
  }

  async function remove(example: Example) {
    setPendingId(example.id);
    try {
      const response = await fetch(
        `/api/ai/training?id=${encodeURIComponent(example.id)}${agentId ? `&agent_id=${encodeURIComponent(agentId)}` : ''}`,
        { method: 'DELETE' }
      );
      if (!response.ok)
        throw new Error('Não foi possível remover este exemplo.');
      setExamples((current) =>
        current.filter((item) => item.id !== example.id)
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao remover exemplo.'
      );
    } finally {
      setPendingId(null);
    }
  }

  const pendingCount = examples.filter(
    (item) => item.status === 'pending'
  ).length;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">
            Exemplos de auto training ({pendingCount} aguardando revisão)
          </CardTitle>
          <CardDescription>
            Quando habilitado, o agente aprende com respostas humanas reais.
            Aprove os exemplos corretos antes que sejam usados.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Atualizar exemplos"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && (
          <p className="text-muted-foreground text-sm">Carregando exemplos…</p>
        )}
        {!loading && examples.length === 0 && (
          <p className="text-muted-foreground text-sm">
            Ainda não há exemplos. Eles aparecerão após respostas enviadas por
            atendentes quando o auto training estiver ativo.
          </p>
        )}
        {examples.map((example) => (
          <article key={example.id} className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground text-xs font-medium uppercase">
                {example.status === 'pending'
                  ? 'Aguardando revisão'
                  : example.status === 'approved'
                    ? 'Aprovado'
                    : 'Descartado'}
              </span>
              <div className="flex gap-1">
                {example.status === 'pending' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pendingId === example.id}
                      onClick={() => void review(example, 'approved')}
                    >
                      <Check className="mr-1 h-4 w-4" />
                      Aprovar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pendingId === example.id}
                      onClick={() => void review(example, 'rejected')}
                    >
                      <X className="mr-1 h-4 w-4" />
                      Descartar
                    </Button>
                  </>
                )}
                {example.status !== 'pending' && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Excluir exemplo"
                    disabled={pendingId === example.id}
                    onClick={() => void remove(example)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <p className="text-sm">
              <strong>Cliente:</strong> {example.customer_message}
            </p>
            <p className="text-sm">
              <strong>Atendente:</strong> {example.agent_reply}
            </p>
          </article>
        ))}
      </CardContent>
    </Card>
  );
}
