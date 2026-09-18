'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { addContactTag, deleteContactTag } from '@/lib/contacts/tag-api';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { toast } from 'sonner';
import type {
  Contact,
  Tag,
  ContactTag,
  ContactNote,
  CustomField,
  ContactCustomValue,
  Deal,
  MessageTemplate,
} from '@/types';
import {
  TemplatePicker,
  type TemplateSendValues,
} from '@/components/inbox/template-picker';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Phone,
  Mail,
  Building2,
  Copy,
  Check,
  Loader2,
  Plus,
  Trash2,
  Save,
  X,
  DollarSign,
  Megaphone,
  MousePointerClick,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

export type ContactDetailTab =
  'details' | 'tags' | 'notes' | 'custom' | 'attribution' | 'deals';

interface MetaConversationAttribution {
  id: string;
  attribution_type: string;
  source_id: string | null;
  ctwa_clid: string | null;
  headline: string | null;
  source_url: string | null;
  meta_ad_account_id: string | null;
  meta_campaign_id: string | null;
  meta_campaign_name: string | null;
  meta_adset_id: string | null;
  meta_adset_name: string | null;
  meta_ad_id: string | null;
  meta_ad_name: string | null;
  meta_marketing_resolved_at: string | null;
  created_at: string;
}

interface AttributionTouchpoint {
  id: string;
  provider: string;
  method: string;
  source_platform: string | null;
  source_channel: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
  fbclid: string | null;
  msclkid: string | null;
  landing_url: string | null;
  referrer: string | null;
  occurred_at: string;
}

function AttributionField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
        {label}
      </p>
      <p className="text-foreground truncate text-xs" title={value}>
        {value}
      </p>
    </div>
  );
}

interface ContactDetailViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string | null;
  /** Select a relevant existing tab when opened from a row action. */
  initialTab?: ContactDetailTab;
  onUpdated: () => void;
}

