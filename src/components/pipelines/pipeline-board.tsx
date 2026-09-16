'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type {
  Deal,
  DealStatus,
  PipelineCardLayout,
  PipelineStage,
  Profile,
  Tag,
} from '@/types';
import { DealCard } from './deal-card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { useTranslations } from 'next-intl';

interface PipelineBoardProps {
  stages: PipelineStage[];
  deals: Deal[];
  onDealMoved: (dealId: string, newStageId: string) => Promise<void>;
  onRenameStage: (stageId: string, name: string) => Promise<void>;
  onAddDeal: (stageId: string) => void;
  onEditDeal: (deal: Deal) => void;
  members: Profile[];
  onValueChange: (deal: Deal, value: number) => Promise<void>;
  onStatusChange: (deal: Deal, status: DealStatus) => Promise<void>;
  onAddNote: (deal: Deal) => void;
  onScheduleTask: (deal: Deal) => void;
  onAssign: (deal: Deal, assigneeId: string | null) => Promise<void>;
  tags: Tag[];
  onToggleTag: (deal: Deal, tag: Tag) => Promise<void>;
  onCreateTag: (deal: Deal) => void;
  cardLayout: PipelineCardLayout;
}

export function PipelineBoard({
  stages,
  deals,
  onDealMoved,
  onRenameStage,
  onAddDeal,
  onEditDeal,
  members,
  onValueChange,
  onStatusChange,
  onAddNote,
  onScheduleTask,
  onAssign,
  tags,
  onToggleTag,
  onCreateTag,
  cardLayout,
}: PipelineBoardProps) {
  const { defaultCurrency } = useAuth();
  const [activeDealId, setActiveDealId] = useState<string | null>(null);
  const [boardScrollElement, setBoardScrollElement] =
    useState<HTMLDivElement | null>(null);

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages]
  );

  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const stage of sortedStages) map.set(stage.id, []);
    for (const deal of deals) {
      const bucket = map.get(deal.stage_id);
      if (bucket) bucket.push(deal);
    }
    return map;
  }, [sortedStages, deals]);

  const sensors = useSensors(
    // 5px activation distance avoids clicks being interpreted as drags.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Keyboard drag support: focus a card, Space to pick up, arrows to move,
    // Space to drop, Escape to cancel.
    useSensor(KeyboardSensor)
  );

  const activeDeal = activeDealId
    ? (deals.find((d) => d.id === activeDealId) ?? null)
    : null;

  // Keep the board itself at the available viewport height. Each stage then
  // owns its vertical list scroll, leaving the browser's native horizontal
  // scrollbar permanently attached to the board's lower edge.
  useEffect(() => {
    if (!boardScrollElement) return;

    const updateBoardHeight = () => {
      const top = boardScrollElement.getBoundingClientRect().top;
      const dashboardMain = boardScrollElement.closest('main');
      const bottom = dashboardMain
        ? dashboardMain.getBoundingClientRect().bottom
        : window.innerHeight;
      const availableHeight = Math.max(280, bottom - top);
      boardScrollElement.style.setProperty(
        '--pipeline-board-height',
        `${availableHeight}px`
      );
    };

    updateBoardHeight();
    window.addEventListener('resize', updateBoardHeight);
    const observer = new ResizeObserver(updateBoardHeight);
    if (boardScrollElement.parentElement) {
      observer.observe(boardScrollElement.parentElement);
    }

    return () => {
      window.removeEventListener('resize', updateBoardHeight);
      observer.disconnect();
    };
  }, [boardScrollElement, sortedStages.length, deals.length]);

  function handleDragStart(event: DragStartEvent) {
    setActiveDealId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDealId(null);
    const { active, over } = event;
    if (!over) return;
    const dealId = String(active.id);
    const targetStageId = String(over.id);

    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage_id === targetStageId) return;
    if (!sortedStages.some((s) => s.id === targetStageId)) return;

    void onDealMoved(dealId, targetStageId);
  }

  function handleDragCancel() {
    setActiveDealId(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {/* Horizontal scrolling belongs to this fixed-height board, rather than
          to the page. Its native scrollbar is therefore always at the bottom
          of the Kanban; each column scrolls its own cards vertically. */}
      <div
        ref={setBoardScrollElement}
        className="pipeline-scroll flex h-[var(--pipeline-board-height)] snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-hidden lg:snap-none"
      >
        {sortedStages.map((stage) => {
          const stageDeals = dealsByStage.get(stage.id) ?? [];
          const totalValue = stageDeals.reduce(
            (s, d) => s + Number(d.value || 0),
            0
          );
          return (
            <StageColumn
              key={stage.id}
              stage={stage}
              deals={stageDeals}
              totalValue={totalValue}
              currency={defaultCurrency}
              onAddDeal={onAddDeal}
              onRenameStage={onRenameStage}
              onEditDeal={onEditDeal}
              members={members}
              onValueChange={onValueChange}
              onStatusChange={onStatusChange}
              onAddNote={onAddNote}
              onScheduleTask={onScheduleTask}
              onAssign={onAssign}
              tags={tags}
              onToggleTag={onToggleTag}
              onCreateTag={onCreateTag}
              stages={sortedStages}
              onMoveStage={onDealMoved}
              layout={cardLayout}
            />
          );
        })}
      </div>

      <DragOverlay
        dropAnimation={{
          duration: 200,
          easing: 'cubic-bezier(0.2, 0, 0, 1)',
        }}
      >
        {activeDeal ? (
          <div className="opacity-90">
            <DealCard
              deal={activeDeal}
              stage={
                sortedStages.find((s) => s.id === activeDeal.stage_id) ?? null
              }
              onEdit={() => {}}
              isOverlay
              members={[]}
              onValueChange={async () => {}}
              onStatusChange={async () => {}}
              onAddNote={() => {}}
              onScheduleTask={() => {}}
              onAssign={async () => {}}
              tags={[]}
              onToggleTag={async () => {}}
              onCreateTag={() => {}}
              stages={[]}
              layout={cardLayout}
            />
          </div>
        ) : null}
      </DragOverlay>

      <style jsx>{`
        .pipeline-scroll {
          scroll-behavior: smooth;
        }
        /* On touch devices the peek/snap layout already signals there's
           more to swipe, so the scrollbar is hidden for a clean look.
           On desktop (mouse) the board can overflow with many stages
           and there is no peek hint, so keep a thin, themed scrollbar
           visible at the board's bottom. */
        @media (hover: none), (pointer: coarse) {
          .pipeline-scroll::-webkit-scrollbar {
            height: 0;
            display: none;
          }
          .pipeline-scroll {
            scrollbar-width: none;
          }
        }
        @media (hover: hover) and (pointer: fine) {
          .pipeline-scroll {
            scrollbar-width: thin;
            scrollbar-color: var(--border) transparent;
          }
          .pipeline-scroll::-webkit-scrollbar {
            height: 8px;
          }
          .pipeline-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .pipeline-scroll::-webkit-scrollbar-thumb {
            background-color: var(--border);
            border-radius: 9999px;
          }
          .pipeline-scroll::-webkit-scrollbar-thumb:hover {
            background-color: var(--muted-foreground);
          }
        }
      `}</style>
    </DndContext>
  );
}

