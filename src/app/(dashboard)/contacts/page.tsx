'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Contact, Profile, Tag, ContactTag, PipelineStage } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Search,
  Plus,
  Upload,
  Pencil,
  Trash2,
  Loader2,
  Users,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Filter,
  X,
  CalendarPlus,
  StickyNote,
  Tag as TagIcon,
  UserRound,
  Check,
  Minus,
  CalendarDays,
} from 'lucide-react';
import { ContactForm } from '@/components/contacts/contact-form';
import {
  ContactDetailView,
  type ContactDetailTab,
} from '@/components/contacts/contact-detail-view';
import { ImportModal } from '@/components/contacts/import-modal';
import { CustomFieldsManager } from '@/components/contacts/custom-fields-manager';
import { TaskForm } from '@/components/tasks/task-form';
import { addContactTag, deleteContactTag } from '@/lib/contacts/tag-api';
import { useCan } from '@/hooks/use-can';
import { useAuth } from '@/hooks/use-auth';
import { GatedButton } from '@/components/ui/gated-button';
import { useTranslations } from 'next-intl';

const PAGE_SIZE = 25;

interface ContactWithTags extends Contact {
  tags?: Tag[];
  lastMessage?: string | null;
  openDeals?: ContactListDeal[];
}

interface ContactListDeal {
  id: string;
  contact_id: string;
  pipeline_id: string;
  stage_id: string;
  status: string | null;
  updated_at: string | null;
  stage?: Pick<
    PipelineStage,
    'id' | 'pipeline_id' | 'name' | 'position'
  > | null;
  pipeline?: { id: string; name: string } | null;
}

type ContactListDealRow = Omit<ContactListDeal, 'stage' | 'pipeline'> & {
  stage?: ContactListDeal['stage'] | NonNullable<ContactListDeal['stage']>[];
  pipeline?:
    ContactListDeal['pipeline'] | NonNullable<ContactListDeal['pipeline']>[];
};

interface StageOption extends PipelineStage {
  pipelineName: string;
}

function nextDay(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function ContactSelectionCheckbox({
  checked,
  indeterminate = false,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  const active = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`focus-visible:ring-primary inline-flex size-5 shrink-0 items-center justify-center rounded border-2 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-muted-foreground/70 bg-background hover:border-primary text-transparent'
      }`}
    >
      {indeterminate ? (
        <Minus className="size-3.5" aria-hidden="true" />
      ) : checked ? (
        <Check className="size-3.5" aria-hidden="true" />
      ) : null}
    </button>
  );
}

