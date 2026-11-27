'use client';

import { useEffect, useState } from 'react';
import { Loader2, MessageSquare, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { QuickReply } from '@/types';
import { interactivePayloadPreviewText } from '@/lib/whatsapp/interactive';

interface QuickReplyPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (qr: QuickReply) => void;
}

/**
 * Lists the account's saved quick replies for insertion into the
 * composer. Text snippets fill the textarea; interactive snippets open
 * the builder pre-filled (handled by the caller's `onPick`).
 */
export function QuickReplyPicker({
  open,
  onOpenChange,
  onPick,
}: QuickReplyPickerProps) {
  const t = useTranslations('Inbox.composer');
  const [items, setItems] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false),
    [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(''),
    [content, setContent] = useState('');
  async function save() {
    if (!title.trim() || !content.trim() || saving) return;
    setSaving(true);
    try {
      const response = await fetch('/api/quick-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          kind: 'text',
          content_text: content.trim(),
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || 'Falha ao salvar mensagem.');
      const refresh = await fetch('/api/quick-replies', { cache: 'no-store' });
      if (!refresh.ok)
        throw new Error('Mensagem salva. Reabra para atualizar a lista.');
      setItems((await refresh.json()).quick_replies ?? []);
      setCreating(false);
      setTitle('');
      setContent('');
      toast.success('Mensagem rápida cadastrada.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch('/api/quick-replies', { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setItems((data.quick_replies as QuickReply[]) ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('quickReplies')}</DialogTitle>
        </DialogHeader>
        <Button
          variant="outline"
          onClick={() => setCreating((value) => !value)}
        >
          {creating ? 'Fechar cadastro' : '+ Nova mensagem rápida'}
        </Button>
        {creating && (
          <div className="space-y-2 rounded-lg border p-3">
            <label className="block text-sm">
              Nome
              <input
                className="bg-background mt-1 w-full rounded border p-2"
                value={title}
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="block text-sm">
              Mensagem
              <textarea
                className="bg-background mt-1 min-h-24 w-full rounded border p-2"
                value={content}
                onChange={(event) => setContent(event.target.value)}
              />
            </label>
            <Button
              disabled={saving || !title.trim() || !content.trim()}
              onClick={() => void save()}
            >
              {saving ? 'Salvando…' : 'Salvar mensagem'}
            </Button>
          </div>
        )}
        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {t('quickRepliesEmpty')}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {items.map((qr) => (
                <li key={qr.id}>
                  <button
                    type="button"
                    onClick={() => onPick(qr)}
                    className="border-border bg-muted/40 hover:border-primary/50 hover:bg-muted flex w-full items-start gap-2 rounded-md border p-2.5 text-left"
                  >
                    {qr.kind === 'interactive' ? (
                      <Zap className="text-primary mt-0.5 h-4 w-4 shrink-0" />
                    ) : (
                      <MessageSquare className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground block truncate text-sm font-medium">
                        {qr.title}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {qr.kind === 'interactive' && qr.interactive_payload
                          ? interactivePayloadPreviewText(
                              qr.interactive_payload
                            )
                          : qr.content_text}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
