"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Contact, CustomField, Pipeline, PipelineCardLayout, PipelineStage, Deal, DealStatus, Profile, Tag } from "@/types";
import { PipelineBoard } from "@/components/pipelines/pipeline-board";
import { PipelineSettings } from "@/components/pipelines/pipeline-settings";
import { DealForm } from "@/components/pipelines/deal-form";
import { TaskForm } from "@/components/tasks/task-form";
import { PipelineAnalytics } from "@/components/pipelines/pipeline-analytics";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { GitBranch, Plus, ChevronDown, ChevronRight, Settings, Search, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { useCan } from "@/hooks/use-can";
import { useAuth } from "@/hooks/use-auth";
import { GatedButton } from "@/components/ui/gated-button";
import { useTranslations } from "next-intl";

// Pipeline creation is admin-class (settings-tier write under
// the new RLS); deal creation is operational and only requires
// agent+. The two CTAs gate on different `useCan` capabilities,
// not on different copy.

// Spec-defined seed — name and color per the product spec.
const SPEC_DEFAULT_STAGES = [
  { name: "New Lead", color: "#3b82f6", position: 0 }, // blue
  { name: "Qualified", color: "#eab308", position: 1 }, // yellow
  { name: "Proposal Sent", color: "#f97316", position: 2 }, // orange
  { name: "Negotiation", color: "#8b5cf6", position: 3 }, // purple
  { name: "Won", color: "#22c55e", position: 4 }, // green
  { name: "Lost", color: "#ef4444", position: 5 }, // red
];

const DEFAULT_CARD_LAYOUT: PipelineCardLayout = {
  show_value: true,
  show_created_at: true,
  show_last_message: true,
  custom_field_ids: [],
};

function normalizeCardLayout(layout: PipelineCardLayout | null | undefined): PipelineCardLayout {
  return {
    ...DEFAULT_CARD_LAYOUT,
    ...layout,
    custom_field_ids: layout?.custom_field_ids ?? [],
  };
}

function layoutStorageKey(pipelineId: string) {
  return `organizap:pipeline-card-layout:${pipelineId}`;
}

export default function PipelinesPage() {
  const t = useTranslations("Pipelines.page");
  const supabase = createClient();
  const canEditSettings = useCan("edit-settings");
  const canCreateDeals = useCan("send-messages");
  const { accountId } = useAuth();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [leadSearch, setLeadSearch] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [customFieldId, setCustomFieldId] = useState("");
  const [customFieldValue, setCustomFieldValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [cardLayoutDraft, setCardLayoutDraft] = useState<PipelineCardLayout>(DEFAULT_CARD_LAYOUT);

  // Dialog / sheet state
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Deal form state is lifted here so both the top-bar "Add Deal" and
  // the per-column "+" trigger the same Sheet.
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string>("");
  const [quickNoteDeal, setQuickNoteDeal] = useState<Deal | null>(null);
  const [quickNote, setQuickNote] = useState("");
  const [savingQuickNote, setSavingQuickNote] = useState(false);
  const [taskDeal, setTaskDeal] = useState<Deal | null>(null);

  // Guard against double-seeding (React StrictMode double-effect in dev).
  const seedAttemptedForAccount = useRef<string | null>(null);

  const loadPipelines = useCallback(async () => {
    if (!accountId) return [];

    const { data, error } = await supabase
      .from("pipelines")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at");
    if (error) {
      console.error("Failed to load pipelines:", error.message);
      return [];
    }
    return data ?? [];
  }, [accountId, supabase]);

  const loadStages = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .order("position");
      return data ?? [];
    },
    [supabase],
  );

  const loadDeals = useCallback(
    async (pipelineId: string) => {
      if (!accountId) return [];

      const { data } = await supabase
        .from("deals")
        .select("*, contact:contacts(*, conversations(last_message_text,last_message_at), contact_tags(tags(*)), contact_custom_values(value, custom_field:custom_fields(id,field_name))), assignee:profiles!deals_assigned_to_fkey(*)")
        .eq("pipeline_id", pipelineId)
        .eq("account_id", accountId)
        .order("created_at", { ascending: false });
      return (data ?? []).map((row) => {
        const contact = row.contact as
          | (Contact & {
              contact_tags?: { tags: Tag | null }[];
              contact_custom_values?: Array<{ value?: string | null; custom_field?: Pick<CustomField, "id" | "field_name"> | null }>;
            })
          | null;
        return {
          ...row,
          contact: contact
            ? {
                ...contact,
                tags: (contact.contact_tags ?? [])
                  .map((link) => link.tags)
                  .filter((tag): tag is Tag => Boolean(tag)),
                custom_values: contact.contact_custom_values ?? [],
              }
            : undefined,
        } as Deal;
      });
    },
    [accountId, supabase],
  );

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;

    (async () => {
      const [profilesResult, tagsResult, customFieldsResult] = await Promise.all([
        supabase.from("profiles").select("*").eq("account_id", accountId).order("full_name"),
        supabase.from("tags").select("*").eq("account_id", accountId).order("name"),
        supabase.from("custom_fields").select("*").eq("account_id", accountId).order("field_name"),
      ]);

      if (cancelled) return;
      if (!profilesResult.error) setMembers((profilesResult.data ?? []) as Profile[]);
      if (!tagsResult.error) setTags((tagsResult.data ?? []) as Tag[]);
      if (!customFieldsResult.error) setCustomFields((customFieldsResult.data ?? []) as CustomField[]);
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, supabase]);

  const seedDefaultPipeline = useCallback(async (): Promise<Pipeline | null> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return null;
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) return null;

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: user.id, account_id: accountId, name: "Sales Pipeline" })
      .select()
      .single();

    if (error || !pipeline) {
      console.error("Failed to seed pipeline:", error?.message);
      return null;
    }

    const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
    }));
    await supabase.from("pipeline_stages").insert(stagesPayload);

    return pipeline as Pipeline;
  }, [supabase, accountId]);

  // Initial load + seed-if-empty
  useEffect(() => {
    if (!accountId) {
      setPipelines([]);
      setSelectedPipelineId("");
      setStages([]);
      setDeals([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      let list = await loadPipelines();

      if (list.length === 0 && seedAttemptedForAccount.current !== accountId) {
        seedAttemptedForAccount.current = accountId;
        const seeded = await seedDefaultPipeline();
        if (seeded) list = await loadPipelines();
      }

      if (cancelled) return;
      setPipelines(list);
      if (list.length > 0) {
        setSelectedPipelineId((prev) =>
          prev && list.some((p) => p.id === prev) ? prev : list[0].id,
        );
      } else {
        setSelectedPipelineId("");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, loadPipelines, seedDefaultPipeline]);

  // Load stages + deals whenever selected pipeline changes.
  // Clearing on no-selection is a legitimate sync with URL/prop
  // state; the load completion uses async setters inside promise
  // callbacks (not synchronous in the effect body).
  useEffect(() => {
    if (!selectedPipelineId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStages([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeals([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const [s, d] = await Promise.all([
        loadStages(selectedPipelineId),
        loadDeals(selectedPipelineId),
      ]);
      if (cancelled) return;
      setStages(s);
      setDeals(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPipelineId, loadStages, loadDeals]);

  const refreshPipelines = useCallback(async () => {
    const list = await loadPipelines();
    setPipelines(list);
    if (list.length === 0) setSelectedPipelineId("");
    else if (!list.some((p) => p.id === selectedPipelineId))
      setSelectedPipelineId(list[0].id);
  }, [loadPipelines, selectedPipelineId]);

  const refreshStages = useCallback(async () => {
    if (!selectedPipelineId) return;
    setStages(await loadStages(selectedPipelineId));
  }, [loadStages, selectedPipelineId]);

  const refreshDeals = useCallback(async () => {
    if (!selectedPipelineId) return;
    setDeals(await loadDeals(selectedPipelineId));
  }, [loadDeals, selectedPipelineId]);

  const handleDealMoved = useCallback(
    async (dealId: string, newStageId: string) => {
      // Optimistic update — board already animated; just persist.
      setDeals((prev) =>
        prev.map((d) => (d.id === dealId ? { ...d, stage_id: newStageId } : d)),
      );
      const { error } = await supabase
        .from("deals")
        .update({ stage_id: newStageId })
        .eq("id", dealId);
      if (error) {
        toast.error(t("toastFailedMoveDeal"));
        refreshDeals();
      }
    },
    [supabase, refreshDeals, t],
  );

  const handleAddDeal = useCallback(
    (stageId?: string) => {
      setEditingDeal(null);
      setDefaultStageId(stageId ?? stages[0]?.id ?? "");
      setDealFormOpen(true);
    },
    [stages],
  );

  const handleEditDeal = useCallback((deal: Deal) => {
    setEditingDeal(deal);
    setDefaultStageId(deal.stage_id);
    setDealFormOpen(true);
  }, []);

  const handleQuickValue = useCallback(
    async (deal: Deal, value: number) => {
      setDeals((previous) =>
        previous.map((item) => (item.id === deal.id ? { ...item, value } : item)),
      );
      const { error } = await supabase.from("deals").update({ value }).eq("id", deal.id);
      if (error) {
        toast.error(t("toastFailedQuickUpdate"));
        void refreshDeals();
        return;
      }
      toast.success(t("toastValueUpdated"));
    },
    [refreshDeals, supabase, t],
  );

  const handleRenameStage = useCallback(async (stageId: string, name: string) => {
    setStages((previous) => previous.map((stage) => stage.id === stageId ? { ...stage, name } : stage));
    const { error } = await supabase.from("pipeline_stages").update({ name }).eq("id", stageId);
    if (error) {
      toast.error(t("toastFailedQuickUpdate"));
      void refreshStages();
    }
  }, [refreshStages, supabase, t]);

  const handleQuickAssign = useCallback(
    async (deal: Deal, assigneeId: string | null) => {
      const assignee = assigneeId ? members.find((member) => member.id === assigneeId) : undefined;
      setDeals((previous) =>
        previous.map((item) =>
          item.id === deal.id
            ? { ...item, assigned_to: assigneeId ?? undefined, assignee }
            : item,
        ),
      );
      const { error } = await supabase
        .from("deals")
        .update({ assigned_to: assigneeId })
        .eq("id", deal.id);
      if (error) {
        toast.error(t("toastFailedQuickUpdate"));
        void refreshDeals();
        return;
      }
      toast.success(t("toastLeadAssigned"));
    },
    [members, refreshDeals, supabase, t],
  );

  const handleQuickStatus = useCallback(
    async (deal: Deal, status: DealStatus) => {
      const matchingNames = status === "won" ? ["won", "ganho", "ganhou"] : ["lost", "perdido"];
      let targetStage = stages.find((stage) =>
        matchingNames.includes(stage.name.trim().toLowerCase()),
      );

      if (!targetStage) {
        const position = Math.max(-1, ...stages.map((stage) => stage.position)) + 1;
        const { data, error } = await supabase
          .from("pipeline_stages")
          .insert({
            pipeline_id: deal.pipeline_id,
            name: status === "won" ? "Ganho" : "Perdido",
            color: status === "won" ? "#22c55e" : "#ef4444",
            position,
          })
          .select()
          .single();
        if (error || !data) {
          toast.error(t("toastFailedQuickUpdate"));
          return;
        }
        targetStage = data as PipelineStage;
        setStages((previous) => [...previous, targetStage as PipelineStage]);
      }

      setDeals((previous) =>
        previous.map((item) =>
          item.id === deal.id
            ? { ...item, status, stage_id: targetStage.id }
            : item,
        ),
      );
      const { error } = await supabase
        .from("deals")
        .update({ status, stage_id: targetStage.id })
        .eq("id", deal.id);
      if (error) {
        toast.error(t("toastFailedQuickUpdate"));
        void refreshDeals();
        return;
      }
      toast.success(status === "won" ? t("toastMarkedWon") : t("toastMarkedLost"));
    },
    [refreshDeals, stages, supabase, t],
  );

  const saveQuickNote = useCallback(async () => {
    if (!quickNoteDeal?.contact_id || !quickNote.trim() || !accountId) return;
    setSavingQuickNote(true);
    const noteText = quickNote.trim();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      toast.error(t("toastNotSignedIn"));
      setSavingQuickNote(false);
      return;
    }

    const { error } = await supabase.from("contact_notes").insert({
      contact_id: quickNoteDeal.contact_id,
      account_id: accountId,
      user_id: user.id,
      note_text: noteText,
    });
    if (error) {
      setSavingQuickNote(false);
      toast.error(t("toastFailedQuickUpdate"));
      return;
    }

    const nextDealNotes = [quickNoteDeal.notes?.trim(), noteText]
      .filter(Boolean)
      .join("\n\n");
    const { error: dealError } = await supabase
      .from("deals")
      .update({ notes: nextDealNotes })
      .eq("id", quickNoteDeal.id);
    setSavingQuickNote(false);
    if (dealError) {
      toast.error(t("toastFailedQuickUpdate"));
      return;
    }

    setDeals((previous) =>
      previous.map((deal) =>
        deal.id === quickNoteDeal.id ? { ...deal, notes: nextDealNotes } : deal,
      ),
    );
    setQuickNote("");
    setQuickNoteDeal(null);
    toast.success(t("toastNoteAdded"));
  }, [accountId, quickNote, quickNoteDeal, supabase, t]);

  const handleToggleTag = useCallback(
    async (deal: Deal, tag: Tag) => {
      if (!deal.contact_id) return;
      const currentTags = deal.contact?.tags ?? [];
      const hasTag = currentTags.some((currentTag) => currentTag.id === tag.id);
      const { error } = hasTag
        ? await supabase
            .from("contact_tags")
            .delete()
            .eq("contact_id", deal.contact_id)
            .eq("tag_id", tag.id)
        : await supabase.from("contact_tags").insert({
            contact_id: deal.contact_id,
            tag_id: tag.id,
          });

      if (error) {
        toast.error(t("toastFailedQuickUpdate"));
        return;
      }

      setDeals((previous) =>
        previous.map((item) => {
          if (item.id !== deal.id || !item.contact) return item;
          return {
            ...item,
            contact: {
              ...item.contact,
              tags: hasTag
                ? (item.contact.tags ?? []).filter((currentTag) => currentTag.id !== tag.id)
                : [...(item.contact.tags ?? []), tag],
            },
          };
        }),
      );
    },
    [supabase, t],
  );

  const filteredDeals = deals.filter((deal) => {
    const search = leadSearch.trim().toLocaleLowerCase();
    const haystack = [
      deal.title,
      deal.contact?.name,
      deal.contact?.phone,
      deal.contact?.email,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
    const matchesSearch = !search || haystack.includes(search);
    const matchesTags =
      selectedTagIds.length === 0 ||
      selectedTagIds.some((tagId) => deal.contact?.tags?.some((tag) => tag.id === tagId));
    const createdDate = deal.contact?.created_at?.slice(0, 10) ?? "";
    const matchesCreatedFrom = !createdFrom || (createdDate && createdDate >= createdFrom);
    const matchesCreatedTo = !createdTo || (createdDate && createdDate <= createdTo);
    const matchesAssignee = !assignedTo || deal.assigned_to === assignedTo;
    const customValue = (deal.contact?.custom_values ?? []).find(
      (item) => item.custom_field?.id === customFieldId,
    )?.value?.toLocaleLowerCase() ?? "";
    const matchesCustomField =
      !customFieldId ||
      (Boolean(customValue) && (!customFieldValue.trim() || customValue.includes(customFieldValue.trim().toLocaleLowerCase())));
    return matchesSearch && matchesTags && matchesCreatedFrom && matchesCreatedTo && matchesAssignee && matchesCustomField;
  });

  const activeFilterCount = [
    selectedTagIds.length > 0,
    Boolean(createdFrom),
    Boolean(createdTo),
    Boolean(assignedTo),
    Boolean(customFieldId),
  ].filter(Boolean).length;

  const clearFilters = () => {
    setLeadSearch("");
    setSelectedTagIds([]);
    setCreatedFrom("");
    setCreatedTo("");
    setAssignedTo("");
    setCustomFieldId("");
    setCustomFieldValue("");
  };

  const saveCardLayout = async () => {
    if (!selectedPipeline) return;
    const nextLayout = normalizeCardLayout(cardLayoutDraft);
    const { error } = await supabase
      .from("pipelines")
      .update({ card_layout: nextLayout })
      .eq("id", selectedPipeline.id)
      .eq("account_id", accountId);
    if (error) {
      // A deployment may reach the app just before its SQL migration. Keep
      // the editor useful in that narrow window, scoped to the specific
      // pipeline, and automatically prefer the server value once available.
      if (typeof window !== "undefined" && (error.code === "PGRST204" || error.message.includes("card_layout"))) {
        window.localStorage.setItem(layoutStorageKey(selectedPipeline.id), JSON.stringify(nextLayout));
        setPipelines((current) => current.map((pipeline) => (
          pipeline.id === selectedPipeline.id ? { ...pipeline, card_layout: nextLayout } : pipeline
        )));
        setLayoutOpen(false);
        toast.success("Layout salvo neste dispositivo.");
        return;
      }
      toast.error("Não foi possível salvar o layout do cartão.");
      return;
    }
    setPipelines((current) => current.map((pipeline) => (
      pipeline.id === selectedPipeline.id ? { ...pipeline, card_layout: nextLayout } : pipeline
    )));
    setLayoutOpen(false);
    toast.success("Layout do cartão salvo.");
  };

  async function handleCreatePipeline() {
    const name = newPipelineName.trim();
    if (!name) return;
    setCreating(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setCreating(false);
      return;
    }
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) {
      toast.error(t("toastNotLinkedToAccount"));
      setCreating(false);
      return;
    }

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: user.id, account_id: accountId, name })
      .select()
      .single();

    if (error || !pipeline) {
      toast.error(t("toastFailedCreatePipeline"));
      setCreating(false);
      return;
    }

    const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
    }));
    await supabase.from("pipeline_stages").insert(stagesPayload);

    setNewPipelineName("");
    setNewPipelineOpen(false);
    setSelectedPipelineId(pipeline.id);
    await refreshPipelines();
    setCreating(false);
    toast.success(t("toastPipelineCreated"));
  }

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);
  const selectedCardLayout = (() => {
    if (!selectedPipeline) return DEFAULT_CARD_LAYOUT;
    if (selectedPipeline.card_layout) return normalizeCardLayout(selectedPipeline.card_layout);
    if (typeof window === "undefined") return DEFAULT_CARD_LAYOUT;
    try {
      const stored = window.localStorage.getItem(layoutStorageKey(selectedPipeline.id));
      return stored ? normalizeCardLayout(JSON.parse(stored) as PipelineCardLayout) : DEFAULT_CARD_LAYOUT;
    } catch {
      return DEFAULT_CARD_LAYOUT;
    }
  })();

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="h-9 w-28 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-96 w-72 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Pipeline selector dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors data-[popup-open]:bg-muted"
            >
              <GitBranch className="h-4 w-4 text-primary" />
              <span className="font-semibold">
                {selectedPipeline?.name ?? t("selectPipeline")}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-64 border-border bg-popover text-popover-foreground"
            >
              {pipelines.length === 0 && (
                <DropdownMenuItem disabled className="text-muted-foreground">
                  {t("noPipelinesYet")}
                </DropdownMenuItem>
              )}
              {pipelines.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => setSelectedPipelineId(p.id)}
                  className={
                    p.id === selectedPipelineId
                      ? "text-primary"
                      : "text-popover-foreground"
                  }
                >
                  <GitBranch className="mr-2 h-3.5 w-3.5" />
                  {p.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-border" />
              {selectedPipeline && (
                <DropdownMenuItem
                  onClick={() => setSettingsOpen(true)}
                  className="text-popover-foreground"
                >
                  <Settings className="mr-2 h-3.5 w-3.5" />
                  {t("managePipelines")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2">
          {selectedPipeline && (
            <GatedButton
              variant="outline"
              canAct={canEditSettings}
              gateReason="edit pipeline layout"
              onClick={() => {
                setCardLayoutDraft(selectedCardLayout);
                setLayoutOpen(true);
              }}
              className="border-border bg-card text-foreground hover:bg-muted"
            >
              <SlidersHorizontal className="mr-1.5 size-4" />
              Editar layout do cartão
            </GatedButton>
          )}
          <GatedButton
            variant="outline"
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="border-border bg-card text-foreground hover:bg-muted"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("addPipeline")}
          </GatedButton>
          <GatedButton
            canAct={canCreateDeals}
            gateReason="create deals"
            disabled={!selectedPipelineId || stages.length === 0}
            onClick={() => handleAddDeal()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("addDeal")}
          </GatedButton>
        </div>
      </div>

      {/* Board */}
      {pipelines.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card/60 p-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={leadSearch}
              onChange={(event) => setLeadSearch(event.target.value)}
              placeholder={t("searchLeadsPlaceholder")}
              aria-label={t("searchLeads")}
              className="border-border bg-muted pl-9 text-foreground"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-muted px-3 text-sm font-medium text-foreground hover:bg-accent">
              <SlidersHorizontal className="size-4" />
              Filtrar contatos
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[11px] text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 p-3">
              <div className="space-y-4" onClick={(event) => event.stopPropagation()}>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Etiquetas</Label>
                  <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                    {tags.length === 0 ? <span className="text-xs text-muted-foreground">Nenhuma etiqueta criada.</span> : tags.map((tag) => {
                      const selected = selectedTagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => setSelectedTagIds((current) => selected ? current.filter((id) => id !== tag.id) : [...current, tag.id])}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition-colors ${selected ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
                        >
                          <span className="size-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="created-from" className="text-xs text-muted-foreground">Lead criado a partir de</Label>
                    <Input id="created-from" type="date" value={createdFrom} onChange={(event) => setCreatedFrom(event.target.value)} className="h-8" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="created-to" className="text-xs text-muted-foreground">Lead criado até</Label>
                    <Input id="created-to" type="date" value={createdTo} onChange={(event) => setCreatedTo(event.target.value)} className="h-8" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="assigned-to" className="text-xs text-muted-foreground">Responsável</Label>
                  <select id="assigned-to" value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground">
                    <option value="">Todos os usuários</option>
                    {members.map((member) => <option key={member.id} value={member.id}>{member.full_name || member.email}</option>)}
                  </select>
                </div>
                <div className="space-y-2 border-t border-border pt-3">
                  <Label className="text-xs text-muted-foreground">Campo personalizado do contato</Label>
                  <select value={customFieldId} onChange={(event) => { setCustomFieldId(event.target.value); setCustomFieldValue(""); }} className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground">
                    <option value="">Selecionar campo</option>
                    {customFields.map((field) => <option key={field.id} value={field.id}>{field.field_name}</option>)}
                  </select>
                  {customFieldId && <Input value={customFieldValue} onChange={(event) => setCustomFieldValue(event.target.value)} placeholder="Contém o valor..." className="h-8" />}
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          {(leadSearch || activeFilterCount > 0 || customFieldValue) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="mr-1 size-3.5" />
              {t("clearFilters")}
            </Button>
          )}
        </div>
      )}
      {pipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20">
          <GitBranch className="h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium text-foreground">
            {t("noPipelinesYet")}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("createToStartTracking")}
          </p>
          <GatedButton
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("createPipeline")}
          </GatedButton>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card/60">
            <button
              type="button"
              onClick={() => setAnalyticsOpen((open) => !open)}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-foreground hover:bg-muted/50"
              aria-expanded={analyticsOpen}
            >
              <span>Resumo do funil</span>
              {analyticsOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
            {analyticsOpen && <div className="border-t border-border p-3"><PipelineAnalytics stages={stages} deals={filteredDeals} /></div>}
          </div>
          <PipelineBoard
            stages={stages}
            deals={filteredDeals}
            onDealMoved={handleDealMoved}
            onRenameStage={handleRenameStage}
            onAddDeal={handleAddDeal}
            onEditDeal={handleEditDeal}
            members={members}
            onValueChange={handleQuickValue}
            onStatusChange={handleQuickStatus}
            onAddNote={(deal) => setQuickNoteDeal(deal)}
            onScheduleTask={(deal) => setTaskDeal(deal)}
            onAssign={handleQuickAssign}
            tags={tags}
            onToggleTag={handleToggleTag}
            cardLayout={selectedCardLayout}
          />
        </>
      )}

      <Dialog open={layoutOpen} onOpenChange={setLayoutOpen}>
        <DialogContent className="sm:max-w-md bg-popover border-border">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">Layout do cartão</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">Escolha as informações que aparecerão nos cartões deste funil.</p>
            {[
              ["show_value", "Valor do lead"],
              ["show_created_at", "Data de criação do contato"],
              ["show_last_message", "Última mensagem"],
            ].map(([key, label]) => {
              const layoutKey = key as keyof Pick<PipelineCardLayout, "show_value" | "show_created_at" | "show_last_message">;
              return (
                <label key={key} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-sm text-foreground hover:bg-muted/50">
                  {label}
                  <Switch checked={cardLayoutDraft[layoutKey]} onCheckedChange={(checked) => setCardLayoutDraft((current) => ({ ...current, [layoutKey]: checked }))} />
                </label>
              );
            })}
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-sm font-medium text-foreground">Campos personalizados</p>
              <p className="text-xs text-muted-foreground">Eles aparecem abaixo do botão para chamar no WhatsApp.</p>
              {customFields.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum campo personalizado criado nesta conta.</p>
              ) : (
                <div className="space-y-2">
                  {customFields.map((field) => {
                    const checked = cardLayoutDraft.custom_field_ids.includes(field.id);
                    return (
                      <label key={field.id} className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setCardLayoutDraft((current) => ({
                            ...current,
                            custom_field_ids: checked
                              ? current.custom_field_ids.filter((id) => id !== field.id)
                              : [...current.custom_field_ids, field.id],
                          }))}
                          className="size-4 accent-primary"
                        />
                        {field.field_name}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="bg-popover/50 border-border">
            <Button variant="outline" onClick={() => setLayoutOpen(false)} className="border-border text-muted-foreground hover:bg-muted">Cancelar</Button>
            <Button onClick={() => void saveCardLayout()} className="bg-primary text-primary-foreground hover:bg-primary/90">Salvar layout</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Pipeline Dialog */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent className="sm:max-w-sm bg-popover border-border">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("newPipeline")}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-muted-foreground">{t("pipelineName")}</Label>
            <Input
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              placeholder={t("pipelineNamePlaceholder")}
              className="mt-2 bg-muted border-border text-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreatePipeline();
              }}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {t("defaultStagesDesc")}
            </p>
          </div>
          <DialogFooter className="bg-popover/50 border-border">
            <Button
              variant="outline"
              onClick={() => setNewPipelineOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleCreatePipeline}
              disabled={creating || !newPipelineName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creating ? t("creating") : t("createPipelineBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline Settings */}
      {selectedPipeline && (
        <PipelineSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeline={selectedPipeline}
          stages={stages}
          onPipelinesChanged={refreshPipelines}
          onStagesChanged={refreshStages}
          onCreateNewPipeline={() => {
            setSettingsOpen(false);
            setNewPipelineOpen(true);
          }}
        />
      )}

      <Dialog
        open={Boolean(quickNoteDeal)}
        onOpenChange={(open) => {
          if (!open) {
            setQuickNoteDeal(null);
            setQuickNote("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md bg-popover border-border">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("quickNoteTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-muted-foreground">
              {quickNoteDeal?.contact?.name || quickNoteDeal?.contact?.phone || quickNoteDeal?.title}
            </Label>
            <Textarea
              autoFocus
              value={quickNote}
              onChange={(event) => setQuickNote(event.target.value)}
              placeholder={t("quickNotePlaceholder")}
              className="min-h-28 bg-muted border-border text-foreground"
            />
          </div>
          <DialogFooter className="bg-popover/50 border-border">
            <Button
              variant="outline"
              onClick={() => {
                setQuickNoteDeal(null);
                setQuickNote("");
              }}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={() => void saveQuickNote()}
              disabled={savingQuickNote || !quickNote.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {savingQuickNote ? t("savingNote") : t("saveNote")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deal Form (Sheet) */}
      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={editingDeal}
        pipelineId={selectedPipelineId}
        stages={stages}
        defaultStageId={defaultStageId}
        onSaved={refreshDeals}
      />

      <TaskForm
        open={Boolean(taskDeal)}
        onOpenChange={(open) => {
          if (!open) setTaskDeal(null);
        }}
        defaultDeal={taskDeal}
        onSaved={() => setTaskDeal(null)}
      />
    </div>
  );
}
