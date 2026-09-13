'use client';

import { useEffect, useState } from 'react';
import type {
  Deal,
  DealStatus,
  PipelineCardLayout,
  PipelineStage,
  Profile,
  Tag,
} from '@/types';
import {
  CalendarPlus,
  Kanban,
  CheckCircle2,
  CircleX,
  MessageCircle,
  Phone,
  Save,
  StickyNote,
  Tag as TagIcon,
  UserRound,
} from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { useTranslations } from 'next-intl';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
  onMoveStage?: (dealId: string, stageId: string) => Promise<void>;
  layout?: PipelineCardLayout;
  isOverlay?: boolean;
}

const DEFAULT_LAYOUT: PipelineCardLayout = {
  show_value: true,
  show_created_at: true,
  show_last_message: true,
  show_notes: true,
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
  const t = useTranslations('Pipelines.card');
  const [editingValue, setEditingValue] = useState(false);
  const [value, setValue] = useState(String(deal.value ?? 0));
  const [savingValue, setSavingValue] = useState(false);
  const [movingStageId, setMovingStageId] = useState<string | null>(null);

  useEffect(() => setValue(String(deal.value ?? 0)), [deal.id, deal.value]);

  const contactName =
    deal.contact?.name?.trim() || deal.title || t('noContact');
  const phone = deal.contact?.phone || t('noPhone');
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
  const whatsappPhone = deal.contact?.phone?.replace(/\D/g, '');
  const whatsappUrl = whatsappPhone ? `https://wa.me/${whatsappPhone}` : null;
  const customValues = (deal.contact?.custom_values ?? []).filter(
    (item) =>
      item.custom_field &&
      layout.custom_field_ids.includes(item.custom_field.id) &&
      item.value
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
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onEdit(deal);
        }
      }}
      className={`group border-border/50 bg-muted/70 focus-visible:ring-ring relative w-full cursor-pointer rounded-xl border px-3 py-3 text-left shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none ${
        isOverlay
          ? 'shadow-xl'
          : 'hover:border-border hover:bg-muted hover:-translate-y-0.5 hover:shadow-lg'
      }`}
    >
      <span
        aria-hidden
        className="absolute top-0 left-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? '#94a3b8' }}
      />

      <div className="min-w-0 pl-1">
        <div className="flex items-center gap-1">
          <h4
            className="text-foreground min-w-0 flex-1 truncate text-sm font-semibold"
            title={contactName}
          >
            {contactName}
          </h4>
          {!isOverlay && stages.length > 1 && onMoveStage ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                title="Mover no Kanban"
                aria-label="Mover no Kanban"
                onClick={stopCardInteraction}
                onPointerDown={stopCardInteraction}
                className="text-muted-foreground hover:bg-muted hover:text-primary rounded p-1"
              >
                <Kanban className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="min-w-40"
                onClick={stopCardInteraction}
                onPointerDown={stopCardInteraction}
              >
                {stages.map((candidate) => (
                  <DropdownMenuItem
                    key={candidate.id}
                    disabled={
                      candidate.id === deal.stage_id || movingStageId !== null
                    }
                    onClick={(event) => {
                      stopCardInteraction(event);
                      setMovingStageId(candidate.id);
                      void onMoveStage(deal.id, candidate.id).finally(() =>
                        setMovingStageId(null)
                      );
                    }}
                  >
                    <span
                      className="mr-2 size-2 rounded-full"
                      style={{ backgroundColor: candidate.color }}
                    />
                    {candidate.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        <p className="text-muted-foreground mt-0.5 flex items-center gap-1 truncate text-xs">
          <Phone className="size-3 shrink-0" />
          {phone}
          {layout.show_created_at && deal.contact?.created_at ? (
            <span
              className="ml-auto truncate text-[10px]"
              title={`Criado em ${new Date(deal.contact.created_at).toLocaleDateString('pt-BR')}`}
            >
              Criado em:{' '}
              {new Date(deal.contact.created_at).toLocaleDateString('pt-BR')}
            </span>
          ) : null}
        </p>
      </div>

      {layout.show_value && (
        <div className="mt-3 pl-1">
          {editingValue && !isOverlay ? (
            <div
              className="flex items-center gap-1"
              onClick={stopCardInteraction}
              onPointerDown={stopCardInteraction}
            >
              <input
                autoFocus
                type="number"
                min="0"
                step="0.01"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onBlur={() => void commitValue()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void commitValue();
                  if (event.key === 'Escape') {
                    setValue(String(deal.value ?? 0));
                    setEditingValue(false);
                  }
                }}
                aria-label={t('editValue')}
                className="border-primary bg-background text-foreground h-7 min-w-0 flex-1 rounded-md border px-2 text-sm font-semibold outline-none"
              />
              <Save
                className={`text-primary size-3.5 ${savingValue ? 'animate-pulse' : ''}`}
              />
            </div>
          ) : (
            <button
              type="button"
              title={t('editValue')}
              aria-label={t('editValue')}
              disabled={isOverlay}
              onClick={(event) => {
                stopCardInteraction(event);
                setEditingValue(true);
              }}
              onPointerDown={stopCardInteraction}
              className="text-primary hover:text-primary/75 focus-visible:ring-ring rounded-md text-sm font-bold transition-colors outline-none focus-visible:ring-2 disabled:cursor-default"
            >
              {formatCurrency(deal.value, deal.currency)}
            </button>
          )}
        </div>
      )}

      {layout.show_last_message && (
        <p
          className="border-border text-muted-foreground mt-3 line-clamp-2 min-h-10 border-l-2 pl-2 text-xs leading-5"
          title={lastMessage || undefined}
        >
          {lastMessage || t('noRecentMessage')}
        </p>
      )}

      {whatsappUrl && !isOverlay && (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${t('openWhatsApp')} — ${contactName}`}
          onClick={stopCardInteraction}
          onPointerDown={stopCardInteraction}
          onKeyDown={stopCardInteraction}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#25D366] px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#20bd5b] focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <MessageCircle className="size-3.5" />
          {t('openWhatsApp')}
        </a>
      )}

      {layout.show_notes && deal.notes?.trim() && (
        <div
          className="border-primary/40 text-muted-foreground mt-3 flex gap-1.5 border-l-2 pl-2 text-xs leading-5"
          title={deal.notes}
        >
          <StickyNote className="text-primary mt-0.5 size-3.5 shrink-0" />
          <p className="line-clamp-3">{deal.notes}</p>
        </div>
      )}

      {customValues.length > 0 && (
        <div className="border-border/70 mt-3 space-y-1 border-t pt-2 pl-1">
          {customValues.map((item) => (
            <div
              key={item.custom_field!.id}
              className="flex items-baseline gap-1.5 text-xs"
            >
              <span className="text-muted-foreground shrink-0">
                {item.custom_field!.field_name}:
              </span>
              <span
                className="text-foreground min-w-0 truncate"
                title={item.value ?? undefined}
              >
                {item.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {!isOverlay && (
        <div
          className="border-border/70 mt-3 flex items-center justify-between gap-0.5 border-t pt-2"
          onPointerDown={stopCardInteraction}
        >
          <button
            type="button"
            title={t('markWon')}
            aria-label={t('markWon')}
            onClick={(event) => {
              stopCardInteraction(event);
              void onStatusChange(deal, 'won');
            }}
            className="rounded-md p-1.5 text-emerald-600 transition-colors hover:bg-emerald-500/10 dark:text-emerald-400"
          >
            <CheckCircle2 className="size-4" />
          </button>
          <button
            type="button"
            title={t('markLost')}
            aria-label={t('markLost')}
            onClick={(event) => {
              stopCardInteraction(event);
              void onStatusChange(deal, 'lost');
            }}
            className="rounded-md p-1.5 text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
          >
            <CircleX className="size-4" />
          </button>
          <button
            type="button"
            title={t('addNote')}
            aria-label={t('addNote')}
            disabled={!deal.contact_id}
            onClick={(event) => {
              stopCardInteraction(event);
              onAddNote(deal);
            }}
            className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            <StickyNote className="size-4" />
          </button>
          <button
            type="button"
            title={t('scheduleTask')}
            aria-label={t('scheduleTask')}
            disabled={!deal.contact_id}
            onClick={(event) => {
              stopCardInteraction(event);
              onScheduleTask(deal);
            }}
            className="text-muted-foreground hover:bg-muted hover:text-primary rounded-md p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CalendarPlus className="size-4" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              title={t('manageTags')}
              aria-label={t('manageTags')}
              onClick={stopCardInteraction}
              onPointerDown={stopCardInteraction}
              className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1.5 transition-colors"
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
                <DropdownMenuItem disabled>{t('noTags')}</DropdownMenuItem>
              ) : (
                tags.map((tag) => {
                  const selected = deal.contact?.tags?.some(
                    (currentTag) => currentTag.id === tag.id
                  );
                  return (
                    <DropdownMenuItem
                      key={tag.id}
                      onSelect={(event) => {
                        event.stopPropagation();
                        void onToggleTag(deal, tag);
                      }}
                    >
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
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
              title={t('assignLead')}
              aria-label={t('assignLead')}
              onClick={stopCardInteraction}
              onPointerDown={stopCardInteraction}
              className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1.5 transition-colors"
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
                {t('unassigned')}
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
