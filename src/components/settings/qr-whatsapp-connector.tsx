'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Unplug,
  Copy,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  qr_version?: string | null;
  pairing_code_supported?: boolean;
  pairing_code?: string;
  last_error?: string | null;
  error?: string;
};

export function QrWhatsAppConnector({ disabled, channelId }: { disabled: boolean; channelId?: string }) {
  const t = useTranslations('Settings.whatsapp.qr');
  const endpoint = channelId ? `/api/whatsapp/qr?channel_id=${encodeURIComponent(channelId)}` : '/api/whatsapp/qr';
  const [status, setStatus] = useState<QrStatus>('loading');
  const [qrAvailable, setQrAvailable] = useState(false);
  const [qrVersion, setQrVersion] = useState('');
  const [pairingCodeSupported, setPairingCodeSupported] = useState(false);
  const [pairingPhone, setPairingPhone] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [showPairingForm, setShowPairingForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const initialized = useRef(false);
  const pairingCodeSupportedRef = useRef(false);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      const data = (await response.json()) as StatusPayload;
      if (!response.ok) throw new Error(data.error || t('statusError'));

      const nextStatus = data.status ?? 'disconnected';
      pairingCodeSupportedRef.current = data.pairing_code_supported === true;
      setPairingCodeSupported(data.pairing_code_supported === true);
      setStatus(nextStatus);
      setQrAvailable(data.qr_available === true);
      setError(data.last_error ?? null);
      if (data.qr_available) {
        // Evolution rotates QR strings on its own timer. Keep the displayed
        // image steady between those rotations instead of reloading it on
        // every status poll. The legacy connector has no QR fingerprint.
        const nextQrVersion = data.qr_version ?? Date.now().toString();
        setQrVersion((current) =>
          current === nextQrVersion ? current : nextQrVersion
        );
      } else {
        setQrVersion('');
      }
      return nextStatus;
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : t('statusError');
      setStatus('error');
      setQrAvailable(false);
      setError(message);
      return 'error' as const;
    }
  }, [t, endpoint]);

  const connect = useCallback(
    async (method: 'qr' | 'pairing_code' = 'qr', phone = '') => {
      if (disabled) return;
      setActionPending(true);
      setError(null);
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            method === 'pairing_code' ? { method, phone } : { method }
          ),
        });
        const data = (await response.json()) as StatusPayload;
        if (!response.ok) throw new Error(data.error || t('connectError'));
        setPairingCode(
          method === 'pairing_code' ? (data.pairing_code ?? '') : ''
        );
        setShowPairingForm(false);
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
    },
    [disabled, loadStatus, t, endpoint]
  );

  useEffect(() => {
    let active = true;

    async function initialize() {
      const current = await loadStatus();
      if (
        active &&
        !initialized.current &&
        !disabled &&
        !pairingCodeSupportedRef.current &&
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
      const response = await fetch(endpoint, { method: 'DELETE' });
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

  const isBusy = ['loading', 'starting', 'connecting', 'reconnecting'].includes(
    status
  );
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
          ) : qrAvailable &&
            status === 'awaiting_qr_scan' &&
            !showPairingForm &&
            !pairingCode ? (
            <div className="flex max-w-md flex-col items-center">
              <div className="border-border rounded-2xl border bg-white p-3 shadow-sm">
                <Image
                  key={qrVersion}
                  src={`${endpoint}${channelId ? '&' : '?'}view=qr&v=${encodeURIComponent(qrVersion)}`}
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
              {pairingCodeSupported && (
                <Button
                  className="mt-3"
                  variant="ghost"
                  onClick={() => {
                    setShowPairingForm(true);
                    setPairingCode('');
                  }}
                  disabled={disabled || actionPending}
                >
                  {t('usePairingCode')}
                </Button>
              )}
            </div>
          ) : pairingCode ? (
            <div className="flex max-w-md flex-col items-center">
              <div className="bg-muted rounded-xl px-6 py-4 font-mono text-3xl font-bold tracking-[0.2em]">
                {pairingCode}
              </div>
              <h3 className="text-foreground mt-6 text-lg font-semibold">
                {t('pairingCodeTitle')}
              </h3>
              <p className="text-muted-foreground mt-2 text-base leading-relaxed">
                {t('pairingCodeInstructions')}
              </p>
              <Button
                className="mt-5"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(pairingCode);
                  toast.success(t('codeCopied'));
                }}
              >
                <Copy className="size-4" />
                {t('copyCode')}
              </Button>
              <Button
                className="mt-2"
                variant="ghost"
                onClick={() => {
                  setPairingCode('');
                  setShowPairingForm(false);
                  void connect('qr');
                }}
                disabled={disabled || actionPending}
              >
                {t('useQrInstead')}
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
              {!isBusy &&
              !actionPending &&
              pairingCodeSupported &&
              showPairingForm ? (
                <div className="mt-6 w-full space-y-3 text-left">
                  <label
                    htmlFor="whatsapp-pairing-phone"
                    className="text-sm font-medium"
                  >
                    {t('phoneLabel')}
                  </label>
                  <Input
                    id="whatsapp-pairing-phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder={t('phonePlaceholder')}
                    value={pairingPhone}
                    onChange={(event) => setPairingPhone(event.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">
                    {t('phoneHint')}
                  </p>
                  <div className="flex justify-center gap-2">
                    <Button
                      onClick={() => void connect('pairing_code', pairingPhone)}
                      disabled={
                        disabled || !/^\D*(?:\d\D*){8,15}$/.test(pairingPhone)
                      }
                    >
                      {t('generatePairingCode')}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setShowPairingForm(false)}
                    >
                      {t('cancelPairing')}
                    </Button>
                  </div>
                </div>
              ) : (
                !isBusy &&
                !actionPending && (
                  <div className="mt-6 flex flex-wrap justify-center gap-2">
                    <Button
                      onClick={() => void connect('qr')}
                      disabled={disabled}
                    >
                      <QrCode className="size-4" />
                      {t('generateQr')}
                    </Button>
                    {pairingCodeSupported && (
                      <Button
                        variant="outline"
                        onClick={() => setShowPairingForm(true)}
                        disabled={disabled}
                      >
                        {t('usePairingCode')}
                      </Button>
                    )}
                  </div>
                )
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
