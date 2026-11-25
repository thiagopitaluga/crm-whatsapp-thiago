'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CalendarClock,
  Flame,
  MessageCircle,
  ArrowUpRight,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';

const dateLabel = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

type Summary = {
  tasks: { id: string; title: string; due_at: string }[];
  due: number;
  unread: number;
  hot: number;
};

export function MyDay() {
  const { accountId, profile, user } = useAuth();
  const profileId = profile?.id;
  const userId = user?.id;
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!accountId || !profileId || !userId) return;
    const db = createClient();
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    const controller = new AbortController();
    void Promise.all([
      db
        .from('tasks')
        .select('id,title,due_at', { count: 'exact' })
        .eq('account_id', accountId)
        .eq('assigned_to', profileId)
        .eq('status', 'open')
        .lte('due_at', endOfDay.toISOString())
        .order('due_at')
        .limit(4)
        .abortSignal(controller.signal),
      db
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('assigned_agent_id', userId)
        .neq('status', 'closed')
        .gt('unread_count', 0)
        .abortSignal(controller.signal),
      db
        .from('instagram_conversations')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('assigned_agent_id', userId)
        .neq('status', 'closed')
        .gt('unread_count', 0)
        .abortSignal(controller.signal),
      db
        .from('deals')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('assigned_to', profileId)
        .eq('status', 'open')
        .eq('temperature', 'hot')
        .abortSignal(controller.signal),
    ])
      .then(([tasks, whatsapp, instagram, deals]) => {
        if (controller.signal.aborted) return;
        if (tasks.error || whatsapp.error || instagram.error || deals.error) {
          setError(true);
          return;
        }
        setData({
          tasks: tasks.data ?? [],
          due: tasks.count ?? 0,
          unread: (whatsapp.count ?? 0) + (instagram.count ?? 0),
          hot: deals.count ?? 0,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [accountId, profileId, userId]);

  if (!profileId || !userId) return null;

  const items = [
    {
      href: '/tasks',
      title: 'Minhas tarefas até hoje',
      value: data?.due,
      Icon: CalendarClock,
    },
    {
      href: '/inbox?assignee=mine&status=unread',
      title: 'Minhas conversas não lidas',
      value: data?.unread,
      Icon: MessageCircle,
    },
    {
      href: '/pipelines',
      title: 'Meus negócios quentes',
      value: data?.hot,
      Icon: Flame,
    },
  ] as const;

  return (
    <section
      aria-labelledby="my-day-heading"
      className="bg-card space-y-3 rounded-xl border p-4"
    >
      <h2 id="my-day-heading" className="font-semibold">
        Meu dia
      </h2>
      {error ? (
        <p role="alert" className="text-muted-foreground text-sm">
          Não foi possível carregar suas prioridades.
        </p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            {items.map(({ href, title, value, Icon }) => (
              <Link
                key={href}
                href={href}
                className="hover:bg-muted flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2"
              >
                <Icon className="text-primary size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="text-muted-foreground block text-xs">
                    {title}
                  </span>
                  <span className="text-lg font-semibold tabular-nums">
                    {value ?? '…'}
                  </span>
                </span>
                <ArrowUpRight
                  className="text-muted-foreground size-3.5 shrink-0"
                  aria-hidden
                />
              </Link>
            ))}
          </div>
          {Boolean(data?.tasks.length) && (
            <ul className="divide-y text-sm">
              {data?.tasks.map((task) => (
                <li
                  key={task.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <Link href="/tasks" className="hover:underline">
                    {task.title}
                  </Link>
                  <time
                    dateTime={task.due_at}
                    className="text-muted-foreground text-xs"
                  >
                    {dateLabel.format(new Date(task.due_at))}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
