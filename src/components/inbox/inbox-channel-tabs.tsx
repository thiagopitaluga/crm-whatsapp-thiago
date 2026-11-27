'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import type { InboxChannelFilter } from '@/lib/inbox/instagram';
import { cn } from '@/lib/utils';
function WhatsAppIcon() {
  return (
    <svg
      className="size-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5a9 9 0 0 1-13.4 7.8L2 21l1.7-5.4A9 9 0 1 1 21 11.5Z" />
      <path
        fill="currentColor"
        stroke="none"
        d="M8.1 6.4c-.5-.1-.9.1-1.2.5-.5.6-.8 1.4-.6 2.3.5 3.4 4.6 7.5 8.2 8.2.9.2 1.8-.2 2.4-.7.5-.4.6-1 .4-1.5l-2.5-1.3c-.4-.2-.6-.1-.9.2l-.9 1c-1.7-.8-3.3-2.3-4.1-4l.9-1c.3-.3.3-.6.1-.9L8.8 6.6l-.7-.2Z"
      />
    </svg>
  );
}
function InstagramIcon() {
  return (
    <svg
      className="size-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.6" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
function GroupsIcon() {
  return (
    <svg
      className="size-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5a9 9 0 0 1-13.4 7.8L2 21l1.7-5.4A9 9 0 1 1 21 11.5Z" />
      <circle cx="9" cy="9" r="2" />
      <circle cx="15.2" cy="9.2" r="1.8" />
      <path d="M5.5 15.6v-1.1a3.5 3.5 0 0 1 7 0v1.1h-7ZM13.2 12.4a3.1 3.1 0 0 1 5.1 2.4v.8h-3.7" />
    </svg>
  );
}
export function InboxChannelTabs({
  value,
  onChange,
}: {
  value: InboxChannelFilter;
  onChange: (value: InboxChannelFilter) => void;
}) {
  const { accountId } = useAuth();
  const [pending, setPending] = useState<{
    account: string;
    whatsapp: number;
    instagram: number;
  } | null>(null);
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    let running = false;
    const refresh = async () => {
      if (running) return;
      running = true;
      try {
        const response = await fetch('/api/inbox/unanswered', {
          cache: 'no-store',
        });
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled)
          setPending({
            account: accountId,
            whatsapp: Number(data.whatsapp) || 0,
            instagram: Number(data.instagram) || 0,
          });
      } catch {
        /* Keep the last confirmed count while offline. */
      } finally {
        running = false;
      }
    };
    const resume = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    window.addEventListener('focus', resume);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', resume);
    };
  }, [accountId]);
  return (
    <div
      role="group"
      aria-label="Canais da caixa de entrada"
      className="bg-muted flex w-full gap-1 rounded-lg p-1"
    >
      {(
        [
          ['all', 'Todos', null],
          ['whatsapp', 'WhatsApp', WhatsAppIcon],
          ['instagram', 'Instagram', InstagramIcon],
          ['groups', 'Grupos de WhatsApp', GroupsIcon],
        ] as const
      ).map(([key, label, Icon]) => (
        <button
          key={key}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={cn(
            'flex flex-1 items-center justify-center rounded-md p-2 transition-colors',
            value === key
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-background'
          )}
        >
          {Icon ? (
            <span className="relative inline-flex">
              <Icon />
              {(key === 'whatsapp' || key === 'instagram') &&
                pending?.account === accountId &&
                pending[key] > 0 && (
                  <span
                    aria-label={`${pending[key]} mensagens aguardando resposta`}
                    className="ring-background absolute -top-2 -right-3 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] leading-none font-semibold text-white ring-2"
                  >
                    {pending[key] > 99 ? '99+' : pending[key]}
                  </span>
                )}
            </span>
          ) : (
            <span className="text-xs font-semibold">Todos</span>
          )}
        </button>
      ))}
    </div>
  );
}
