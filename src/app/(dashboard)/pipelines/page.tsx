"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Contact, Pipeline, PipelineStage, Deal, DealStatus, Profile, Tag } from "@/types";
import { PipelineBoard } from "@/components/pipelines/pipeline-board";
import { PipelineSettings } from "@/components/pipelines/pipeline-settings";
import { DealForm } from "@/components/pipelines/deal-form";
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
import { GitBranch, Plus, ChevronDown, Settings, Search, Tags, X } from "lucide-react";
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
  const [leadSearch, setLeadSearch] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

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

  // Guard against double-seeding (React StrictMode double-effect in dev).
  const seedAttempted = useRef(false);

  const loadPipelines = useCallback(async () => {
    const { data, error } = await supabase
      .from("pipelines")
      .select("*")
      .order("created_at");
    if (error) {
      console.error("Failed to load pipelines:", error.message);
      return [];
    }
    return data ?? [];
  }, [supabase]);

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
      const { data } = await supabase
        .from("deals")
        .select("*, contact:contacts(*, conversations(last_message_text,last_message_at), contact_tags(tags(*))), assignee:profiles!deals_assigned_to_fkey(*)")
        .eq("pipeline_id", pipelineId)
        .order("created_at", { ascending: false });
      return (data ?? []).map((row) => {
        const contact = row.contact as
          | (Contact & { contact_tags?: { tags: Tag | null }[] })
          | null;
        return {
          ...row,
          contact: contact
            ? {
                ...contact,
                tags: (contact.contact_tags ?? [])
                  .map((link) => link.tags)
                  .filter((tag): tag is Tag => Boolean(tag)),
              }
            : undefined,
        } as Deal;
      });
    },
    [supabase],
  );

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;

    (async () => {
      const [profilesResult, tagsResult] = await Promise.all([
        supabase.from("profiles").select("*").eq("account_id", accountId).order("full_name"),
        supabase.from("tags").select("*").eq("account_id", accountId).order("name"),
      ]);

      if (cancelled) return;
      if (!profilesResult.error) setMembers((profilesResult.data ?? []) as Profile[]);
      if (!tagsResult.error) setTags((tagsResult.data ?? []) as Tag[]);
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
    let cancelled = false;
    (async () => {
      setLoading(true);
      let list = await loadPipelines();

      if (list.length === 0 && !seedAttempted.current) {
        seedAttempted.current = true;
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
  }, [loadPipelines, seedDefaultPipeline]);

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
      note_text: quickNote.trim(),
    });
    setSavingQuickNote(false);
    if (error) {
      toast.error(t("toastFailedQuickUpdate"));
      return;
    }
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
    return matchesSearch && matchesTags;
  });

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
              <Tags className="size-4" />
              {t("filterTags")}
              {selectedTagIds.length > 0 && (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[11px] text-primary-foreground">
                  {selectedTagIds.length}
                </span>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuItem onSelect={() => setSelectedTagIds([])}>
                {t("allTags")}
              </DropdownMenuItem>
              {tags.length > 0 && <DropdownMenuSeparator />}
              {tags.map((tag) => {
                const selected = selectedTagIds.includes(tag.id);
                return (
                  <DropdownMenuItem
                    key={tag.id}
                    onSelect={() =>
                      setSelectedTagIds((current) =>
                        selected ? current.filter((id) => id !== tag.id) : [...current, tag.id],
                      )
                    }
                  >
                    <span className="size-2 rounded-full" style={{ backgroundColor: tag.color }} />
                    <span className="flex-1">{tag.name}</span>
                    {selected && <span aria-hidden>✓</span>}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          {(leadSearch || selectedTagIds.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setLeadSearch("");
                setSelectedTagIds([]);
              }}
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
          <PipelineAnalytics stages={stages} deals={filteredDeals} />
          <PipelineBoard
            stages={stages}
            deals={filteredDeals}
            onDealMoved={handleDealMoved}
            onAddDeal={handleAddDeal}
            onEditDeal={handleEditDeal}
            members={members}
            onValueChange={handleQuickValue}
            onStatusChange={handleQuickStatus}
            onAddNote={(deal) => setQuickNoteDeal(deal)}
            onAssign={handleQuickAssign}
            tags={tags}
            onToggleTag={handleToggleTag}
          />
        </>
      )}

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
    </div>
  );
}
