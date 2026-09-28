'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type {
  Contact,
  Profile,
  Tag,
  ContactTag,
  PipelineStage,
  CustomField,
} from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  endOfMonth,
  endOfYear,
  format,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
} from 'date-fns';
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
import { useLocale, useTranslations } from 'next-intl';

const PAGE_SIZE = 25;

type DateRangePreset =
  | 'all'
  | 'today'
  | 'yesterday'
  | 'last7Days'
  | 'last14Days'
  | 'last30Days'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear';

const DATE_RANGE_PRESETS: DateRangePreset[] = [
  'all',
  'today',
  'yesterday',
  'last7Days',
  'last14Days',
  'last30Days',
  'thisMonth',
  'lastMonth',
  'thisYear',
];

function getDateRange(
  preset: Exclude<DateRangePreset, 'all'>,
  now = new Date()
) {
  switch (preset) {
    case 'today':
      return { from: now, to: now };
    case 'yesterday': {
      const yesterday = subDays(now, 1);
      return { from: yesterday, to: yesterday };
    }
    case 'last7Days':
      return { from: subDays(now, 6), to: now };
    case 'last14Days':
      return { from: subDays(now, 13), to: now };
    case 'last30Days':
      return { from: subDays(now, 29), to: now };
    case 'thisMonth':
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case 'lastMonth': {
      const previousMonth = subMonths(now, 1);
      return {
        from: startOfMonth(previousMonth),
        to: endOfMonth(previousMonth),
      };
    }
    case 'thisYear':
      return { from: startOfYear(now), to: endOfYear(now) };
  }
}

interface ContactWithTags extends Contact {
  tags?: Tag[];
  lastMessage?: string | null;
  openDeals?: ContactListDeal[];
}

