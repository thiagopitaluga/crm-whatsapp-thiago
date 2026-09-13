'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import type { Contact, Deal, ContactNote, Tag } from '@/types';
import {
  Phone,
  Mail,
  Copy,
  Check,
  User,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  MousePointerClick,
  Megaphone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { useTranslations } from 'next-intl';
import { formatCurrency } from '@/lib/currency';

interface ContactSidebarProps {
  contact: Contact | null;
}

interface WebsiteAttributionClick {
  id: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  gclid: string | null;
  fbclid: string | null;
  created_at: string;
}

interface WhatsAppConversationAttribution {
  id: string;
  provider: string;
  attribution_type: string;
  source_id: string | null;
  source_type: string | null;
  source_url: string | null;
  ctwa_clid: string | null;
  headline: string | null;
  body: string | null;
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

function MetaAttributionDetail({
  label,
  value,
}: {
  label: string;
  value: string | null;
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

export function ContactSidebar({ contact }: ContactSidebarProps) {
  const tSidebar = useTranslations('Inbox.sidebar');
  const tThread = useTranslations('Inbox.messageThread');

  const { accountId, defaultCurrency } = useAuth();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [websiteAttributions, setWebsiteAttributions] = useState<
    WebsiteAttributionClick[]
  >([]);
  const [whatsAppAttributions, setWhatsAppAttributions] = useState<
    WhatsAppConversationAttribution[]
  >([]);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, tags, and acquisition data in parallel. Attribution
    // is optional for existing accounts, so a missing row never blocks the
    // rest of the contact sidebar.
    const [
      dealsRes,
      notesRes,
      tagsRes,
      websiteAttributionsRes,
      whatsAppAttributionsRes,
    ] = await Promise.all([
      supabase
        .from('deals')
        .select('*, stage:pipeline_stages(*)')
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('contact_notes')
        .select('*')
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('contact_tags')
        .select('id, tag_id, tags(*)')
        .eq('contact_id', contact.id),
      supabase
        .from('campaign_attribution_clicks')
        .select(
          'id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid, created_at'
        )
        .eq('resolved_contact_id', contact.id)
        .order('created_at', { ascending: false })
        .limit(3),
      supabase
        .from('conversation_attributions')
        .select(
          'id, provider, attribution_type, source_id, source_type, source_url, ctwa_clid, headline, body, meta_ad_account_id, meta_campaign_id, meta_campaign_name, meta_adset_id, meta_adset_name, meta_ad_id, meta_ad_name, meta_marketing_resolved_at, created_at'
        )
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false })
        .limit(3),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
    setWebsiteAttributions(
      (websiteAttributionsRes.data ?? []) as WebsiteAttributionClick[]
    );
    setWhatsAppAttributions(
      (whatsAppAttributionsRes.data ?? []) as WhatsAppConversationAttribution[]
    );
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from('contact_notes')
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote('');
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  if (!contact) {
    return (
      <div className="border-border bg-card flex h-full w-70 items-center justify-center border-l">
        <p className="text-muted-foreground text-sm">
          {tThread('selectConversation')}
        </p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();
  const hasAttribution =
    websiteAttributions.length > 0 || whatsAppAttributions.length > 0;

  return (
    <div className="border-border bg-card flex h-full w-70 flex-col border-l">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="bg-muted text-foreground flex h-16 w-16 items-center justify-center rounded-full text-lg font-semibold">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="text-foreground mt-3 text-sm font-semibold">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-muted-foreground text-xs">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              className="text-muted-foreground hover:bg-muted flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors"
            >
              <Phone className="text-muted-foreground h-4 w-4" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="text-primary h-3 w-3" />
              ) : (
                <Copy className="text-muted-foreground h-3 w-3" />
              )}
            </button>

            {contact.email && (
              <div className="text-muted-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
                <Mail className="text-muted-foreground h-4 w-4" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="border-border my-4 border-t" />

          {hasAttribution && (
            <>
              <div>
                <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
                  <MousePointerClick className="h-3 w-3" />
                  Origem da conversa
                </div>
                <div className="mt-2 space-y-2">
                  {whatsAppAttributions.map((attribution) => (
                    <div
                      key={attribution.id}
                      className="border-primary/20 bg-primary/5 rounded-lg border px-3 py-2.5"
                    >
                      <div className="text-foreground flex items-center gap-1.5 text-xs font-medium">
                        <Megaphone className="text-primary size-3.5" />
                        Meta Ads · Clique para WhatsApp
                      </div>
                      <div className="mt-2 space-y-2">
                        <MetaAttributionDetail
                          label="Campanha"
                          value={
                            attribution.meta_campaign_name ||
                            (attribution.meta_campaign_id
                              ? `ID ${attribution.meta_campaign_id}`
                              : null)
                          }
                        />
                        <MetaAttributionDetail
                          label="Conjunto de anúncios"
                          value={
                            attribution.meta_adset_name ||
                            (attribution.meta_adset_id
                              ? `ID ${attribution.meta_adset_id}`
                              : null)
                          }
                        />
                        <MetaAttributionDetail
                          label="Anúncio"
                          value={
                            attribution.meta_ad_name ||
                            attribution.headline ||
                            (attribution.meta_ad_id
                              ? `ID ${attribution.meta_ad_id}`
                              : null)
                          }
                        />
                      </div>
                      {!attribution.meta_marketing_resolved_at && (
                        <p className="text-muted-foreground mt-2 text-[10px]">
                          Dados da campanha aguardando consulta no Meta Ads.
                        </p>
                      )}
                      {attribution.source_id && (
                        <p
                          className="text-muted-foreground mt-2 truncate text-[10px]"
                          title={attribution.source_id}
                        >
                          ID de origem: {attribution.source_id}
                        </p>
                      )}
                      {attribution.ctwa_clid && (
                        <p className="text-muted-foreground mt-1 text-[10px]">
                          Identificador do clique salvo
                        </p>
                      )}
                    </div>
                  ))}
                  {websiteAttributions.map((attribution) => {
                    const source =
                      attribution.utm_source ||
                      (attribution.gclid
                        ? 'Google Ads'
                        : attribution.fbclid
                          ? 'Meta'
                          : 'Site');
                    return (
                      <div
                        key={attribution.id}
                        className="bg-muted rounded-lg px-3 py-2"
                      >
                        <p className="text-foreground text-xs font-medium">
                          {source}
                          {attribution.utm_medium
                            ? ` · ${attribution.utm_medium}`
                            : ''}
                        </p>
                        {attribution.utm_campaign && (
                          <p
                            className="text-muted-foreground mt-1 truncate text-xs"
                            title={attribution.utm_campaign}
                          >
                            {attribution.utm_campaign}
                          </p>
                        )}
                        {(attribution.gclid || attribution.fbclid) && (
                          <p className="text-muted-foreground mt-1 text-[10px]">
                            Identificador de clique salvo
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="border-border my-4 border-t" />
            </>
          )}

          {/* Tags */}
          <div>
            <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
              <TagIcon className="h-3 w-3" />
              {tSidebar('tags')}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="text-muted-foreground px-1 text-xs">
                  {tSidebar('noTags')}
                </p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="border-border my-4 border-t" />

          {/* Active Deals */}
          <div>
            <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
              <DollarSign className="h-3 w-3" />
              {tSidebar('deals')}
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="text-muted-foreground px-1 text-xs">
                  {tSidebar('noDeals')}
                </p>
              ) : (
                deals.map((deal) => (
                  <div key={deal.id} className="bg-muted rounded-lg px-3 py-2">
                    <p className="text-foreground text-sm font-medium">
                      {deal.title}
                    </p>
                    <div className="text-muted-foreground mt-1 flex items-center justify-between text-xs">
                      <span>
                        {formatCurrency(
                          deal.value,
                          deal.currency ?? defaultCurrency
                        )}
                      </span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${deal.stage.color}20`,
                            color: deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="border-border my-4 border-t" />

          {/* Notes */}
          <div>
            <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
              <StickyNote className="h-3 w-3" />
              {tSidebar('notes')}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar('addNotePlaceholder')}
                  rows={2}
                  className="border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/50 flex-1 resize-none rounded-lg border px-3 py-2 text-xs outline-none"
                />
                <Button
                  size="sm"
                  className="bg-primary hover:bg-primary/90 h-auto px-2"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div key={note.id} className="bg-muted rounded-lg px-3 py-2">
                    <p className="text-muted-foreground text-xs whitespace-pre-wrap">
                      {note.note_text}
                    </p>
                    <p className="text-muted-foreground mt-1 text-[10px]">
                      {format(new Date(note.created_at), 'MMM d, yyyy HH:mm')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
