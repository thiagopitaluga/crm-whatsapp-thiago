"use client";

import { useEffect, useState } from "react";
import type { Deal, DealStatus, PipelineCardLayout, PipelineStage, Profile, Tag } from "@/types";
import {
  CalendarPlus,
  GitBranch,
  CheckCircle2,
  CircleX,
  MessageCircle,
  Phone,
  Save,
  StickyNote,
  Tag as TagIcon,
  UserRound,
} from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  members: Profile[];
  onValueChange: (deal: Deal, value: number) => Promise<void>;
  onStatusChange: (deal: Deal, status: DealStatus) => Promise<void>;
  onAddNote: (deal: Deal) => void;
  onScheduleTask: (deal: Deal) => void;
  onAssign: (deal: Deal, assigneeId: string | null) => Promise<void>;
  tags: Tag[];
  onToggleTag: (deal: Deal, tag: Tag) => Promise<void>;
  stages?: PipelineStage[];
  onMoveStage?: (dealId: string, stageId: string) => void;
  layout?: PipelineCardLayout;
  isOverlay?: boolean;
}

const DEFAULT_LAYOUT: PipelineCardLayout = {
  show_value: true,
  show_created_at: true,
  show_last_message: true,
  custom_field_ids: [],
};

function stopCardInteraction(event: React.SyntheticEvent) {
  event.stopPropagation();
}

