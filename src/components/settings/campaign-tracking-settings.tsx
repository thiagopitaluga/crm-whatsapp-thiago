'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Copy,
  ExternalLink,
  Loader2,
  MousePointerClick,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';

import { RequireRole } from '@/components/auth/require-role';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SettingsPanelHead } from './settings-panel-head';

interface TrackingLink {
  id: string;
  slug: string;
  whatsapp_number: string;
  default_message: string | null;
  is_active: boolean;
  created_at: string;
}

export function CampaignTrackingSettings() {
  const [links, setLinks] = useState<TrackingLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [slug, setSlug] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [defaultMessage, setDefaultMessage] = useState('');

  const publicBaseUrl = useMemo(
    () => (typeof window === 'undefined' ? '' : window.location.origin),
    []
  );

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/account/tracking-links', {
        cache: 'no-store',
      });
      const payload = (await response.json().catch(() => ({}))) as {
        links?: TrackingLink[];
        error?: string;
      };
      if (!response.ok) {
        toast.error(payload.error ?? 'Não foi possível carregar os links.');
        return;
      }
      setLinks(payload.links ?? []);
    } catch (error) {
      console.error('[CampaignTrackingSettings] load error:', error);
      toast.error('Não foi possível carregar os links.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createLink() {
    setCreating(true);
    try {
      const response = await fetch('/api/account/tracking-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, whatsappNumber, defaultMessage }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        link?: TrackingLink;
        error?: string;
      };
      if (!response.ok || !payload.link) {
        toast.error(payload.error ?? 'Não foi possível criar o link.');
        return;
      }
      setLinks((current) => [payload.link!, ...current]);
      setSlug('');
      setWhatsappNumber('');
      setDefaultMessage('');
      toast.success('Link de rastreamento criado.');
    } catch (error) {
      console.error('[CampaignTrackingSettings] create error:', error);
      toast.error('Não foi possível criar o link.');
    } finally {
      setCreating(false);
    }
  }

  async function copyLink(link: TrackingLink) {
    const url = `${publicBaseUrl}/w/${link.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copiado.');
    } catch {
      toast.error('Não foi possível copiar o link.');
    }
  }

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title="Rastreamento de campanhas"
        description="Crie um link por origem ou campanha. Ele salva UTMs, gclid e fbclid antes de abrir o WhatsApp e associa esses dados ao contato quando a conversa começar."
      />

      <RequireRole min="admin">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="tracking-slug">Identificador do link</Label>
                <Input
                  id="tracking-slug"
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  placeholder="morgana-meta-lotes"
                  autoCapitalize="none"
                />
                <p className="text-muted-foreground text-xs">
                  Use letras minúsculas, números e hífens.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tracking-whatsapp">WhatsApp de destino</Label>
                <Input
                  id="tracking-whatsapp"
                  value={whatsappNumber}
                  onChange={(event) => setWhatsappNumber(event.target.value)}
                  placeholder="5511999999999"
                  inputMode="tel"
                />
                <p className="text-muted-foreground text-xs">
                  Informe o número com DDI e DDD, sem o sinal de +.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tracking-message">
                Mensagem inicial opcional
              </Label>
              <Textarea
                id="tracking-message"
                value={defaultMessage}
                onChange={(event) => setDefaultMessage(event.target.value)}
                placeholder="Olá! Quero saber mais sobre os lotes."
                rows={3}
              />
            </div>
            <Button
              onClick={createLink}
              disabled={creating || !slug.trim() || !whatsappNumber.trim()}
            >
              {creating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Criar link rastreável
            </Button>
          </CardContent>
        </Card>
      </RequireRole>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="text-primary size-6 animate-spin" />
        </div>
      ) : links.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-10 text-center">
            <MousePointerClick className="text-muted-foreground size-6" />
            <p className="mt-3 text-sm font-medium">Nenhum link criado ainda</p>
            <p className="text-muted-foreground mt-1 max-w-md text-sm">
              Use o link criado aqui no botão de WhatsApp da landing page ou
              como URL de destino das campanhas.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {links.map((link) => {
            const url = `${publicBaseUrl}/w/${link.slug}`;
            return (
              <Card key={link.id}>
                <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">/{link.slug}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {url}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      Destino: +{link.whatsapp_number}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyLink(link)}
                    >
                      <Copy className="size-4" />
                      Copiar
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Abrir link de rastreamento"
                      onClick={() =>
                        window.open(url, '_blank', 'noopener,noreferrer')
                      }
                    >
                      <ExternalLink className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
