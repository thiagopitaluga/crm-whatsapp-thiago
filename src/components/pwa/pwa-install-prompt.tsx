'use client';

import { useEffect, useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';

const DISMISS_KEY = 'organizap.pwa-install-dismissed.v1';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

function isInstalled() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true
  );
}

/**
 * A small, per-browser invitation shown to every signed-in user who has not
 * installed the CRM yet. It never stores account data; dismissal is only a
 * local preference so one person is not repeatedly interrupted.
 */
export function PwaInstallPrompt() {
  const { user, loading } = useAuth();
  const t = useTranslations('PwaInstall');
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(true);
  const [ios, setIos] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setStandalone(isInstalled());
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === 'true');
    setIos(/iPad|iPhone|iPod/.test(window.navigator.userAgent));

    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    }

    function onInstalled() {
      setStandalone(true);
      setInstallEvent(null);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, 'true');
    setDismissed(true);
  }

  async function install() {
    if (!installEvent) return;

    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    setInstallEvent(null);
    if (choice.outcome !== 'accepted') dismiss();
  }

  if (loading || !user || standalone || dismissed || (!installEvent && !ios)) {
    return null;
  }

  const isIosHelp = ios && !installEvent;

  return (
    <section
      aria-live="polite"
      className="border-border bg-card fixed right-4 bottom-4 left-4 z-50 max-w-md rounded-xl border p-3 shadow-xl sm:right-6 sm:left-auto"
    >
      <div className="flex gap-3">
        <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
          <Smartphone className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 pr-5">
          <h2 className="text-foreground text-sm font-semibold">
            {t('title')}
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs leading-5">
            {isIosHelp ? t('iosDescription') : t('description')}
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="text-muted-foreground hover:bg-muted hover:text-foreground absolute top-2.5 right-2.5 flex size-7 items-center justify-center rounded-md transition-colors"
          aria-label={t('close')}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
          {t('later')}
        </Button>
        {!isIosHelp ? (
          <Button type="button" size="sm" onClick={() => void install()}>
            <Download className="size-3.5" aria-hidden="true" />
            {t('install')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
