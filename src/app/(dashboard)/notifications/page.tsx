'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { Notification } from '@/types';
import { Bell, Loader2, Send, UserPlus } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { NotificationSettings } from '@/components/pwa/notification-settings';

// Icon per notification type.
const TYPE_ICON: Record<Notification['type'], typeof Bell> = {
  conversation_assigned: UserPlus,
  group_broadcast: Send,
  new_message: Bell,
  task_due: Bell,
  sale_won: Bell,
  system: Bell,
};

export default function NotificationsPage() {
  const router = useRouter();
  const { accountId } = useAuth();
  const [notifications, setNotifications] = useState<Notification[] | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data, error: fetchErr } = await supabase
      .from('notifications')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (fetchErr) {
      setError(fetchErr.message);
      return;
    }
    setNotifications((data ?? []) as Notification[]);
  }, [accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Realtime — new assignments appear without a refresh, and a
  // "mark all read" fired from another tab/device stays in sync here.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('notifications-page')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as Notification;
            setNotifications((prev) => {
              if (!prev) return [row];
              if (prev.some((n) => n.id === row.id)) return prev;
              return [row, ...prev];
            });
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as Notification;
            setNotifications(
              (prev) =>
                prev?.map((n) => (n.id === row.id ? { ...n, ...row } : n)) ??
                prev
            );
          } else if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as Partial<Notification>;
            setNotifications(
              (prev) => prev?.filter((n) => n.id !== oldRow.id) ?? prev
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const markRead = useCallback(
    async (id: string) => {
      // Optimistic — the row is already visually "read" by the time the
      // request lands, so the UI doesn't wait on the round-trip.
      setNotifications(
        (prev) =>
          prev?.map((n) =>
            n.id === id && !n.read_at
              ? { ...n, read_at: new Date().toISOString() }
              : n
          ) ?? prev
      );
      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id)
        .is('read_at', null);
      if (updateErr) {
        toast.error('Failed to mark notification as read');
        load();
      }
    },
    [load]
  );

  const handleClick = useCallback(
    (n: Notification) => {
      if (!n.read_at) markRead(n.id);
      if (n.action_url && /^\/(?!\/)/.test(n.action_url)) {
        router.push(n.action_url);
      } else if (n.conversation_id) {
        router.push(`/inbox?c=${n.conversation_id}`);
      } else if (n.type === 'group_broadcast') {
        router.push('/groups');
      }
    },
    [markRead, router]
  );

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-destructive text-sm">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (notifications === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">App e avisos</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Configure os avisos no celular, lembretes por WhatsApp e horários de
            silêncio.
          </p>
        </div>
      </div>

      <NotificationSettings />
      <h2 className="text-lg font-semibold">Últimas notificações</h2>
      {notifications.length === 0 ? (
        <div className="border-border bg-muted/40 flex h-48 flex-col items-center justify-center rounded-xl border border-dashed">
          <div className="bg-primary/10 flex h-12 w-12 items-center justify-center rounded-xl">
            <Bell className="text-primary h-6 w-6" />
          </div>
          <p className="text-foreground mt-3 text-sm font-medium">
            Nenhuma notificação ainda
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            Você verá um alerta aqui quando alguém atribuir uma conversa a você.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => {
            const Icon = TYPE_ICON[n.type] ?? Bell;
            const isUnread = !n.read_at;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => handleClick(n)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors',
                    isUnread
                      ? 'border-primary/30 bg-primary/5 hover:border-primary/50'
                      : 'border-border bg-card hover:border-border/70'
                  )}
                >
                  <div
                    className={cn(
                      'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg',
                      isUnread ? 'bg-primary/15' : 'bg-muted'
                    )}
                    aria-hidden
                  >
                    <Icon
                      className={cn(
                        'h-5 w-5',
                        isUnread ? 'text-primary' : 'text-muted-foreground'
                      )}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'truncate text-sm font-semibold',
                          isUnread ? 'text-foreground' : 'text-muted-foreground'
                        )}
                      >
                        {n.title}
                      </span>
                      {isUnread && (
                        <span
                          aria-label="Não lida"
                          className="bg-primary h-2 w-2 flex-shrink-0 rounded-full"
                        />
                      )}
                    </div>
                    {n.body && (
                      <p className="text-muted-foreground mt-0.5 truncate text-xs">
                        {n.body}
                      </p>
                    )}
                    <p className="text-muted-foreground/70 mt-1 text-[11px]">
                      {formatDistanceToNow(new Date(n.created_at), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
