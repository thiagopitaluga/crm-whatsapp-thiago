'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type QrStatus =
  | 'loading'
  | 'starting'
  | 'connecting'
  | 'awaiting_qr_scan'
  | 'connected'
  | 'reconnecting'
  | 'logged_out'
  | 'disconnected'
  | 'error';

type StatusPayload = {
  status?: QrStatus;
  qr_available?: boolean;
  last_error?: string | null;
  error?: string;
  history_import?: HistoryImport | null;
};

type HistoryImport = {
  status: 'preparing' | 'running' | 'completed' | 'failed';
  discovered: number;
  imported: number;
  failed: number;
  error: string | null;
};

export function QrWhatsAppConnector({ disabled }: { disabled: boolean }) {
  const t = useTranslations('Settings.whatsapp.qr');
  const [status, setStatus] = useState<QrStatus>('loading');
  const [qrAvailable, setQrAvailable] = useState(false);
  const [qrVersion, setQrVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [historyImport, setHistoryImport] = useState<HistoryImport | null>(
    null
  );
  const initialized = useRef(false);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/whatsapp/qr', { cache: 'no-store' });
      const data = (await response.json()) as StatusPayload;
      if (!response.ok) throw new Error(data.error || t('statusError'));

      const nextStatus = data.status ?? 'disconnected';
      setStatus(nextStatus);
      setQrAvailable(data.qr_available === true);
      setError(data.last_error ?? null);
      setHistoryImport(data.history_import ?? null);
      if (data.qr_available) setQrVersion(Date.now());
      return nextStatus;
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : t('statusError');
      setStatus('error');
      setQrAvailable(false);
      setError(message);
      return 'error' as const;
    }
  }, [t]);

  const connect = useCallback(async () => {
    if (disabled) return;
    setActionPending(true);
    setError(null);
    try {
      const response = await fetch('/api/whatsapp/qr', { method: 'POST' });
      const data = (await response.json()) as StatusPayload;
      if (!response.ok) throw new Error(data.error || t('connectError'));
      setStatus(data.status ?? 'connecting');
      await loadStatus();
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : t('connectError');
      setStatus('error');
      setError(message);
      toast.error(message);
    } finally {
      setActionPending(false);
    }
  }, [disabled, loadStatus, t]);

  useEffect(() => {
    let active = true;

    async function initialize() {
      const current = await loadStatus();
      if (
        active &&
        !initialized.current &&
        !disabled &&
        ['disconnected', 'logged_out'].includes(current)
      ) {
        initialized.current = true;
        await connect();
      }
    }

    void initialize();
    const timer = window.setInterval(() => {
      if (active) void loadStatus();
    }, 4000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [connect, disabled, loadStatus]);

  async function disconnect() {
    if (!confirm(t('disconnectConfirm'))) return;
    setActionPending(true);
    try {
      const response = await fetch('/api/whatsapp/qr', { method: 'DELETE' });
      const data = (await response.json()) as StatusPayload;
      if (!response.ok) throw new Error(data.error || t('disconnectError'));
      setStatus('disconnected');
      setQrAvailable(false);
      setError(null);
      initialized.current = true;
      toast.success(t('disconnectedToast'));
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : t('disconnectError')
      );
    } finally {
      setActionPending(false);
    }
  }

  async function importHistory() {
    if (!confirm(t('importConfirm'))) return;
    setActionPending(true);
    try {
      const response = await fetch(
        '/api/whatsapp/qr?operation=import_history',
        { method: 'POST' }
      );
      const data = (await response.json()) as StatusPayload;
      if (!response.ok) throw new Error(data.error || t('importError'));
      setHistoryImport(data.history_import ?? null);
      toast.success(t('importStartedToast'));
      await loadStatus();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error ? requestError.message : t('importError')
      );
    } finally {
      setActionPending(false);
    }
  }

  const isBusy = ['loading', 'starting', 'connecting', 'reconnecting'].includes(
    status
  );
  const historyImportRunning =
    historyImport?.status === 'preparing' ||
    historyImport?.status === 'running';

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="overflow-hidden">
        <CardHeader className="border-border bg-muted/30 border-b">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-foreground flex items-center gap-2">
                <QrCode className="text-primary size-5" />
                {t('title')}
              </CardTitle>
              <CardDescription className="mt-1.5">
                {t('description')}
              </CardDescription>
            </div>
            {status === 'connected' && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-3.5" />
                {t('connected')}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex min-h-[420px] flex-col items-center justify-center p-6 text-center sm:p-10">
          {status === 'connected' ? (
            <div className="flex max-w-md flex-col items-center">
              <div className="mb-5 flex size-20 items-center justify-center rounded-full bg-emerald-500/10 ring-8 ring-emerald-500/5">
                <CheckCircle2 className="size-10 text-emerald-500" />
              </div>
              <h3 className="text-foreground text-xl font-semibold">
                {t('connectedTitle')}
              </h3>
              <p className="text-muted-foreground mt-2 text-base leading-relaxed">
                {t('connectedDescription')}
              </p>
              <div className="border-border bg-muted/30 mt-6 w-full rounded-xl border p-4 text-left">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="text-foreground text-sm font-semibold">
                      {t('importTitle')}
                    </h4>
                    <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                      {historyImportRunning
                        ? t('importRunning', {
                            discovered: historyImport?.discovered ?? 0,
                            imported: historyImport?.imported ?? 0,
                          })
                        : historyImport?.status === 'completed'
                          ? t('importCompleted', {
                              imported: historyImport.imported,
                              failed: historyImport.failed,
                            })
                          : t('importDescription')}
                    </p>
                    {historyImport?.status === 'failed' &&
                      historyImport.error && (
                        <p className="text-destructive mt-2 text-sm">
                          {historyImport.error}
                        </p>
                      )}
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => void importHistory()}
                    disabled={disabled || actionPending || historyImportRunning}
                  >
                    {historyImportRunning || actionPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Download className="size-4" />
                    )}
                    {historyImport?.status === 'completed'
                      ? t('importAgain')
                      : t('importButton')}
                  </Button>
                </div>
                <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
                  {t('importPrivacy')}
                </p>
              </div>
              <Button
                className="mt-6"
                variant="outline"
                onClick={disconnect}
                disabled={disabled || actionPending}
              >
                {actionPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Unplug className="size-4" />
                )}
                {t('disconnect')}
              </Button>
            </div>
          ) : qrAvailable && status === 'awaiting_qr_scan' ? (
            <div className="flex max-w-md flex-col items-center">
              <div className="border-border rounded-2xl border bg-white p-3 shadow-sm">
                <Image
                  key={qrVersion}
                  src={`/api/whatsapp/qr?view=qr&v=${qrVersion}`}
                  alt={t('qrAlt')}
                  width={300}
                  height={300}
                  unoptimized
                  className="size-[min(300px,72vw)]"
                />
              </div>
              <h3 className="text-foreground mt-6 text-lg font-semibold">
                {t('scanTitle')}
              </h3>
              <p className="text-muted-foreground mt-2 text-base leading-relaxed">
                {t('scanInstructions')}
              </p>
              <Button
                className="mt-5"
                variant="outline"
                onClick={() => void connect()}
                disabled={disabled || actionPending}
              >
                <RefreshCw
                  className={`size-4 ${actionPending ? 'animate-spin' : ''}`}
                />
                {t('refreshQr')}
              </Button>
            </div>
          ) : (
            <div className="flex max-w-md flex-col items-center">
              <div className="bg-primary/10 ring-primary/5 mb-5 flex size-20 items-center justify-center rounded-full ring-8">
                {isBusy || actionPending ? (
                  <Loader2 className="text-primary size-9 animate-spin" />
                ) : (
                  <QrCode className="text-primary size-9" />
                )}
              </div>
              <h3 className="text-foreground text-xl font-semibold">
                {isBusy || actionPending ? t('generating') : t('readyTitle')}
              </h3>
              <p className="text-muted-foreground mt-2 text-base leading-relaxed">
                {isBusy || actionPending
                  ? t('generatingDescription')
                  : t('readyDescription')}
              </p>
              {error && (
                <Alert variant="destructive" className="mt-5 text-left">
                  <AlertTriangle className="size-4" />
                  <AlertTitle>{t('connectionProblem')}</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {!isBusy && !actionPending && (
                <Button
                  className="mt-6"
                  onClick={() => void connect()}
                  disabled={disabled}
                >
                  <QrCode className="size-4" />
                  {t('generateQr')}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('howToTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="text-muted-foreground space-y-4 text-sm">
              {[t('step1'), t('step2'), t('step3')].map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                    {index + 1}
                  </span>
                  <span className="pt-0.5 leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Alert>
          <ShieldCheck className="size-4" />
          <AlertTitle>{t('privacyTitle')}</AlertTitle>
          <AlertDescription>{t('privacyDescription')}</AlertDescription>
        </Alert>

        <Alert className="border-amber-500/30 bg-amber-500/5">
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
          <AlertTitle>{t('unofficialTitle')}</AlertTitle>
          <AlertDescription>{t('unofficialDescription')}</AlertDescription>
        </Alert>
      </div>
    </div>
  );
}