export default function ContactsPage() {
  const t = useTranslations('Contacts.page');
  const supabase = createClient();
  const canEdit = useCan('send-messages');
  const canEditSettings = useCan('edit-settings');
  const { accountId } = useAuth();

  const [contacts, setContacts] = useState<ContactWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  // Tag filter — contacts shown must have ANY of these tags (OR).
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editContactTags, setEditContactTags] = useState<ContactTag[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailContactId, setDetailContactId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<ContactDetailTab>('details');
  const [importOpen, setImportOpen] = useState(false);
  const [customFieldsOpen, setCustomFieldsOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [taskContact, setTaskContact] = useState<Contact | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);
  const [stageOptions, setStageOptions] = useState<StageOption[]>([]);
  const [assigningContactId, setAssigningContactId] = useState<string | null>(
    null
  );
  const [movingDealId, setMovingDealId] = useState<string | null>(null);

  // Bulk selection (page-scoped — only the loaded rows are selectable)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkStageOpen, setBulkStageOpen] = useState(false);
  const [bulkPipelineId, setBulkPipelineId] = useState('');
  const [bulkStageId, setBulkStageId] = useState('');
  const [bulkTagMode, setBulkTagMode] = useState<'add' | 'remove' | null>(null);
  const [bulkTagIds, setBulkTagIds] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);

  // All tags for display
  const [tagsMap, setTagsMap] = useState<Record<string, Tag>>({});

  // Guards against out-of-order fetch responses: each fetchContacts run
  // claims a sequence number and only the latest is allowed to commit its
  // results. Without this, rapidly toggling tag filters could let a slower
  // earlier request resolve last and render stale rows.
  const fetchSeq = useRef(0);
  const createdFromInputRef = useRef<HTMLInputElement>(null);
  const createdToInputRef = useRef<HTMLInputElement>(null);

  const fetchTags = useCallback(async () => {
    if (!accountId) {
      setTagsMap({});
      setSelectedTagIds([]);
      return;
    }

    const { data } = await supabase
      .from('tags')
      .select('*')
      .eq('account_id', accountId);
    if (data) {
      const map: Record<string, Tag> = {};
      data.forEach((t) => (map[t.id] = t));
      setTagsMap(map);
      // Drop any filter selections whose tag no longer exists (e.g. a tag
      // deleted elsewhere) so it can't linger invisibly in the query.
      setSelectedTagIds((prev) => {
        const pruned = prev.filter((id) => map[id]);
        return pruned.length === prev.length ? prev : pruned;
      });
    }
  }, [accountId, supabase]);

  const fetchMembers = useCallback(async () => {
    if (!accountId) {
      setMembers([]);
      return;
    }

    const { data: memberships, error: membershipsError } = await supabase
      .from('account_memberships')
      .select('user_id')
      .eq('account_id', accountId);
    if (membershipsError || !memberships?.length) {
      setMembers([]);
      return;
    }

    const memberUserIds = memberships.map((membership) => membership.user_id);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .in('user_id', memberUserIds)
      .order('full_name');

    if (!error) setMembers((data ?? []) as Profile[]);
  }, [accountId, supabase]);

  const fetchStageOptions = useCallback(async () => {
    if (!accountId) {
      setStageOptions([]);
      return;
    }

    const { data: pipelines, error: pipelinesError } = await supabase
      .from('pipelines')
      .select('id, name')
      .eq('account_id', accountId)
      .order('name');
    if (pipelinesError || !pipelines?.length) {
      setStageOptions([]);
      return;
    }

    const pipelineNames = new Map(
      pipelines.map((pipeline) => [pipeline.id, pipeline.name])
    );
    const { data: stages, error: stagesError } = await supabase
      .from('pipeline_stages')
      .select('*')
      .in(
        'pipeline_id',
        pipelines.map((pipeline) => pipeline.id)
      )
      .order('position');

    if (stagesError) {
      setStageOptions([]);
      return;
    }

    setStageOptions(
      (stages ?? []).map((stage) => ({
        ...(stage as PipelineStage),
        pipelineName: pipelineNames.get(stage.pipeline_id) ?? '',
      }))
    );
  }, [accountId, supabase]);

  const fetchContacts = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);
    // The visible rows are about to change — drop any selection that
    // referred to the old page/search results so the bulk bar can't
    // act on rows the user can no longer see.
    setSelected(new Set());

    if (!accountId) {
      setContacts([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const term = search.trim();

    let contactRows: Contact[];
    let count: number;

    if (selectedTagIds.length > 0) {
      // Tag filter active — resolve it server-side (join + distinct +
      // windowed total count + pagination) so a tag covering many
      // contacts can't silently truncate the result or overflow an IN
      // clause. See migration 025_filter_contacts_by_tags.
      const { data, error } = await supabase.rpc('filter_contacts_by_tags', {
        p_tag_ids: selectedTagIds,
        p_search: term || null,
        p_limit: PAGE_SIZE,
        p_offset: from,
        p_created_from: createdFrom || null,
        p_created_to: createdTo || null,
      });
      if (seq !== fetchSeq.current) return; // superseded by a newer fetch
      if (error) {
        toast.error(t('toastFailedLoad'));
        setLoading(false);
        return;
      }
      const rows = (data ?? []) as { contact: Contact; total_count: number }[];
      contactRows = rows.map((r) => r.contact);
      count = rows.length > 0 ? Number(rows[0].total_count) : 0;
    } else {
      let query = supabase
        .from('contacts')
        .select('*', { count: 'exact' })
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (term) {
        const like = `%${term}%`;
        query = query.or(
          `name.ilike.${like},phone.ilike.${like},email.ilike.${like}`
        );
      }

      if (createdFrom) {
        query = query.gte('created_at', `${createdFrom}T00:00:00.000Z`);
      }

      if (createdTo) {
        query = query.lt('created_at', `${nextDay(createdTo)}T00:00:00.000Z`);
      }

      const { data, count: exactCount, error } = await query;
      if (seq !== fetchSeq.current) return; // superseded by a newer fetch
      if (error) {
        toast.error(t('toastFailedLoad'));
        setLoading(false);
        return;
      }
      contactRows = data ?? [];
      count = exactCount ?? 0;
    }

    setTotalCount(count);

    if (contactRows.length === 0) {
      setContacts([]);
      setLoading(false);
      return;
    }

    // Enrich the loaded page with data that is part of the contact-list
    // experience. Conversations are unique per account/contact, while a
    // contact may have several open deals, so each one stays explicit in
    // the UI instead of arbitrarily picking a "current" pipeline.
    const contactIds = contactRows.map((c) => c.id);
    const [contactTagsResult, conversationsResult, dealsResult] =
      await Promise.all([
        supabase
          .from('contact_tags')
          .select('contact_id, tag_id')
          .in('contact_id', contactIds),
        supabase
          .from('conversations')
          .select('contact_id, last_message_text, last_message_at')
          .eq('account_id', accountId)
          .in('contact_id', contactIds),
        supabase
          .from('deals')
          .select(
            'id, contact_id, pipeline_id, stage_id, status, updated_at, stage:pipeline_stages(id, pipeline_id, name, position), pipeline:pipelines(id, name)'
          )
          .eq('account_id', accountId)
          .eq('status', 'open')
          .in('contact_id', contactIds)
          .order('updated_at', { ascending: false }),
      ]);
    if (seq !== fetchSeq.current) return; // superseded by a newer fetch

    const contactTags = contactTagsResult.data;

    const tagsByContact: Record<string, string[]> = {};
    contactTags?.forEach((ct) => {
      if (!tagsByContact[ct.contact_id]) tagsByContact[ct.contact_id] = [];
      tagsByContact[ct.contact_id].push(ct.tag_id);
    });

    const lastMessageByContact = new Map(
      (conversationsResult.data ?? []).map((conversation) => [
        conversation.contact_id,
        conversation.last_message_text,
      ])
    );
    const openDealsByContact: Record<string, ContactListDeal[]> = {};
    (dealsResult.data ?? []).forEach((deal) => {
      const row = deal as unknown as ContactListDealRow;
      if (!row.contact_id) return;
      const list = openDealsByContact[row.contact_id] ?? [];
      list.push({
        ...row,
        // PostgREST returns an object for the many-to-one relation, while a
        // missing relationship can be inferred as an array by TypeScript.
        // Normalize both shapes before the UI reads the stage label.
        stage: Array.isArray(row.stage) ? (row.stage[0] ?? null) : row.stage,
        pipeline: Array.isArray(row.pipeline)
          ? (row.pipeline[0] ?? null)
          : row.pipeline,
      });
      openDealsByContact[row.contact_id] = list;
    });

    const enriched: ContactWithTags[] = contactRows.map((c) => ({
      ...c,
      lastMessage: lastMessageByContact.get(c.id) ?? null,
      openDeals: openDealsByContact[c.id] ?? [],
      tags: (tagsByContact[c.id] ?? [])
        .map((tid) => tagsMap[tid])
        .filter(Boolean),
    }));

    setContacts(enriched);
    setLoading(false);
  }, [
    accountId,
    supabase,
    page,
    search,
    selectedTagIds,
    createdFrom,
    createdTo,
    tagsMap,
    t,
  ]);

  // Load-once-on-mount-ish data fetches. Each setter inside runs
  // inside an async promise completion (Supabase await), not
  // synchronously in the effect body, so the cascade the lint rule
  // warns about doesn't apply here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTags();
  }, [fetchTags]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchMembers();
  }, [fetchMembers]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStageOptions();
  }, [fetchStageOptions]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContacts();
  }, [fetchContacts]);

  function openAddForm() {
    setEditContact(null);
    setEditContactTags([]);
    setFormOpen(true);
  }

  async function openEditForm(contact: Contact) {
    const { data } = await supabase
      .from('contact_tags')
      .select('*')
      .eq('contact_id', contact.id);
    setEditContact(contact);
    setEditContactTags(data ?? []);
    setFormOpen(true);
  }

  function openDetail(contactId: string, tab: ContactDetailTab = 'details') {
    setDetailContactId(contactId);
    setDetailTab(tab);
    setDetailOpen(true);
  }

  async function assignContact(contact: Contact, assigneeId: string | null) {
    if (!accountId || assigningContactId) return;
    if (assigneeId && !members.some((member) => member.id === assigneeId))
      return;

    setAssigningContactId(contact.id);
    const { error } = await supabase
      .from('contacts')
      .update({ assigned_to: assigneeId })
      .eq('id', contact.id)
      .eq('account_id', accountId);

    if (error) {
      toast.error(t('toastFailedAssign'));
    } else {
      setContacts((current) =>
        current.map((item) =>
          item.id === contact.id ? { ...item, assigned_to: assigneeId } : item
        )
      );
      toast.success(t('toastAssigned'));
    }
    setAssigningContactId(null);
  }

  function confirmDelete(contact: Contact) {
    setDeleteTarget(contact);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget || !accountId) return;
    setDeleting(true);

    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', deleteTarget.id)
      .eq('account_id', accountId);

    if (error) {
      toast.error(t('toastFailedDelete'));
    } else {
      toast.success(t('toastDeleted'));
      fetchContacts();
    }

    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  const allOnPageSelected =
    contacts.length > 0 && contacts.every((c) => selected.has(c.id));
  const someOnPageSelected = contacts.some((c) => selected.has(c.id));

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        contacts.forEach((c) => next.delete(c.id));
      } else {
        contacts.forEach((c) => next.add(c.id));
      }
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkDelete() {
    const ids = [...selected];
    if (ids.length === 0 || !accountId) return;
    setDeleting(true);

    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('account_id', accountId)
      .in('id', ids);

    if (error) {
      toast.error(t('toastBulkFailedDelete'));
    } else {
      toast.success(t('toastBulkDeleted', { count: ids.length }));
      setSelected(new Set());
      fetchContacts();
    }

    setDeleting(false);
    setBulkDeleteOpen(false);
  }

  function stagesForPipeline(pipelineId: string) {
    return stageOptions.filter((stage) => stage.pipeline_id === pipelineId);
  }

  async function moveDealToStage(deal: ContactListDeal, stageId: string) {
    if (!accountId || deal.stage_id === stageId) return;
    const targetStage = stageOptions.find((stage) => stage.id === stageId);
    if (!targetStage || targetStage.pipeline_id !== deal.pipeline_id) {
      toast.error(t('toastInvalidStage'));
      return;
    }

    setMovingDealId(deal.id);
    const { data, error } = await supabase
      .from('deals')
      .update({ stage_id: stageId })
      .eq('id', deal.id)
      .eq('account_id', accountId)
      .eq('pipeline_id', deal.pipeline_id)
      .eq('status', 'open')
      .select('id')
      .maybeSingle();

    if (error || !data) {
      toast.error(t('toastFailedMoveStage'));
    } else {
      setContacts((current) =>
        current.map((contact) => ({
          ...contact,
          openDeals: contact.openDeals?.map((item) =>
            item.id === deal.id ? { ...item, stage_id: stageId } : item
          ),
        }))
      );
      toast.success(t('toastStageMoved'));
    }
    setMovingDealId(null);
  }

  function openBulkStageDialog() {
    const firstPipelineId = stageOptions[0]?.pipeline_id ?? '';
    setBulkPipelineId(firstPipelineId);
    setBulkStageId(stagesForPipeline(firstPipelineId)[0]?.id ?? '');
    setBulkStageOpen(true);
  }

  async function handleBulkMoveStage() {
    const ids = [...selected];
    const targetStage = stageOptions.find((stage) => stage.id === bulkStageId);
    if (
      !accountId ||
      ids.length === 0 ||
      !targetStage ||
      targetStage.pipeline_id !== bulkPipelineId
    ) {
      toast.error(t('toastInvalidStage'));
      return;
    }

    setBulkSaving(true);
    const { data, error } = await supabase
      .from('deals')
      .update({ stage_id: targetStage.id })
      .eq('account_id', accountId)
      .eq('pipeline_id', bulkPipelineId)
      .eq('status', 'open')
      .in('contact_id', ids)
      .select('id');

    if (error) {
      toast.error(t('toastFailedMoveStage'));
    } else if (!data?.length) {
      toast.error(t('toastNoOpenDealsInPipeline'));
    } else {
      toast.success(t('toastBulkStageMoved', { count: data.length }));
      setBulkStageOpen(false);
      fetchContacts();
    }
    setBulkSaving(false);
  }

  function openBulkTagDialog(mode: 'add' | 'remove') {
    setBulkTagIds(new Set());
    setBulkTagMode(mode);
  }

  function toggleBulkTag(tagId: string) {
    setBulkTagIds((current) => {
      const next = new Set(current);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  async function handleBulkTags() {
    if (!bulkTagMode || selected.size === 0 || bulkTagIds.size === 0) return;
    setBulkSaving(true);
    const ids = [...selected];
    const tagIds = [...bulkTagIds];
    const operations = ids.flatMap((contactId) =>
      tagIds.map((tagId) =>
        bulkTagMode === 'add'
          ? addContactTag(contactId, tagId)
          : deleteContactTag(contactId, tagId)
      )
    );
    const results = await Promise.allSettled(operations);
    const failed = results.filter((result) => result.status === 'rejected');

    if (failed.length > 0) {
      toast.error(t('toastBulkTagsPartial', { count: failed.length }));
    } else {
      toast.success(
        t(bulkTagMode === 'add' ? 'toastBulkTagsAdded' : 'toastBulkTagsRemoved')
      );
    }
    setBulkSaving(false);
    setBulkTagMode(null);
    fetchContacts();
  }

  function exportSelectedContacts() {
    const contactsToExport = contacts.filter((contact) =>
      selected.has(contact.id)
    );
    if (contactsToExport.length === 0) return;

    const csvCell = (value: string | null | undefined) =>
      `"${(value ?? '').replaceAll('"', '""')}"`;
    const rows = [
      [
        'Nome',
        'Telefone',
        'Última mensagem',
        'Etapas atuais',
        'Etiquetas',
        'Criado',
      ],
      ...contactsToExport.map(
        (contact) =>
          [
            contact.name ?? '',
            contact.phone,
            contact.lastMessage ?? '',
            (contact.openDeals ?? [])
              .map((deal) => {
                const stageOption = stageOptions.find(
                  (item) => item.id === deal.stage_id
                );
                const stage = stageOption ?? deal.stage;
                return stage
                  ? `${stageOption?.pipelineName ?? deal.pipeline?.name ?? t('unknownPipeline')}: ${stage.name}`
                  : '';
              })
              .filter(Boolean)
              .join(' | '),
            (contact.tags ?? []).map((tag) => tag.name).join(' | '),
            new Date(contact.created_at).toISOString(),
          ] as string[]
      ),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8' })
    );
    link.download = 'contatos-selecionados.csv';
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success(t('toastExported', { count: contactsToExport.length }));
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  // Tag filter helpers. Every change resets to page 0 — the result set
  // shrinks/grows so page N may no longer be valid (mirrors the search box).
  const allTags = Object.values(tagsMap).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const hasActiveFilters =
    search.trim().length > 0 ||
    selectedTagIds.length > 0 ||
    Boolean(createdFrom) ||
    Boolean(createdTo);
  const activeFilterCount =
    selectedTagIds.length +
    Number(Boolean(createdFrom)) +
    Number(Boolean(createdTo));

  function toggleTagFilter(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
    setPage(0);
  }

  function clearFilters() {
    setSelectedTagIds([]);
    setCreatedFrom('');
    setCreatedTo('');
    setPage(0);
  }

  function openDatePicker(input: HTMLInputElement | null) {
    if (!input) return;
    input.focus();
    try {
      input.showPicker?.();
    } catch {
      // Browsers without showPicker still open their native calendar after
      // a regular click on the focused date input.
      input.click();
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {totalCount > 0
              ? t('subtitle', { count: totalCount })
              : t('subtitleZero')}
          </p>
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {canEditSettings && (
            <Button
              variant="outline"
              onClick={() => setCustomFieldsOpen(true)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              <SlidersHorizontal className="size-4" />
              {t('customFieldsBtn')}
            </Button>
          )}
          <GatedButton
            variant="outline"
            canAct={canEdit}
            gateReason="add or import contacts"
            onClick={() => setImportOpen(true)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            <Upload className="size-4" />
            {t('importBtn')}
          </GatedButton>
          <GatedButton
            canAct={canEdit}
            gateReason="add or import contacts"
            onClick={openAddForm}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="size-4" />
            {t('addContactBtn')}
          </GatedButton>
        </div>
      </div>

      {/* Search + filters */}
      <div className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative w-full max-w-sm">
            <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                // Reset pagination when the query changes — the result
                // set shrinks/grows, page N may no longer be valid.
                setPage(0);
              }}
              placeholder={t('searchPlaceholder')}
              className="bg-card border-border text-foreground placeholder:text-muted-foreground pl-8"
            />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span className="text-muted-foreground text-xs font-medium">
              {t('createdFrom')}
            </span>
            <div className="relative w-36">
              <Input
                ref={createdFromInputRef}
                type="date"
                value={createdFrom}
                max={createdTo || undefined}
                onChange={(event) => {
                  setCreatedFrom(event.target.value);
                  setPage(0);
                }}
                aria-label={t('createdFrom')}
                className="h-9 pr-8 text-xs"
              />
              <button
                type="button"
                aria-label={`Selecionar ${t('createdFrom').toLocaleLowerCase()}`}
                onClick={() => openDatePicker(createdFromInputRef.current)}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm"
              >
                <CalendarDays className="size-3.5" aria-hidden="true" />
              </button>
            </div>
            <span className="text-muted-foreground text-xs font-medium">
              {t('createdTo')}
            </span>
            <div className="relative w-36">
              <Input
                ref={createdToInputRef}
                type="date"
                value={createdTo}
                min={createdFrom || undefined}
                onChange={(event) => {
                  setCreatedTo(event.target.value);
                  setPage(0);
                }}
                aria-label={t('createdTo')}
                className="h-9 pr-8 text-xs"
              />
              <button
                type="button"
                aria-label={`Selecionar ${t('createdTo').toLocaleLowerCase()}`}
                onClick={() => openDatePicker(createdToInputRef.current)}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm"
              >
                <CalendarDays className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  className="border-border text-muted-foreground hover:bg-muted shrink-0"
                />
              }
            >
              <Filter className="size-4" />
              {t('filters')}
              {activeFilterCount > 0 && (
                <span className="bg-primary text-primary-foreground ml-1 inline-flex items-center justify-center rounded-full px-1.5 text-[10px] font-semibold">
                  {activeFilterCount}
                </span>
              )}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-0">
              <div className="border-border flex items-center justify-between border-b px-3 py-2">
                <span className="text-popover-foreground text-sm font-medium">
                  {t('filters')}
                </span>
                {activeFilterCount > 0 && (
                  <button
                    onClick={clearFilters}
                    className="text-muted-foreground hover:text-foreground text-xs"
                  >
                    {t('clearAll')}
                  </button>
                )}
              </div>
              <div className="space-y-3 p-3">
                <div>
                  <p className="text-muted-foreground mb-1 text-xs font-medium">
                    {t('filterByTags')}
                  </p>
                  {allTags.length === 0 ? (
                    <p className="text-muted-foreground py-2 text-center text-sm">
                      {t('noTagsYet')}
                    </p>
                  ) : (
                    <div className="-mx-1 max-h-48 overflow-y-auto py-1">
                      {allTags.map((tag) => (
                        <label
                          key={tag.id}
                          className="hover:bg-muted/50 flex cursor-pointer items-center gap-2.5 px-1 py-1.5"
                        >
                          <Checkbox
                            checked={selectedTagIds.includes(tag.id)}
                            onCheckedChange={() => toggleTagFilter(tag.id)}
                            aria-label={`Filter by ${tag.name}`}
                          />
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                          <span className="text-popover-foreground truncate text-sm">
                            {tag.name}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Active filter chips */}
        {(selectedTagIds.length > 0 || createdFrom || createdTo) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedTagIds.map((id) => {
              const tag = tagsMap[id];
              if (!tag) return null;
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    backgroundColor: tag.color + '20',
                    color: tag.color,
                  }}
                >
                  {tag.name}
                  <button
                    onClick={() => toggleTagFilter(id)}
                    aria-label={`Remove ${tag.name} filter`}
                    className="hover:opacity-70"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              );
            })}
            {createdFrom && (
              <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
                {t('createdFrom')}: {createdFrom}
                <button
                  onClick={() => {
                    setCreatedFrom('');
                    setPage(0);
                  }}
                  aria-label={t('clearCreatedFrom')}
                  className="hover:opacity-70"
                >
                  <X className="size-3" />
                </button>
              </span>
            )}
            {createdTo && (
              <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
                {t('createdTo')}: {createdTo}
                <button
                  onClick={() => {
                    setCreatedTo('');
                    setPage(0);
                  }}
                  aria-label={t('clearCreatedTo')}
                  className="hover:opacity-70"
                >
                  <X className="size-3" />
                </button>
              </span>
            )}
            <button
              onClick={clearFilters}
              className="text-muted-foreground hover:text-foreground px-1 text-xs"
            >
              {t('clearAll')}
            </button>
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="border-border bg-muted/40 flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-foreground text-sm">
            {t('selectedCount', { count: selected.size })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <GatedButton
              variant="outline"
              size="sm"
              canAct={canEdit}
              gateReason="move contact stages"
              onClick={openBulkStageDialog}
            >
              {t('bulkMoveStage')}
            </GatedButton>
            <GatedButton
              variant="outline"
              size="sm"
              canAct={canEdit}
              gateReason="manage contact tags"
              onClick={() => openBulkTagDialog('add')}
            >
              {t('bulkAddTags')}
            </GatedButton>
            <GatedButton
              variant="outline"
              size="sm"
              canAct={canEdit}
              gateReason="manage contact tags"
              onClick={() => openBulkTagDialog('remove')}
            >
              {t('bulkRemoveTags')}
            </GatedButton>
            <Button
              variant="outline"
              size="sm"
              onClick={exportSelectedContacts}
            >
              {t('bulkExport')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
              className="text-muted-foreground hover:text-foreground"
            >
              {t('clearSelection')}
            </Button>
            <GatedButton
              variant="destructive"
              size="sm"
              canAct={canEdit}
              gateReason="delete contacts"
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 className="size-4" />
              {t('deleteSelected')}
            </GatedButton>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="border-border overflow-x-auto rounded-lg border">
        <Table className="min-w-[980px]">
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-12 min-w-12 px-3">
                <ContactSelectionCheckbox
                  checked={allOnPageSelected}
                  indeterminate={!allOnPageSelected && someOnPageSelected}
                  onChange={toggleSelectAll}
                  disabled={contacts.length === 0}
                  label="Selecionar todos os contatos desta página"
                />
              </TableHead>
              <TableHead className="text-muted-foreground">
                {t('tableColumns.name')}
              </TableHead>
              <TableHead className="text-muted-foreground">
                {t('tableColumns.phone')}
              </TableHead>
              <TableHead className="text-muted-foreground">
                {t('tableColumns.lastMessage')}
              </TableHead>
              <TableHead className="text-muted-foreground min-w-44">
                {t('tableColumns.currentStage')}
              </TableHead>
              <TableHead className="text-muted-foreground min-w-40">
                {t('tableColumns.tags')}
              </TableHead>
              <TableHead className="text-muted-foreground">
                {t('tableColumns.createdAt')}
              </TableHead>
              <TableHead className="w-[15.25rem]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="border-border">
                <TableCell colSpan={8} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="text-primary size-6 animate-spin" />
                    <p className="text-muted-foreground text-sm">
                      {t('loading')}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : contacts.length === 0 ? (
              <TableRow className="border-border">
                <TableCell colSpan={8} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Users className="text-muted-foreground size-8" />
                    <p className="text-muted-foreground text-sm">
                      {hasActiveFilters
                        ? t('noContactsMatch')
                        : t('noContactsYet')}
                    </p>
                    {!hasActiveFilters && (
                      <GatedButton
                        canAct={canEdit}
                        gateReason="add or import contacts"
                        variant="outline"
                        size="sm"
                        onClick={openAddForm}
                        className="border-border text-muted-foreground hover:bg-muted mt-2"
                      >
                        <Plus className="size-3.5" />
                        {t('addFirstContact')}
                      </GatedButton>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              contacts.map((contact) => (
                <TableRow
                  key={contact.id}
                  className="border-border hover:bg-muted/50 cursor-pointer"
                  onClick={() => openDetail(contact.id)}
                >
                  <TableCell
                    className="w-12 min-w-12 px-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ContactSelectionCheckbox
                      checked={selected.has(contact.id)}
                      onChange={() => toggleSelect(contact.id)}
                      label={`Selecionar ${contact.name || contact.phone}`}
                    />
                  </TableCell>
                  <TableCell className="text-foreground font-medium">
                    {contact.name || (
                      <span className="text-muted-foreground italic">
                        {t('unnamed')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {contact.phone}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-56 truncate text-sm">
                    {contact.lastMessage || (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell
                    className="min-w-44"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {contact.openDeals && contact.openDeals.length > 0 ? (
                      <div className="space-y-1.5">
                        {contact.openDeals.map((deal) => {
                          const currentStage =
                            stageOptions.find(
                              (stage) => stage.id === deal.stage_id
                            ) ??
                            (deal.stage
                              ? {
                                  ...deal.stage,
                                  pipelineName: deal.pipeline?.name ?? '',
                                }
                              : undefined);
                          const configuredStages = stagesForPipeline(
                            deal.pipeline_id
                          );
                          // A list page can render before the shared stage
                          // lookup returns. Keep the stage embedded with the
                          // deal available as a label in that brief window
                          // (and for legacy deals), never expose its UUID.
                          const pipelineStages = currentStage
                            ? configuredStages.some(
                                (stage) => stage.id === currentStage.id
                              )
                              ? configuredStages
                              : [currentStage, ...configuredStages]
                            : configuredStages;
                          return (
                            <div key={deal.id} className="space-y-0.5">
                              {contact.openDeals &&
                                contact.openDeals.length > 1 && (
                                  <p className="text-muted-foreground truncate text-[10px]">
                                    {currentStage?.pipelineName ||
                                      t('unknownPipeline')}
                                  </p>
                                )}
                              <Select
                                value={deal.stage_id}
                                onValueChange={(stageId) => {
                                  if (stageId)
                                    void moveDealToStage(deal, stageId);
                                }}
                              >
                                <SelectTrigger
                                  size="sm"
                                  disabled={
                                    !canEdit ||
                                    movingDealId === deal.id ||
                                    pipelineStages.length === 0
                                  }
                                  className="w-full max-w-48 text-xs"
                                  aria-label={t('moveContactStage')}
                                >
                                  <span className="min-w-0 flex-1 truncate text-left">
                                    {currentStage?.name ??
                                      t('stageUnavailable')}
                                  </span>
                                </SelectTrigger>
                                <SelectContent>
                                  {pipelineStages.map((stage) => (
                                    <SelectItem key={stage.id} value={stage.id}>
                                      {stage.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        {t('noOpenDeals')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {contact.tags && contact.tags.length > 0 ? (
                        contact.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag.id}
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{
                              backgroundColor: tag.color + '20',
                              color: tag.color,
                            }}
                          >
                            {tag.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                      {contact.tags && contact.tags.length > 3 && (
                        <span className="text-muted-foreground text-[10px]">
                          +{contact.tags.length - 3}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {new Date(contact.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </TableCell>
                  <TableCell
                    className="w-[15.25rem]"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="flex items-center justify-end gap-0.5">
                      <GatedButton
                        variant="ghost"
                        size="icon-sm"
                        canAct={canEdit}
                        gateReason="edit contacts"
                        title={t('editAction')}
                        aria-label={t('editAction')}
                        onClick={() => openEditForm(contact)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="size-4" />
                      </GatedButton>
                      <GatedButton
                        variant="ghost"
                        size="icon-sm"
                        canAct={canEdit}
                        gateReason="add notes"
                        title={t('addNoteAction')}
                        aria-label={t('addNoteAction')}
                        onClick={() => openDetail(contact.id, 'notes')}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <StickyNote className="size-4" />
                      </GatedButton>
                      <GatedButton
                        variant="ghost"
                        size="icon-sm"
                        canAct={canEdit}
                        gateReason="schedule tasks"
                        title={t('createTaskAction')}
                        aria-label={t('createTaskAction')}
                        onClick={() => setTaskContact(contact)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <CalendarPlus className="size-4" />
                      </GatedButton>
                      <GatedButton
                        variant="ghost"
                        size="icon-sm"
                        canAct={canEdit}
                        gateReason="manage contact tags"
                        title={t('manageTagsAction')}
                        aria-label={t('manageTagsAction')}
                        onClick={() => openDetail(contact.id, 'tags')}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <TagIcon className="size-4" />
                      </GatedButton>
                      <Popover>
                        <PopoverTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              disabled={
                                !canEdit || assigningContactId === contact.id
                              }
                              title={t('assignOwnerAction')}
                              aria-label={t('assignOwnerAction')}
                              className="text-muted-foreground hover:text-foreground"
                            />
                          }
                        >
                          {assigningContactId === contact.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <UserRound className="size-4" />
                          )}
                        </PopoverTrigger>
                        <PopoverContent
                          align="end"
                          className="w-52 p-1"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <p className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
                            {t('assignOwnerAction')}
                          </p>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start"
                            onClick={() => void assignContact(contact, null)}
                          >
                            {t('unassigned')}
                          </Button>
                          {members.map((member) => (
                            <Button
                              key={member.id}
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="w-full justify-start"
                              onClick={() =>
                                void assignContact(contact, member.id)
                              }
                            >
                              {member.full_name || member.email}
                            </Button>
                          ))}
                          {members.length === 0 && (
                            <p className="text-muted-foreground px-2 py-1.5 text-xs">
                              {t('noMembersAvailable')}
                            </p>
                          )}
                        </PopoverContent>
                      </Popover>
                      <GatedButton
                        variant="ghost"
                        size="icon-sm"
                        canAct={canEdit}
                        gateReason="delete contacts"
                        title={t('deleteAction')}
                        aria-label={t('deleteAction')}
                        onClick={() => confirmDelete(contact)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </GatedButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-xs">
            {t('showingPagination', {
              start: page * PAGE_SIZE + 1,
              end: Math.min((page + 1) * PAGE_SIZE, totalCount),
              total: totalCount,
            })}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasPrev}
              onClick={() => setPage((p) => p - 1)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-muted-foreground px-2 text-xs">
              {t('pageCount', { page: page + 1, total: totalPages })}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Contact Form Dialog */}
      <ContactForm
        open={formOpen}
        onOpenChange={setFormOpen}
        contact={editContact}
        contactTags={editContactTags}
        onSaved={() => {
          fetchContacts();
          fetchTags();
        }}
        onViewExisting={(id) => {
          setFormOpen(false);
          openDetail(id);
        }}
      />

      {/* Contact Detail Sheet */}
      <ContactDetailView
        open={detailOpen}
        onOpenChange={setDetailOpen}
        contactId={detailContactId}
        initialTab={detailTab}
        onUpdated={fetchContacts}
      />

      <TaskForm
        open={Boolean(taskContact)}
        onOpenChange={(open) => {
          if (!open) setTaskContact(null);
        }}
        defaultContactId={taskContact?.id ?? null}
        onSaved={() => setTaskContact(null)}
      />

      {/* Import Modal */}
      <ImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={fetchContacts}
      />

      {/* Custom Fields Manager (admin+) */}
      {canEditSettings && (
        <CustomFieldsManager
          open={customFieldsOpen}
          onOpenChange={setCustomFieldsOpen}
        />
      )}

      {/* Bulk move only touches open deals in the selected pipeline. A contact
          can be in more than one pipeline, so a pipeline is deliberately
          required instead of guessing which deal the user meant. */}
      <Dialog open={bulkStageOpen} onOpenChange={setBulkStageOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('bulkMoveStage')}</DialogTitle>
            <DialogDescription>
              {t('bulkMoveStageDesc', { count: selected.size })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="space-y-1.5">
              <span className="text-sm font-medium">{t('pipelineLabel')}</span>
              <Select
                value={bulkPipelineId}
                onValueChange={(pipelineId) => {
                  if (!pipelineId) return;
                  setBulkPipelineId(pipelineId);
                  setBulkStageId(stagesForPipeline(pipelineId)[0]?.id ?? '');
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('pipelineLabel')} />
                </SelectTrigger>
                <SelectContent>
                  {[
                    ...new Map(
                      stageOptions.map((stage) => [
                        stage.pipeline_id,
                        stage.pipelineName,
                      ])
                    ),
                  ].map(([pipelineId, pipelineName]) => (
                    <SelectItem key={pipelineId} value={pipelineId}>
                      {pipelineName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">{t('stageLabel')}</span>
              <Select
                value={bulkStageId}
                onValueChange={(stageId) => setBulkStageId(stageId ?? '')}
              >
                <SelectTrigger className="w-full" disabled={!bulkPipelineId}>
                  <SelectValue placeholder={t('stageLabel')} />
                </SelectTrigger>
                <SelectContent>
                  {stagesForPipeline(bulkPipelineId).map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      {stage.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkStageOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={() => void handleBulkMoveStage()}
              disabled={!bulkStageId || bulkSaving}
            >
              {bulkSaving && <Loader2 className="size-4 animate-spin" />}
              {t('bulkMoveStage')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkTagMode !== null}
        onOpenChange={(open) => {
          if (!open) setBulkTagMode(null);
        }}
      >
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t(bulkTagMode === 'remove' ? 'bulkRemoveTags' : 'bulkAddTags')}
            </DialogTitle>
            <DialogDescription>
              {t('bulkTagsDesc', { count: selected.size })}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 space-y-1 overflow-y-auto py-2">
            {allTags.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('noTagsYet')}</p>
            ) : (
              allTags.map((tag) => (
                <label
                  key={tag.id}
                  className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded-md px-2 py-2"
                >
                  <Checkbox
                    checked={bulkTagIds.has(tag.id)}
                    onCheckedChange={() => toggleBulkTag(tag.id)}
                    aria-label={tag.name}
                  />
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="text-sm">{tag.name}</span>
                </label>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkTagMode(null)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={() => void handleBulkTags()}
              disabled={bulkTagIds.size === 0 || bulkSaving}
            >
              {bulkSaving && <Loader2 className="size-4 animate-spin" />}
              {t(bulkTagMode === 'remove' ? 'bulkRemoveTags' : 'bulkAddTags')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('deleteContactTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('deleteContactDesc', {
                name: deleteTarget?.name || deleteTarget?.phone || '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {t('deleteBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('deleteBulkTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('deleteBulkDesc', { count: selected.size })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setBulkDeleteOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {t('deleteBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
