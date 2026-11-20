'use client';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
const requests = new Map<
  string,
  { at: number; promise: Promise<string | null> }
>();
function loadPhoto(id: string, accountId: string, force = false) {
  const key = accountId + ':' + id;
  const existing = requests.get(key);
  if (!force && existing && Date.now() - existing.at < 60_000)
    return existing.promise;
  const promise = fetch(
    `/api/contacts/${id}/avatar${force ? '?refresh=1' : ''}`,
    { cache: 'no-store' }
  )
    .then(async (r) => (r.ok ? ((await r.json()).url ?? null) : null))
    .catch(() => null);
  requests.set(key, { at: Date.now(), promise });
  return promise;
}
type AvatarProps = {
  id: string;
  name: string;
  url?: string | null;
  className?: string;
};
export function ContactAvatar(props: AvatarProps) {
  return (
    <ContactAvatarImage key={props.id + ':' + (props.url ?? '')} {...props} />
  );
}
function ContactAvatarImage({ id, name, url, className }: AvatarProps) {
  const { accountId } = useAuth();
  const [source, setSource] = useState(url ?? null),
    [broken, setBroken] = useState(false);
  const ref = useRef<HTMLDivElement>(null),
    retried = useRef(false);
  useEffect(() => {
    if (!accountId || !ref.current) return;
    let cancelled = false;
    const load = () => {
      void loadPhoto(id, accountId).then((value) => {
        if (!cancelled && value) {
          setSource(value);
          setBroken(false);
        }
      });
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          load();
        }
      },
      { rootMargin: '80px' }
    );
    observer.observe(ref.current);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [accountId, id]);
  return (
    <div
      ref={ref}
      className={cn(
        'bg-muted text-foreground flex shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-medium',
        className
      )}
    >
      {source && !broken ? (
        <img
          src={source}
          alt={name}
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => {
            setBroken(true);
            if (!retried.current && accountId) {
              retried.current = true;
              void loadPhoto(id, accountId, true).then((value) => {
                if (value && value !== source) {
                  setSource(value);
                  setBroken(false);
                }
              });
            }
          }}
        />
      ) : (
        name
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((w) => w[0])
          .join('')
          .toUpperCase()
      )}
    </div>
  );
}