export function DealCard({
  deal,
  stage,
  onEdit,
  members,
  onValueChange,
  onStatusChange,
  onAddNote,
  onScheduleTask,
  onAssign,
  tags,
  onToggleTag,
  stages = [],
  onMoveStage,
  layout = DEFAULT_LAYOUT,
  isOverlay,
}: DealCardProps) {
  const t = useTranslations("Pipelines.card");
  const [editingValue, setEditingValue] = useState(false);
  const [value, setValue] = useState(String(deal.value ?? 0));
  const [savingValue, setSavingValue] = useState(false);

  useEffect(() => setValue(String(deal.value ?? 0)), [deal.id, deal.value]);

  const contactName = deal.contact?.name?.trim() || deal.title || t("noContact");
  const phone = deal.contact?.phone || t("noPhone");
  const latestConversation = deal.contact?.conversations?.reduce<
    (typeof deal.contact.conversations)[number] | undefined
  >(
    (latest, conversation) =>
      !latest ||
      new Date(conversation.last_message_at ?? 0).getTime() >
        new Date(latest.last_message_at ?? 0).getTime()
        ? conversation
        : latest,
    undefined
  );
  const lastMessage = latestConversation?.last_message_text;
  const whatsappPhone = deal.contact?.phone?.replace(/\D/g, "");
  const whatsappUrl = whatsappPhone ? `https://wa.me/${whatsappPhone}` : null;
  const customValues = (deal.contact?.custom_values ?? []).filter((item) =>
    item.custom_field && layout.custom_field_ids.includes(item.custom_field.id) && item.value,
  );

  async function commitValue() {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue) || nextValue < 0) {
      setValue(String(deal.value ?? 0));
      setEditingValue(false);
      return;
    }
    if (nextValue === Number(deal.value ?? 0)) {
      setEditingValue(false);
      return;
    }
    setSavingValue(true);
    await onValueChange(deal, nextValue);
    setSavingValue(false);
    setEditingValue(false);
  }

  return (
    <div
      role="button"
      tabIndex={isOverlay ? -1 : 0}
      onClick={(event) => {
        if (isOverlay) return;
        event.stopPropagation();
        onEdit(deal);
      }}
      onKeyDown={(event) => {
        if (isOverlay || event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onEdit(deal);
        }
      }}
      className={`group relative w-full cursor-pointer rounded-xl border border-border/50 bg-muted/70 px-3 py-3 text-left shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        isOverlay
          ? "shadow-xl"
          : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
      }`}
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      <div className="min-w-0 pl-1">
        <div className="flex items-center gap-1">
          <h4 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" title={contactName}>{contactName}</h4>
          {!isOverlay && stages.length > 1 && onMoveStage ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                title="Mudar de etapa"
                aria-label="Mudar de etapa"
                onClick={stopCardInteraction}
                onPointerDown={stopCardInteraction}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-primary"
              ><GitBranch className="size-3.5" /></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40" onClick={stopCardInteraction} onPointerDown={stopCardInteraction}>
                {stages.map((candidate) => (
                  <DropdownMenuItem key={candidate.id} disabled={candidate.id === deal.stage_id} onSelect={(event) => { event.stopPropagation(); onMoveStage(deal.id, candidate.id); }}>
                    <span className="mr-2 size-2 rounded-full" style={{ backgroundColor: candidate.color }} />
                    {candidate.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
          <Phone className="size-3 shrink-0" />
          {phone}
          {layout.show_created_at && deal.contact?.created_at ? (
            <span className="ml-auto truncate text-[10px]" title={`Criado em ${new Date(deal.contact.created_at).toLocaleDateString('pt-BR')}`}>
              Criado em: {new Date(deal.contact.created_at).toLocaleDateString('pt-BR')}
            </span>
          ) : null}
        </p>
      </div>

      {layout.show_value && <div className="mt-3 pl-1">
        {editingValue && !isOverlay ? (
          <div className="flex items-center gap-1" onClick={stopCardInteraction} onPointerDown={stopCardInteraction}>
            <input
              autoFocus
              type="number"
              min="0"
              step="0.01"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onBlur={() => void commitValue()}
              onKeyDown={(event) => {
                if (event.key === "Enter") void commitValue();
                if (event.key === "Escape") {
                  setValue(String(deal.value ?? 0));
                  setEditingValue(false);
                }
              }}
              aria-label={t("editValue")}
              className="h-7 min-w-0 flex-1 rounded-md border border-primary bg-background px-2 text-sm font-semibold text-foreground outline-none"
            />
            <Save className={`size-3.5 text-primary ${savingValue ? "animate-pulse" : ""}`} />
          </div>
        ) : (
          <button
            type="button"
            title={t("editValue")}
            aria-label={t("editValue")}
            disabled={isOverlay}
            onClick={(event) => {
              stopCardInteraction(event);
              setEditingValue(true);
            }}
            onPointerDown={stopCardInteraction}
            className="rounded-md text-sm font-bold text-primary outline-none transition-colors hover:text-primary/75 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
          >
            {formatCurrency(deal.value, deal.currency)}
          </button>
        )}
      </div>}

      {layout.show_last_message && (
        <p className="mt-3 line-clamp-2 min-h-10 border-l-2 border-border pl-2 text-xs leading-5 text-muted-foreground" title={lastMessage || undefined}>
          {lastMessage || t("noRecentMessage")}
        </p>
      )}

      {whatsappUrl && !isOverlay && (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${t("openWhatsApp")} — ${contactName}`}
          onClick={stopCardInteraction}
          onPointerDown={stopCardInteraction}
          onKeyDown={stopCardInteraction}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#25D366] px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#20bd5b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2"
        >
          <MessageCircle className="size-3.5" />
          {t("openWhatsApp")}
        </a>
      )}

      {customValues.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-border/70 pt-2 pl-1">
          {customValues.map((item) => (
            <div key={item.custom_field!.id} className="flex items-baseline gap-1.5 text-xs">
              <span className="shrink-0 text-muted-foreground">{item.custom_field!.field_name}:</span>
              <span className="min-w-0 truncate text-foreground" title={item.value ?? undefined}>{item.value}</span>
            </div>
          ))}
        </div>
      )}

      {!isOverlay && (
        <div className="mt-3 flex items-center justify-between gap-0.5 border-t border-border/70 pt-2" onPointerDown={stopCardInteraction}>
          <button
            type="button"
            title={t("markWon")}
            aria-label={t("markWon")}
            onClick={(event) => {
              stopCardInteraction(event);
              void onStatusChange(deal, "won");
            }}
            className="rounded-md p-1.5 text-emerald-600 transition-colors hover:bg-emerald-500/10 dark:text-emerald-400"
          >
            <CheckCircle2 className="size-4" />
          </button>
          <button
            type="button"
            title={t("markLost")}
            aria-label={t("markLost")}
            onClick={(event) => {
              stopCardInteraction(event);
              void onStatusChange(deal, "lost");
            }}
            className="rounded-md p-1.5 text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
          >
            <CircleX className="size-4" />
          </button>
          <button
            type="button"
            title={t("addNote")}
            aria-label={t("addNote")}
            disabled={!deal.contact_id}
            onClick={(event) => {
              stopCardInteraction(event);
              onAddNote(deal);
            }}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <StickyNote className="size-4" />
          </button>
          <button
            type="button"
            title={t("scheduleTask")}
            aria-label={t("scheduleTask")}
            disabled={!deal.contact_id}
            onClick={(event) => {
              stopCardInteraction(event);
              onScheduleTask(deal);
            }}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CalendarPlus className="size-4" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              title={t("manageTags")}
              aria-label={t("manageTags")}
              onClick={stopCardInteraction}
              onPointerDown={stopCardInteraction}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <TagIcon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-48"
              onClick={stopCardInteraction}
              onPointerDown={stopCardInteraction}
            >
              {tags.length === 0 ? (
                <DropdownMenuItem disabled>{t("noTags")}</DropdownMenuItem>
              ) : (
                tags.map((tag) => {
                  const selected = deal.contact?.tags?.some((currentTag) => currentTag.id === tag.id);
                  return (
                    <DropdownMenuItem
                      key={tag.id}
                      onSelect={(event) => {
                        event.stopPropagation();
                        void onToggleTag(deal, tag);
                      }}
                    >
                      <span className="size-2 rounded-full" style={{ backgroundColor: tag.color }} />
                      <span className="flex-1">{tag.name}</span>
                      {selected && <span aria-hidden>✓</span>}
                    </DropdownMenuItem>
                  );
                })
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              title={t("assignLead")}
              aria-label={t("assignLead")}
              onClick={stopCardInteraction}
              onPointerDown={stopCardInteraction}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <UserRound className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-44"
              onClick={stopCardInteraction}
              onPointerDown={stopCardInteraction}
            >
              <DropdownMenuItem
                onSelect={(event) => {
                  event.stopPropagation();
                  void onAssign(deal, null);
                }}
              >
                {t("unassigned")}
              </DropdownMenuItem>
              {members.length > 0 && <DropdownMenuSeparator />}
              {members.map((member) => (
                <DropdownMenuItem
                  key={member.id}
                  onSelect={(event) => {
                    event.stopPropagation();
                    void onAssign(deal, member.id);
                  }}
                >
                  {member.full_name || member.email}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
