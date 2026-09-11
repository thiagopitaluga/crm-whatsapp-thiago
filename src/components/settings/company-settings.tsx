'use client';

import { useEffect, useRef, useState } from 'react';
import { Building2, CircleAlert, Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsPanelHead } from './settings-panel-head';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

export function CompanySettings() {
  const t = useTranslations('Settings.company');
  const { account, isOwner, profileLoading, refreshProfile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [pendingLogo, setPendingLogo] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!account) return;
    setName(account.name);
  }, [account]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const currentLogo = previewUrl ?? (!removeLogo ? account?.logo_url ?? null : null);
  const initial = (name || account?.name || 'E').trim().charAt(0).toUpperCase();
  const dirty = Boolean(
    account && (
      name.trim() !== account.name ||
      pendingLogo !== null ||
      removeLogo
    ),
  );

  function pickLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!ALLOWED_MIME.has(file.type)) {
      toast.error(t('unsupportedImage'), { description: t('unsupportedImageDesc') });
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error(t('imageTooLarge'), { description: t('imageTooLargeDesc') });
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingLogo(file);
    setPreviewUrl(URL.createObjectURL(file));
    setRemoveLogo(false);
  }

  function clearLogo() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingLogo(null);
    setPreviewUrl(null);
    setRemoveLogo(true);
  }

  async function requestJson(url: string, options: RequestInit) {
    const response = await fetch(url, options);
    if (response.ok) return response.json();
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || t('saveFailed'));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!account || !isOwner) return;

    const nextName = name.trim();
    if (!nextName) {
      toast.error(t('nameRequired'));
      return;
    }

    setSaving(true);
    try {
      if (nextName !== account.name) {
        await requestJson('/api/account', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: nextName }),
        });
      }

      if (pendingLogo) {
        const formData = new FormData();
        formData.set('logo', pendingLogo);
        await requestJson('/api/account/logo', { method: 'POST', body: formData });
      } else if (removeLogo && account.logo_url) {
        await requestJson('/api/account/logo', { method: 'DELETE' });
      }

      setPendingLogo(null);
      setPreviewUrl(null);
      setRemoveLogo(false);
      await refreshProfile();
      toast.success(t('saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <form onSubmit={save} className="space-y-4">
        <Card>
          <CardContent className="space-y-6">
            {!isOwner && !profileLoading ? (
              <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                <p>{t('ownerOnly')}</p>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-5">
              <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted">
                {currentLogo ? (
                  <img src={currentLogo} alt={name || t('logoLabel')} className="size-full object-contain" />
                ) : (
                  <span className="text-xl font-semibold text-primary">{initial}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <Label className="text-foreground">{t('logoLabel')}</Label>
                <p className="mt-1 text-sm text-muted-foreground">{t('logoHint')}</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={pickLogo}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!isOwner || saving || profileLoading}
                  >
                    <Upload className="size-4" />
                    {currentLogo ? t('changeLogo') : t('uploadLogo')}
                  </Button>
                  {currentLogo ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={clearLogo}
                      disabled={!isOwner || saving || profileLoading}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                      {t('removeLogo')}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="company-name" className="text-foreground">{t('nameLabel')}</Label>
              <Input
                id="company-name"
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('namePlaceholder')}
                disabled={!isOwner || saving || profileLoading}
                className="bg-muted"
              />
            </div>

            <Button
              type="submit"
              disabled={!isOwner || saving || profileLoading || !dirty}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Building2 className="size-4" />}
              {saving ? t('saving') : t('save')}
            </Button>
          </CardContent>
        </Card>
      </form>
    </section>
  );
}
