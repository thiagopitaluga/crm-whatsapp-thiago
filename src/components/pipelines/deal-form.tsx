'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { CURRENCIES } from '@/lib/currency';
import type { Contact, PipelineStage, Profile } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MessageSquare, DollarSign } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
interface DealFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  stages: PipelineStage[];
  defaultStageId?: string;
  onSaved: () => void;
}
/** Creation only. Existing deals are managed through the shared contact sheet. */
export function DealForm({
  open,
  onOpenChange,
  pipelineId,
  stages,
  defaultStageId,
  onSaved,
}: DealFormProps) {
  const t = useTranslations('Pipelines.form');
  const { accountId, user, defaultCurrency } = useAuth();
  const [title, setTitle] = useState(''),
    [value, setValue] = useState(''),
    [currency, setCurrency] = useState(defaultCurrency),
    [contactId, setContactId] = useState(''),
    [stageId, setStageId] = useState(''),
    [assignedTo, setAssignedTo] = useState(''),
    [notes, setNotes] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]),
    [profiles, setProfiles] = useState<Profile[]>([]),
    [saving, setSaving] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    setTitle('');
    setValue('');
    setCurrency(defaultCurrency);
    setContactId('');
    setStageId(defaultStageId || stages[0]?.id || '');
    setAssignedTo('');
    setNotes('');
    setContacts([]);
    setProfiles([]);
    const db = createClient();
    void (async () => {
      const [contactsResult, membership] = await Promise.all([
        db
          .from('contacts')
          .select('*')
          .eq('account_id', accountId)
          .order('name'),
        db
          .from('account_memberships')
          .select('user_id')
          .eq('account_id', accountId),
      ]);
      if (cancelled) return;
      if (contactsResult.error || membership.error) {
        toast.error('Não foi possível carregar os dados.');
        return;
      }
      setContacts(contactsResult.data ?? []);
      const ids = (membership.data ?? []).map((row) => row.user_id);
      if (ids.length) {
        const result = await db
          .from('profiles')
          .select('*')
          .in('user_id', ids)
          .order('full_name');
        if (!cancelled) setProfiles(result.data ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, accountId, defaultCurrency, defaultStageId, stages]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const selectedContact = contacts.find((contact) => contact.id === contactId);
  const whatsappUrl = selectedContact?.phone
    ? 'https://wa.me/' + selectedContact.phone.replace(/\D/g, '')
    : null;
  async function handleSave() {
    if (saving) return;
    if (
      !title.trim() ||
      !contactId ||
      !stageId ||
      !stages.some((stage) => stage.id === stageId)
    ) {
      toast.error(t('toastRequired'));
      return;
    }
    if (!user || !accountId) return;
    setSaving(true);
    try {
      const { error } = await createClient()
        .from('deals')
        .insert({
          title: title.trim(),
          value: Number(value) || 0,
          currency,
          contact_id: contactId,
          pipeline_id: pipelineId,
          stage_id: stageId,
          assigned_to: assignedTo || null,
          notes: notes.trim() || null,
          user_id: user.id,
          account_id: accountId,
          status: 'open',
        });
      if (error) throw error;
      toast.success(t('toastCreated'));
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error(t('toastFailedCreate'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b p-4 pr-12">
          <DialogTitle>{t('newDeal')}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t('title')}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('titlePlaceholder')}
              className="border-border bg-muted text-foreground"
            />
          </div>

          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t('contact')}</Label>
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className="border-border bg-muted text-foreground focus:border-primary focus:ring-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none focus:ring-1"
            >
              <option value="">{t('selectContact')}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.phone}
                </option>
              ))}
            </select>

            {whatsappUrl && (
              <Link
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-primary/10 text-primary hover:bg-primary/20 mt-1 inline-flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs"
              >
                <MessageSquare className="h-3 w-3" />
                {t('callOnWhatsApp')}
              </Link>
            )}
          </div>

          <div className="grid grid-cols-[1fr_110px] gap-3">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t('value')}</Label>
              <div className="relative">
                <DollarSign className="text-muted-foreground absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2" />
                <Input
                  type="number"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="0"
                  className="border-border bg-muted text-foreground pl-7"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t('currency')}</Label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="border-border bg-muted text-foreground focus:border-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none"
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t('stage')}</Label>
            <select
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
              className="border-border bg-muted text-foreground focus:border-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none"
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t('assignedTo')}</Label>
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="border-border bg-muted text-foreground focus:border-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none"
            >
              <option value="">{t('unassigned')}</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t('notes')}</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('notesPlaceholder')}
              className="border-border bg-muted text-foreground min-h-[100px]"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={saving} onClick={() => void handleSave()}>
            {saving ? 'Salvando…' : 'Criar negócio'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
