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
  const [inboxEnabled, setInboxEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingInbox, setSavingInbox] = useState(false);

  useEffect(() => {
    if (!accountId || !canEditSettings) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('agents_can_view_unassigned_contacts, agents_can_view_inbox_messages')
        .eq('id', accountId)
        .single();
      if (cancelled) return;
      if (error)
        toast.error('Não foi possível carregar a visibilidade dos atendentes.');
      else {
        setEnabled(Boolean(data?.agents_can_view_unassigned_contacts));
        setInboxEnabled(data?.agents_can_view_inbox_messages !== false);
      }
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

  async function changeInboxVisibility(next: boolean) {
    if (!accountId || savingInbox) return;
    setSavingInbox(true);
    const { error } = await supabase
      .from('accounts')
      .update({ agents_can_view_inbox_messages: next })
      .eq('id', accountId);
    if (error)
      toast.error('Não foi possível salvar o acesso à caixa de entrada.');
    else {
      setInboxEnabled(next);
      toast.success('Acesso dos atendentes à caixa de entrada atualizado.');
    }
    setSavingInbox(false);
  }

  return (
    <div className="space-y-3">
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
      <Card>
        <CardContent className="flex items-center justify-between gap-4 p-4">
          <div className="min-w-0">
            <p className="text-foreground text-sm font-medium">
              Permitir que atendentes vejam mensagens na caixa de entrada
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              Ligado por padrão. Ao desligar, as conversas deixam de aparecer
              para atendentes, inclusive prévias e mensagens novas. Contatos e
              cards atribuídos continuam visíveis nas demais áreas.
            </p>
          </div>
          <Switch
            checked={inboxEnabled}
            onCheckedChange={(checked) => void changeInboxVisibility(checked)}
            disabled={loading || savingInbox}
            aria-label="Permitir que atendentes vejam mensagens na caixa de entrada"
          />
        </CardContent>
      </Card>
    </div>
  );
}
