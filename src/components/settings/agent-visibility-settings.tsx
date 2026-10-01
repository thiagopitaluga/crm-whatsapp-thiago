'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';

export function AgentVisibilitySettings() {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!accountId || !canEditSettings) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('agents_can_view_unassigned_contacts')
        .eq('id', accountId)
        .single();
      if (cancelled) return;
      if (error)
        toast.error('Não foi possível carregar a visibilidade dos atendentes.');
      else setEnabled(Boolean(data?.agents_can_view_unassigned_contacts));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, canEditSettings, supabase]);

  if (!canEditSettings) return null;

  async function changeVisibility(next: boolean) {
    if (!accountId || saving) return;
    setSaving(true);
    const { error } = await supabase
      .from('accounts')
      .update({ agents_can_view_unassigned_contacts: next })
      .eq('id', accountId);
    if (error)
      toast.error('Não foi possível salvar a visibilidade dos atendentes.');
    else {
      setEnabled(next);
      toast.success('Visibilidade dos atendentes atualizada.');
    }
    setSaving(false);
  }

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 p-4">
        <div className="min-w-0">
          <p className="text-foreground text-sm font-medium">
            Mostrar contatos sem responsável aos atendentes
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            Desligado por padrão. Atendentes sempre veem os próprios contatos;
            esta opção acrescenta a fila ainda sem atribuição.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => void changeVisibility(checked)}
          disabled={loading || saving}
          aria-label="Mostrar contatos sem responsável aos atendentes"
        />
      </CardContent>
    </Card>
  );
}
