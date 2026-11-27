'use client';
import { Inbox, MessageCircle, Camera as Instagram, Users } from 'lucide-react';
import type { InboxChannelFilter } from '@/lib/inbox/instagram';
import { cn } from '@/lib/utils';
export function InboxChannelTabs({
  value,
  onChange,
}: {
  value: InboxChannelFilter;
  onChange: (value: InboxChannelFilter) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Canais da caixa de entrada"
      className="bg-muted flex w-full gap-1 rounded-lg p-1"
    >
      {(
        [
          ['all', 'Todos', Inbox],
          ['whatsapp', 'WhatsApp', MessageCircle],
          ['instagram', 'Instagram', Instagram],
          ['groups', 'Grupos de WhatsApp', Users],
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
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}