function formatContactDate(iso: string, locale: string): string {
  const dateLocale =
    locale === 'pt-BR' ? 'pt-BR' : locale === 'ko' ? 'ko-KR' : 'en-US';
  const options: Intl.DateTimeFormatOptions =
    dateLocale === 'pt-BR'
      ? { day: '2-digit', month: '2-digit', year: 'numeric' }
      : { day: 'numeric', month: 'short', year: 'numeric' };
  return new Intl.DateTimeFormat(dateLocale, options).format(new Date(iso));
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

function dateBoundary(value: string, endExclusive = false) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day + (endExclusive ? 1 : 0));
  return date.toISOString();
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
  const locale = useLocale();
  const supabase = createClient();
  const canEdit = useCan('send-messages');
  const canEditSettings = useCan('edit-settings');
  const { accountId, profile, accountRole } = useAuth();

  const [contacts, setContacts] = useState<ContactWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  // Tag filter — contacts shown must have ANY of these tags (OR).
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [customFieldId, setCustomFieldId] = useState('');
  const [customFieldValue, setCustomFieldValue] = useState('');

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
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkAssigneeId, setBulkAssigneeId] = useState('unassigned');
  const [bulkSaving, setBulkSaving] = useState(false);

  // All tags for display
  const [tagsMap, setTagsMap] = useState<Record<string, Tag>>({});
  const [customFields, setCustomFields] = useState<CustomField[]>([]);

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

  const fetchCustomFields = useCallback(async () => {
    if (!accountId) {
      setCustomFields([]);
      return;
    }

    const { data, error } = await supabase
      .from('custom_fields')
      .select('*')
      .eq('account_id', accountId)
      .order('field_name');
    if (!error) setCustomFields((data ?? []) as CustomField[]);
  }, [accountId, supabase]);

  const fetchContacts = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);
    // The visible rows are about to change — drop any selection that
    // referred to the old page/search results so the bulk bar can't
    // act on rows the user can no longer see.
    setSelected(new Set());

    if (!accountId || (accountRole === 'agent' && !profile?.id)) {
      setContacts([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const term = search.trim();

    const createdFromBoundary = createdFrom ? dateBoundary(createdFrom) : null;
    const createdToBoundary = createdTo ? dateBoundary(createdTo, true) : null;

    // The inner embeds apply filters before pagination and counting. This
    // matches the Kanban criteria while keeping a single server-side query.
    const selectClause = [
      '*',
      selectedTagIds.length > 0 ? 'tag_filter:contact_tags!inner(tag_id)' : '',
      customFieldId
        ? 'field_filter:contact_custom_values!inner(custom_field_id,value)'
        : '',
    ]
      .filter(Boolean)
      .join(',');
    let query = supabase
      .from('contacts')
      .select(selectClause, { count: 'exact' })
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);

    if (selectedTagIds.length > 0) {
      query = query.in('tag_filter.tag_id', selectedTagIds);
    }
    if (accountRole === 'agent') query = query.eq('assigned_to', profile!.id);
    if (assignedTo) query = query.eq('assigned_to', assignedTo);
    if (customFieldId) {
      query = query
        .eq('field_filter.custom_field_id', customFieldId)
        .neq('field_filter.value', '');
      if (customFieldValue.trim()) {
        query = query.ilike(
          'field_filter.value',
          `%${customFieldValue.trim()}%`
        );
      }
    }
    if (term) {
      const like = `%${term}%`;
      query = query.or(
        `name.ilike.${like},phone.ilike.${like},email.ilike.${like}`
      );
    }
    if (createdFromBoundary)
      query = query.gte('created_at', createdFromBoundary);
    if (createdToBoundary) query = query.lt('created_at', createdToBoundary);

    const { data, count: exactCount, error } = await query;
    if (seq !== fetchSeq.current) return; // superseded by a newer fetch
    if (error) {
      toast.error(t('toastFailedLoad'));
      setContacts([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }
    // Conditional embeds make the generated Supabase type broader than the
    // contact rows consumed by the list. The extra embed fields are ignored.
    const contactRows = (data ?? []) as unknown as Contact[];
    const count = exactCount ?? 0;

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
    accountRole,
    profile?.id,
    supabase,
    page,
    search,
    selectedTagIds,
    createdFrom,
    createdTo,
    assignedTo,
    customFieldId,
    customFieldValue,
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
    fetchCustomFields();
  }, [fetchCustomFields]);

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
    const { error } = await supabase.rpc('assign_contact_owner', {
      p_contact_id: contact.id,
      p_assignee_id: assigneeId,
    });

    if (error) {
      toast.error(t('toastFailedAssign'));
    } else {
      setContacts((current) =>
        current.map((item) =>
          item.id === contact.id ? { ...item, assigned_to: assigneeId } : item
        )
      );
      toast.success(t('toastAssigned'));
      if (accountRole === 'agent') void fetchContacts();
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

  function openBulkAssignDialog() {
    setBulkAssigneeId('unassigned');
    setBulkAssignOpen(true);
  }

  async function handleBulkAssign() {
    const ids = [...selected];
    if (ids.length === 0) return;

    setBulkSaving(true);
    const { data, error } = await supabase.rpc('assign_contacts_owner_bulk', {
      p_contact_ids: ids,
      p_assignee_id: bulkAssigneeId === 'unassigned' ? null : bulkAssigneeId,
    });

    if (error) {
      toast.error(t('toastBulkFailedAssign'));
    } else {
      toast.success(t('toastBulkAssigned', { count: data ?? ids.length }));
      setSelected(new Set());
      setBulkAssignOpen(false);
      await fetchContacts();
    }
    setBulkSaving(false);
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
    Boolean(createdTo) ||
    Boolean(assignedTo) ||
    Boolean(customFieldId);
  const activeFilterCount = [
    selectedTagIds.length > 0,
    Boolean(createdFrom),
    Boolean(createdTo),
    Boolean(assignedTo),
    Boolean(customFieldId),
  ].filter(Boolean).length;

  function toggleTagFilter(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
    setPage(0);
  }

  function clearFilters() {
    setSearch('');
    setSelectedTagIds([]);
    setCreatedFrom('');
    setCreatedTo('');
    setAssignedTo('');
    setCustomFieldId('');
    setCustomFieldValue('');
    setPage(0);
  }

  function applyDateRange(preset: DateRangePreset) {
    if (preset === 'all') {
      setCreatedFrom('');
      setCreatedTo('');
    } else {
      const range = getDateRange(preset);
      setCreatedFrom(format(range.from, 'yyyy-MM-dd'));
      setCreatedTo(format(range.to, 'yyyy-MM-dd'));
    }
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

      {/* Same filter layout and criteria as the Kanban. */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            className="border-border bg-muted text-foreground h-10 pl-9"
          />
        </div>
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                className="border-border bg-muted text-foreground hover:bg-accent inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium"
              />
            }
          >
            <SlidersHorizontal className="size-4" />
            {t('filterContacts')}
            {activeFilterCount > 0 && (
              <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[11px]">
                {activeFilterCount}
              </span>
            )}
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="max-h-[min(32rem,calc(100dvh-5rem))] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-3"
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">
                  {t('tagsLabel')}
                </Label>
                <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                  {allTags.length === 0 ? (
                    <span className="text-muted-foreground text-xs">
                      {t('noTagsYet')}
                    </span>
                  ) : (
                    allTags.map((tag) => {
                      const isSelected = selectedTagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => toggleTagFilter(tag.id)}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition-colors ${
                            isSelected
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border text-muted-foreground hover:bg-muted'
                          }`}
                        >
                          <span
                            className="size-1.5 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                          {tag.name}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label
                    htmlFor="contacts-created-from"
                    className="text-muted-foreground text-xs"
                  >
                    {t('createdFrom')}
                  </Label>
                  <div className="relative">
                    <Input
                      ref={createdFromInputRef}
                      id="contacts-created-from"
                      type="date"
                      value={createdFrom}
                      max={createdTo || undefined}
                      onChange={(event) => {
                        setCreatedFrom(event.target.value);
                        setPage(0);
                      }}
                      className="h-8 pr-9 [color-scheme:light] dark:[color-scheme:dark] [&::-webkit-calendar-picker-indicator]:hidden"
                    />
                    <button
                      type="button"
                      aria-label={t('selectStartDate')}
                      onClick={() =>
                        openDatePicker(createdFromInputRef.current)
                      }
                      className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm"
                    >
                      <CalendarDays aria-hidden="true" className="size-3.5" />
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label
                    htmlFor="contacts-created-to"
                    className="text-muted-foreground text-xs"
                  >
                    {t('createdTo')}
                  </Label>
                  <div className="relative">
                    <Input
                      ref={createdToInputRef}
                      id="contacts-created-to"
                      type="date"
                      value={createdTo}
                      min={createdFrom || undefined}
                      onChange={(event) => {
                        setCreatedTo(event.target.value);
                        setPage(0);
                      }}
                      className="h-8 pr-9 [color-scheme:light] dark:[color-scheme:dark] [&::-webkit-calendar-picker-indicator]:hidden"
                    />
                    <button
                      type="button"
                      aria-label={t('selectEndDate')}
                      onClick={() => openDatePicker(createdToInputRef.current)}
                      className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm"
                    >
                      <CalendarDays aria-hidden="true" className="size-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">
                  {t('quickSelection')}
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {DATE_RANGE_PRESETS.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => applyDateRange(preset)}
                      className="h-7 px-2 text-xs"
                    >
                      {t(`datePresets.${preset}`)}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <Label
                  htmlFor="contacts-assigned-to"
                  className="text-muted-foreground text-xs"
                >
                  {t('assignee')}
                </Label>
                <select
                  id="contacts-assigned-to"
                  value={assignedTo}
                  onChange={(event) => {
                    setAssignedTo(event.target.value);
                    setPage(0);
                  }}
                  className="border-input bg-background text-foreground h-8 w-full rounded-md border px-2 text-sm"
                >
                  <option value="">{t('allUsers')}</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.full_name || member.email}
                    </option>
                  ))}
                </select>
              </div>

              <div className="border-border space-y-2 border-t pt-3">
                <Label
                  htmlFor="contacts-custom-field"
                  className="text-muted-foreground text-xs"
                >
                  {t('contactCustomField')}
                </Label>
                <select
                  id="contacts-custom-field"
                  value={customFieldId}
                  onChange={(event) => {
                    setCustomFieldId(event.target.value);
                    setCustomFieldValue('');
                    setPage(0);
                  }}
                  className="border-input bg-background text-foreground h-8 w-full rounded-md border px-2 text-sm"
                >
                  <option value="">{t('selectField')}</option>
                  {customFields.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.field_name}
                    </option>
                  ))}
                </select>
                {customFieldId && (
                  <Input
                    value={customFieldValue}
                    onChange={(event) => {
                      setCustomFieldValue(event.target.value);
                      setPage(0);
                    }}
                    placeholder={t('containsValue')}
                    aria-label={t('containsValue')}
                    className="h-8"
                  />
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="mr-1 size-3.5" />
            {t('clearAll')}
          </Button>
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
              gateReason="assign contact owners"
              onClick={openBulkAssignDialog}
            >
              <UserRound className="size-4" />
              {t('bulkAssignOwner')}
            </GatedButton>
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
                    {formatContactDate(contact.created_at, locale)}
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

      <Dialog open={bulkAssignOpen} onOpenChange={setBulkAssignOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('bulkAssignOwner')}</DialogTitle>
            <DialogDescription>
              {t('bulkAssignOwnerDesc', { count: selected.size })}
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-1.5">
            <span className="text-sm font-medium">{t('assignee')}</span>
            <Select
              value={bulkAssigneeId}
              onValueChange={(value) => setBulkAssigneeId(value ?? 'unassigned')}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('assignee')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">{t('unassigned')}</SelectItem>
                {members.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.full_name || member.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkAssignOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={() => void handleBulkAssign()}
              disabled={bulkSaving}
            >
              {bulkSaving && <Loader2 className="size-4 animate-spin" />}
              {t('bulkAssignOwner')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