function StageColumn({
  stage,
  deals,
  totalValue,
  currency,
  onAddDeal,
  onRenameStage,
  onEditDeal,
  members,
  onValueChange,
  onStatusChange,
  onAddNote,
  onScheduleTask,
  onAssign,
  tags,
  onToggleTag,
  onCreateTag,
  stages,
  onMoveStage,
  layout,
}: {
  stage: PipelineStage;
  deals: Deal[];
  totalValue: number;
  currency: string;
  onAddDeal: (stageId: string) => void;
  onRenameStage: (stageId: string, name: string) => Promise<void>;
  onEditDeal: (deal: Deal) => void;
  members: Profile[];
  onValueChange: (deal: Deal, value: number) => Promise<void>;
  onStatusChange: (deal: Deal, status: DealStatus) => Promise<void>;
  onAddNote: (deal: Deal) => void;
  onScheduleTask: (deal: Deal) => void;
  onAssign: (deal: Deal, assigneeId: string | null) => Promise<void>;
  tags: Tag[];
  onToggleTag: (deal: Deal, tag: Tag) => Promise<void>;
  onCreateTag: (deal: Deal) => void;
  stages: PipelineStage[];
  onMoveStage: (dealId: string, stageId: string) => Promise<void>;
  layout: PipelineCardLayout;
}) {
  const t = useTranslations('Pipelines.board');
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(stage.name);

  function saveName() {
    const nextName = name.trim();
    setEditingName(false);
    if (!nextName || nextName === stage.name) {
      setName(stage.name);
      return;
    }
    void onRenameStage(stage.id, nextName);
  }

  return (
    // On mobile each column is `w-[85vw]` (with a reasonable min/max)
    // so the next column's edge peeks in — a "there's more here" hint.
    // snap-start lands each column cleanly when swiping. On lg+ we
    // restore the flex-1 share-the-row behavior. The droppable ref is
    // on the inner messages region below — intentionally NOT here, so
    // a drag over the column header doesn't highlight the whole column.
    <div className="border-border bg-card/60 flex h-full min-h-0 w-[85vw] max-w-[320px] min-w-[260px] shrink-0 snap-start flex-col rounded-xl border p-4 lg:w-auto lg:max-w-none lg:flex-1 lg:shrink lg:basis-[260px] lg:snap-none">
      {/* 3px colored top border — sits above the column's padding */}
      <div
        className="-mx-4 -mt-4 h-[3px] rounded-t-xl"
        style={{ backgroundColor: stage.color }}
      />
      <div className="flex items-center justify-between gap-2 pt-3">
        {editingName ? (
          <input
            autoFocus
            value={name}
            placeholder="Novo nome de etapa"
            aria-label="Novo nome de etapa"
            onChange={(event) => setName(event.target.value)}
            onBlur={saveName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveName();
              if (event.key === 'Escape') {
                setName(stage.name);
                setEditingName(false);
              }
            }}
            className="border-primary bg-background text-foreground h-7 min-w-0 flex-1 rounded border px-2 text-sm font-semibold outline-none"
          />
        ) : (
          <button
            type="button"
            title="Editar nome da etapa"
            onClick={() => setEditingName(true)}
            className="text-foreground hover:text-primary min-w-0 flex-1 truncate text-left text-sm font-semibold"
          >
            {stage.name}
          </button>
        )}
        <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium">
          {deals.length}
        </span>
      </div>
      <p className="text-muted-foreground text-xs">
        {formatCurrency(totalValue, currency)}
      </p>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => onAddDeal(stage.id)}
        className="border-border text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground mt-3 w-full justify-start border border-dashed bg-transparent"
      >
        <Plus className="mr-1 h-3 w-3" />
        {t('addDeal')}
      </Button>

      <div
        ref={setNodeRef}
        className={`mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1 transition-all ${
          isOver
            ? 'bg-primary/5 outline-primary outline outline-2 outline-offset-2 outline-dashed'
            : ''
        }`}
      >
        {deals.length === 0 ? (
          <div className="border-border text-muted-foreground flex flex-1 items-center justify-center rounded-lg border-2 border-dashed py-10 text-xs">
            {t('dropDealHere')}
          </div>
        ) : (
          deals.map((deal) => (
            <DraggableDealCard
              key={deal.id}
              deal={deal}
              stage={stage}
              onEdit={onEditDeal}
              members={members}
              onValueChange={onValueChange}
              onStatusChange={onStatusChange}
              onAddNote={onAddNote}
              onScheduleTask={onScheduleTask}
              onAssign={onAssign}
              tags={tags}
              onToggleTag={onToggleTag}
              onCreateTag={onCreateTag}
              stages={stages}
              onMoveStage={onMoveStage}
              layout={layout}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DraggableDealCard({
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
  onCreateTag,
  stages,
  onMoveStage,
  layout,
}: {
  deal: Deal;
  stage: PipelineStage;
  onEdit: (deal: Deal) => void;
  members: Profile[];
  onValueChange: (deal: Deal, value: number) => Promise<void>;
  onStatusChange: (deal: Deal, status: DealStatus) => Promise<void>;
  onAddNote: (deal: Deal) => void;
  onScheduleTask: (deal: Deal) => void;
  onAssign: (deal: Deal, assigneeId: string | null) => Promise<void>;
  tags: Tag[];
  onToggleTag: (deal: Deal, tag: Tag) => Promise<void>;
  onCreateTag: (deal: Deal) => void;
  stages: PipelineStage[];
  onMoveStage: (dealId: string, stageId: string) => Promise<void>;
  layout: PipelineCardLayout;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.3 : 1, touchAction: 'none' }}
    >
      <DealCard
        deal={deal}
        stage={stage}
        onEdit={onEdit}
        members={members}
        onValueChange={onValueChange}
        onStatusChange={onStatusChange}
        onAddNote={onAddNote}
        onScheduleTask={onScheduleTask}
        onAssign={onAssign}
        tags={tags}
        onToggleTag={onToggleTag}
        onCreateTag={onCreateTag}
        stages={stages}
        onMoveStage={onMoveStage}
        layout={layout}
      />
    </div>
  );
}