export function ContactDetailView({
  open,
  onOpenChange,
  contactId,
  initialTab = 'details',
  onUpdated,
}: ContactDetailViewProps) {
  const t = useTranslations('Contacts.detailView');
  const supabase = createClient();
  const { accountId, defaultCurrency } = useAuth();

  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);

  // Send template — lets the business initiate (or re-open) a conversation
  // with this contact by sending an approved template. The send route
  // find-or-creates the conversation, so no inbound message is required.
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [sendingTemplate, setSendingTemplate] = useState(false);

  // Details tab
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);

  // Tags tab
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [contactTagIds, setContactTagIds] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);

  // Notes tab
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // Custom fields tab
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [savingCustom, setSavingCustom] = useState(false);
  const [loadingCustom, setLoadingCustom] = useState(false);

  // Deals tab
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(false);
  // Attribution tab — acquisition history stays normalized outside custom
  // fields so one contact can retain multiple campaigns and conversations.
  const [metaAttributions, setMetaAttributions] = useState<
    MetaConversationAttribution[]
  >([]);
  const [touchpoints, setTouchpoints] = useState<AttributionTouchpoint[]>([]);
  const [loadingAttribution, setLoadingAttribution] = useState(false);
  const [activeTab, setActiveTab] = useState<ContactDetailTab>(initialTab);

  const fetchContact = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);

    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .single();

    if (data) {
      setContact(data);
      setEditName(data.name ?? '');
      setEditPhone(data.phone);
      setEditEmail(data.email ?? '');
      setEditCompany(data.company ?? '');
    }
    setLoading(false);
  }, [contactId, supabase]);

  const fetchTags = useCallback(async () => {
    if (!contactId) return;

    const [tagsRes, contactTagsRes] = await Promise.all([
      supabase.from('tags').select('*').order('name'),
      supabase
        .from('contact_tags')
        .select('tag_id')
        .eq('contact_id', contactId),
    ]);

    if (tagsRes.data) setAllTags(tagsRes.data);
    if (contactTagsRes.data) {
      setContactTagIds(contactTagsRes.data.map((ct) => ct.tag_id));
    }
  }, [contactId, supabase]);

  const fetchNotes = useCallback(async () => {
    if (!contactId) return;
    setLoadingNotes(true);

    const { data } = await supabase
      .from('contact_notes')
      .select('*')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });

    if (data) setNotes(data);
    setLoadingNotes(false);
  }, [contactId, supabase]);

  const fetchCustomFields = useCallback(async () => {
    if (!contactId) return;
    setLoadingCustom(true);

    const [fieldsRes, valuesRes] = await Promise.all([
      supabase.from('custom_fields').select('*').order('field_name'),
      supabase
        .from('contact_custom_values')
        .select('*')
        .eq('contact_id', contactId),
    ]);

    if (fieldsRes.data) setCustomFields(fieldsRes.data);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      valuesRes.data.forEach((v) => {
        map[v.custom_field_id] = v.value ?? '';
      });
      setCustomValues(map);
    }
    setLoadingCustom(false);
  }, [contactId, supabase]);

  const fetchDeals = useCallback(async () => {
    if (!contactId) return;
    setLoadingDeals(true);
    const { data } = await supabase
      .from('deals')
      .select('*, stage:pipeline_stages(*)')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });
    setDeals((data ?? []) as Deal[]);
    setLoadingDeals(false);
  }, [contactId, supabase]);

  const fetchAttribution = useCallback(async () => {
    if (!contactId) return;
    setLoadingAttribution(true);
    const [metaRes, touchpointsRes] = await Promise.all([
      supabase
        .from('conversation_attributions')
        .select(
          'id, attribution_type, source_id, ctwa_clid, headline, source_url, meta_ad_account_id, meta_campaign_id, meta_campaign_name, meta_adset_id, meta_adset_name, meta_ad_id, meta_ad_name, meta_marketing_resolved_at, created_at'
        )
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false }),
      supabase
        .from('attribution_touchpoints')
        .select(
          'id, provider, method, source_platform, source_channel, utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, msclkid, landing_url, referrer, occurred_at'
        )
        .eq('contact_id', contactId)
        .order('occurred_at', { ascending: false }),
    ]);
    setMetaAttributions(
      (metaRes.data ?? []) as MetaConversationAttribution[]
    );
    setTouchpoints((touchpointsRes.data ?? []) as AttributionTouchpoint[]);
    setLoadingAttribution(false);
  }, [contactId, supabase]);

  useEffect(() => {
    if (open && contactId) {
      fetchContact();
      fetchTags();
      fetchNotes();
      fetchCustomFields();
      fetchDeals();
      fetchAttribution();
    }
  }, [
    open,
    contactId,
    fetchContact,
    fetchTags,
    fetchNotes,
    fetchCustomFields,
    fetchDeals,
    fetchAttribution,
  ]);

  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [contactId, initialTab, open]);

  async function copyPhone() {
    if (!contact) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  }

  async function saveDetails() {
    if (!contactId || !editPhone.trim()) {
      toast.error(t('toastPhoneRequired'));
      return;
    }

    setSavingDetails(true);
    const { error } = await supabase
      .from('contacts')
      .update({
        name: editName.trim() || null,
        phone: editPhone.trim(),
        email: editEmail.trim() || null,
        company: editCompany.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId);

    if (error) {
      toast.error(t('toastUpdateFailed'));
    } else {
      toast.success(t('toastUpdated'));
      fetchContact();
      onUpdated();
    }
    setSavingDetails(false);
  }

  async function toggleTag(tagId: string) {
    if (!contactId) return;
    setSavingTags(true);

    const isSelected = contactTagIds.includes(tagId);

    try {
      if (isSelected) {
        await deleteContactTag(contactId, tagId);
        setContactTagIds((prev) => prev.filter((id) => id !== tagId));
      } else {
        await addContactTag(contactId, tagId);
        setContactTagIds((prev) => [...prev, tagId]);
      }
      onUpdated();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('toastUpdateFailed')
      );
    }
    setSavingTags(false);
  }

  async function addNote() {
    if (!contactId || !newNote.trim()) return;
    setSavingNote(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user || !accountId) {
      toast.error(t('toastNotAuthenticated'));
      setSavingNote(false);
      return;
    }

    const { error } = await supabase.from('contact_notes').insert({
      contact_id: contactId,
      account_id: accountId,
      user_id: user.id,
      note_text: newNote.trim(),
    });

    if (error) {
      toast.error(t('toastNoteAddFailed'));
    } else {
      setNewNote('');
      fetchNotes();
      toast.success(t('toastNoteAdded'));
    }
    setSavingNote(false);
  }

  async function deleteNote(noteId: string) {
    const { error } = await supabase
      .from('contact_notes')
      .delete()
      .eq('id', noteId);

    if (error) {
      toast.error(t('toastNoteDeleteFailed'));
    } else {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      toast.success(t('toastNoteDeleted'));
    }
  }

  async function saveCustomFields() {
    if (!contactId) return;
    setSavingCustom(true);

    try {
      // Delete existing values and re-insert
      await supabase
        .from('contact_custom_values')
        .delete()
        .eq('contact_id', contactId);

      const rows = Object.entries(customValues)
        .filter(([, val]) => val.trim())
        .map(([fieldId, val]) => ({
          contact_id: contactId,
          custom_field_id: fieldId,
          value: val.trim(),
        }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from('contact_custom_values')
          .insert(rows);
        if (error) throw error;
      }

      toast.success(t('toastCustomFieldsSaved'));
    } catch {
      toast.error(t('toastCustomFieldsFailed'));
    }
    setSavingCustom(false);
  }

  async function handleSendTemplate(
    template: MessageTemplate,
    values: TemplateSendValues
  ) {
    if (!contactId) return;
    setSendingTemplate(true);
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // No conversation_id — the route find-or-creates one for this
          // contact, mirroring the inbox template-send payload otherwise.
          contact_id: contactId,
          message_type: 'template',
          template_name: template.name,
          template_language: template.language,
          template_message_params: {
            body: values.body,
            headerText: values.headerText,
            buttonParams: values.buttonParams,
          },
          template_params: values.body,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reason = payload?.error || `HTTP ${res.status}`;
        toast.error(t('toastTemplateFailed', { reason }));
        return;
      }

      toast.success(t('toastTemplateSent', { name: template.name }));
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'network error';
      toast.error(`Failed to send template: ${reason}`);
    } finally {
      setSendingTemplate(false);
    }
  }

  function getInitials(name?: string | null) {
    if (!name) return '?';
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="bg-popover border-border text-popover-foreground w-full p-0 sm:max-w-lg"
        >
          {loading || !contact ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="text-primary size-6 animate-spin" />
            </div>
          ) : (
            <div className="flex h-full flex-col">
              {/* Header */}
              <SheetHeader className="border-border/50 border-b p-4">
                <div className="flex items-center gap-3">
                  <Avatar className="bg-muted border-border size-12 border">
                    <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                      {getInitials(contact.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <SheetTitle className="text-popover-foreground truncate">
                      {contact.name || t('unnamed')}
                    </SheetTitle>
                    <SheetDescription className="text-muted-foreground mt-0.5 text-xs">
                      {t('contactDetailsDesc')}
                    </SheetDescription>
                    <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-3 text-xs">
                      <button
                        onClick={copyPhone}
                        className="hover:text-primary flex cursor-pointer items-center gap-1 transition-colors"
                      >
                        <Phone className="size-3" />
                        {contact.phone}
                        {copiedPhone ? (
                          <Check className="text-primary size-3" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                      </button>
                      {contact.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="size-3" />
                          {contact.email}
                        </span>
                      )}
                      {contact.company && (
                        <span className="flex items-center gap-1">
                          <Building2 className="size-3" />
                          {contact.company}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {/* Template sending remains available through the existing
                    picker/API, but is intentionally hidden from this contact
                    profile until the workflow is reintroduced. */}
              </SheetHeader>

              {/* Tabs */}
              <Tabs
                value={activeTab}
                onValueChange={(value) =>
                  setActiveTab(value as ContactDetailTab)
                }
                className="flex min-h-0 flex-1 flex-col"
              >
                <TabsList className="border-border bg-muted/50 mx-4 mt-3 grid h-auto w-[calc(100%-2rem)] grid-cols-3 gap-1 rounded-xl border p-1">
                  <TabsTrigger
                    value="details"
                    className="h-8 min-w-0 px-2 text-xs data-active:bg-background data-active:text-primary"
                  >
                    {t('tabs.details')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="tags"
                    className="h-8 min-w-0 px-2 text-xs data-active:bg-background data-active:text-primary"
                  >
                    {t('tabs.tags')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="notes"
                    className="h-8 min-w-0 px-2 text-xs data-active:bg-background data-active:text-primary"
                  >
                    {t('tabs.notes')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="custom"
                    className="h-8 min-w-0 px-2 text-xs data-active:bg-background data-active:text-primary"
                  >
                    <span className="sm:hidden">Campos</span>
                    <span className="hidden sm:inline">{t('tabs.custom')}</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="attribution"
                    className="h-8 min-w-0 px-2 text-xs data-active:bg-background data-active:text-primary"
                  >
                    Atribuição
                  </TabsTrigger>
                  <TabsTrigger
                    value="deals"
                    className="h-8 min-w-0 px-2 text-xs data-active:bg-background data-active:text-primary"
                  >
                    {t('tabs.deals')}
                  </TabsTrigger>
                </TabsList>

                {/* Details Tab */}
                <TabsContent
                  value="details"
                  className="flex-1 overflow-y-auto px-4 py-3"
                >
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-muted-foreground text-xs">
                        {t('name')}
                      </Label>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="bg-muted border-border text-foreground h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-muted-foreground text-xs">
                        {t('phone')} <span className="text-red-400">*</span>
                      </Label>
                      <Input
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        className="bg-muted border-border text-foreground h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-muted-foreground text-xs">
                        {t('email')}
                      </Label>
                      <Input
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        className="bg-muted border-border text-foreground h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-muted-foreground text-xs">
                        {t('company')}
                      </Label>
                      <Input
                        value={editCompany}
                        onChange={(e) => setEditCompany(e.target.value)}
                        className="bg-muted border-border text-foreground h-8 text-sm"
                      />
                    </div>
                    <Button
                      onClick={saveDetails}
                      disabled={savingDetails}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
                      size="sm"
                    >
                      {savingDetails ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Save className="size-3.5" />
                      )}
                      {t('saveChangesBtn')}
                    </Button>
                  </div>
                </TabsContent>

                {/* Tags Tab */}
                <TabsContent
                  value="tags"
                  className="flex-1 overflow-y-auto px-4 py-3"
                >
                  <div className="space-y-3">
                    <p className="text-muted-foreground text-xs">
                      {t('tagsTab.clickTagDesc')}
                    </p>
                    {allTags.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        {t('tagsTab.noTagsAvailable')}
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {allTags.map((tag) => {
                          const selected = contactTagIds.includes(tag.id);
                          return (
                            <button
                              key={tag.id}
                              onClick={() => toggleTag(tag.id)}
                              disabled={savingTags}
                              className={`inline-flex cursor-pointer items-center rounded-full px-3 py-1 text-xs font-medium transition-all ${
                                selected
                                  ? 'ring-primary ring-offset-border ring-2 ring-offset-1'
                                  : 'opacity-50 hover:opacity-80'
                              }`}
                              style={{
                                backgroundColor: tag.color + '20',
                                color: tag.color,
                              }}
                            >
                              {selected && <Check className="mr-1 size-3" />}
                              {tag.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </TabsContent>

                {/* Notes Tab */}
                <TabsContent
                  value="notes"
                  className="flex min-h-0 flex-1 flex-col px-4 py-3"
                >
                  <div className="mb-3 space-y-2">
                    <Textarea
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder={t('notesTab.placeholder')}
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground min-h-[60px] resize-none text-sm"
                    />
                    <Button
                      onClick={addNote}
                      disabled={!newNote.trim() || savingNote}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground"
                      size="sm"
                    >
                      {savingNote ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Plus className="size-3.5" />
                      )}
                      {t('notesTab.save')}
                    </Button>
                  </div>

                  <div className="flex-1 space-y-2 overflow-y-auto">
                    {loadingNotes ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="text-muted-foreground size-5 animate-spin" />
                      </div>
                    ) : notes.length === 0 ? (
                      <p className="text-muted-foreground py-8 text-center text-sm">
                        {t('notesTab.noNotes')}
                      </p>
                    ) : (
                      notes.map((note) => (
                        <div
                          key={note.id}
                          className="bg-muted/50 border-border/50 group rounded-lg border p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-muted-foreground flex-1 text-sm whitespace-pre-wrap">
                              {note.note_text}
                            </p>
                            <button
                              onClick={() => deleteNote(note.id)}
                              className="text-muted-foreground shrink-0 cursor-pointer opacity-0 transition-all group-hover:opacity-100 hover:text-red-400"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                          <p className="text-muted-foreground mt-1.5 text-xs">
                            {new Date(note.created_at).toLocaleDateString(
                              'en-US',
                              {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              }
                            )}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </TabsContent>

                {/* Custom Fields Tab */}
                <TabsContent
                  value="custom"
                  className="flex-1 overflow-y-auto px-4 py-3"
                >
                  {loadingCustom ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="text-muted-foreground size-5 animate-spin" />
                    </div>
                  ) : customFields.length === 0 ? (
                    <p className="text-muted-foreground py-8 text-center text-sm">
                      {t('noCustomFields')}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {customFields.map((field) => (
                        <div key={field.id} className="space-y-1.5">
                          <Label className="text-muted-foreground text-xs capitalize">
                            {field.field_name}
                          </Label>
                          <Input
                            value={customValues[field.id] ?? ''}
                            onChange={(e) =>
                              setCustomValues((prev) => ({
                                ...prev,
                                [field.id]: e.target.value,
                              }))
                            }
                            placeholder={t('enterCustomField', {
                              name: field.field_name,
                            })}
                            className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-sm"
                          />
                        </div>
                      ))}
                      <Button
                        onClick={saveCustomFields}
                        disabled={savingCustom}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
                        size="sm"
                      >
                        {savingCustom ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Save className="size-3.5" />
                        )}
                        {t('saveCustomFieldsBtn')}
                      </Button>
                    </div>
                  )}
                </TabsContent>

                {/* Attribution Tab */}
                <TabsContent
                  value="attribution"
                  className="flex-1 overflow-y-auto px-4 py-3"
                >
                  {loadingAttribution ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="text-primary size-5 animate-spin" />
                    </div>
                  ) : metaAttributions.length === 0 && touchpoints.length === 0 ? (
                    <div className="border-border bg-muted/20 rounded-lg border border-dashed p-5 text-center">
                      <MousePointerClick className="text-muted-foreground mx-auto size-5" />
                      <p className="mt-2 text-sm font-medium">
                        Nenhuma atribuição registrada ainda
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs leading-5">
                        Quando este contato chegar por uma campanha ou link
                        rastreável, a origem, UTMs e identificadores aparecerão aqui.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                        <p className="text-primary flex items-center gap-1.5 text-xs font-semibold">
                          <Megaphone className="size-3.5" />
                          Dados de campanhas e rastreamento
                        </p>
                        <p className="text-muted-foreground mt-1 text-[11px] leading-5">
                          Os nomes de campanha, conjunto e anúncio são
                          enriquecidos pela integração de anúncios. UTMs e IDs
                          de clique são preservados como evidência de origem.
                        </p>
                      </div>

                      {metaAttributions.map((attribution) => (
                        <div
                          key={attribution.id}
                          className="border-primary/20 bg-primary/5 rounded-lg border p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold">Meta Ads</p>
                              <p className="text-muted-foreground text-xs">
                                Clique para WhatsApp
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className={
                                attribution.meta_marketing_resolved_at
                                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                  : ''
                              }
                            >
                              {attribution.meta_marketing_resolved_at
                                ? 'Dados do Ads carregados'
                                : 'Aguardando ads_read'}
                            </Badge>
                          </div>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <AttributionField
                              label="Campanha"
                              value={
                                attribution.meta_campaign_name ||
                                attribution.meta_campaign_id
                              }
                            />
                            <AttributionField
                              label="Conjunto de anúncios"
                              value={
                                attribution.meta_adset_name ||
                                attribution.meta_adset_id
                              }
                            />
                            <AttributionField
                              label="Anúncio"
                              value={
                                attribution.meta_ad_name ||
                                attribution.headline ||
                                attribution.meta_ad_id
                              }
                            />
                            <AttributionField
                              label="Conta de anúncios"
                              value={attribution.meta_ad_account_id}
                            />
                          </div>
                          <details className="mt-3">
                            <summary className="text-muted-foreground cursor-pointer text-xs hover:text-foreground">
                              Ver identificadores e origem
                            </summary>
                            <div className="mt-3 grid gap-3 border-l pl-3 sm:grid-cols-2">
                              <AttributionField label="ID da campanha" value={attribution.meta_campaign_id} />
                              <AttributionField label="ID do conjunto" value={attribution.meta_adset_id} />
                              <AttributionField label="ID do anúncio" value={attribution.meta_ad_id || attribution.source_id} />
                              <AttributionField label="Clique do WhatsApp" value={attribution.ctwa_clid} />
                              <AttributionField label="URL de origem" value={attribution.source_url} />
                            </div>
                          </details>
                        </div>
                      ))}

                      {touchpoints
                        .filter(
                          (touchpoint) =>
                            touchpoint.provider !== 'meta' ||
                            metaAttributions.length === 0
                        )
                        .map((touchpoint) => {
                          const provider =
                            touchpoint.provider === 'google_ads'
                              ? 'Google Ads'
                              : touchpoint.provider === 'website'
                                ? 'Site / link rastreável'
                                : touchpoint.source_platform || 'Origem registrada';
                          return (
                            <div key={touchpoint.id} className="border-border rounded-lg border p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold">{provider}</p>
                                  <p className="text-muted-foreground text-xs">
                                    {touchpoint.source_channel || touchpoint.method}
                                  </p>
                                </div>
                                <p className="text-muted-foreground text-[10px]">
                                  {new Date(touchpoint.occurred_at).toLocaleDateString('pt-BR')}
                                </p>
                              </div>
                              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                <AttributionField label="Campanha (UTM)" value={touchpoint.utm_campaign} />
                                <AttributionField label="Origem / mídia" value={[touchpoint.utm_source, touchpoint.utm_medium].filter(Boolean).join(' · ') || null} />
                                <AttributionField label="UTM term" value={touchpoint.utm_term} />
                                <AttributionField label="UTM content" value={touchpoint.utm_content} />
                                <AttributionField label="gclid" value={touchpoint.gclid} />
                                <AttributionField label="fbclid" value={touchpoint.fbclid} />
                                <AttributionField label="msclkid" value={touchpoint.msclkid} />
                                <AttributionField label="Página de entrada" value={touchpoint.landing_url} />
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </TabsContent>

                {/* Deals Tab */}
                <TabsContent
                  value="deals"
                  className="flex-1 overflow-y-auto px-4 py-3"
                >
                  {loadingDeals ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="text-primary size-5 animate-spin" />
                    </div>
                  ) : deals.length === 0 ? (
                    <p className="text-muted-foreground text-xs">
                      {t('dealsTab.noDeals')}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {deals.map((deal) => (
                        <div
                          key={deal.id}
                          className="border-border bg-muted/50 rounded-lg border p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-foreground text-sm font-medium">
                              {deal.title}
                            </p>
                            {deal.stage && (
                              <span
                                className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                                style={{
                                  backgroundColor: `${deal.stage.color}20`,
                                  color: deal.stage.color,
                                }}
                              >
                                {deal.stage.name}
                              </span>
                            )}
                          </div>
                          <div className="text-muted-foreground mt-1.5 flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1">
                              <DollarSign className="size-3" />
                              {formatCurrency(
                                deal.value ?? 0,
                                deal.currency || defaultCurrency
                              )}
                            </span>
                            {deal.status && deal.status !== 'open' && (
                              <span
                                className={
                                  deal.status === 'won'
                                    ? 'text-primary'
                                    : 'text-red-400'
                                }
                              >
                                {deal.status}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <TemplatePicker
        open={templatePickerOpen}
        onOpenChange={setTemplatePickerOpen}
        onSelect={handleSendTemplate}
      />
    </>
  );
}
