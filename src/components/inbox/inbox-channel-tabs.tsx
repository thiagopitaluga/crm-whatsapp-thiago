'use client';
import type { InboxChannelFilter } from '@/lib/inbox/instagram';
import { cn } from '@/lib/utils';
function WhatsAppIcon() {
  return (
    <svg
      className="size-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.5 11.8a8.5 8.5 0 0 1-12.7 7.4L3 20.5l1.3-4.7a8.5 8.5 0 1 1 16.2-4Z" />
      <path d="M9 8.2c-.3-.5-.6-.5-.9-.1-.5.7-.6 1.5-.2 2.3 1.1 2.4 3.1 4.2 5.5 5 .9.3 1.7.1 2.4-.4.4-.3.3-.6-.1-.9l-1.5-1c-.3-.2-.5-.2-.8.1l-.7.7c-1.5-.6-2.7-1.8-3.3-3.2l.7-.7c.3-.3.3-.5.1-.8L9 8.2Z" />
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
      <path d="M20 10.8a8 8 0 0 1-12 7L3.3 19l1.3-4.5A8 8 0 1 1 20 10.8Z" />
      <circle cx="9" cy="10" r="1.8" />
      <circle cx="15" cy="10" r="1.8" />
      <path d="M5.9 15.1c.2-1.8 1.3-2.8 3.1-2.8s2.9 1 3.1 2.8M11.9 15.1c.2-1.8 1.3-2.8 3.1-2.8 1.7.8 1.9 2.8" />
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
            <Icon />
          ) : (
            <span className="text-xs font-semibold">Todos</span>
          )}
        </button>
      ))}
    </div>
  );
}
