'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { PipelineStage } from '@/types';

interface KanbanNavigatorProps {
  boardRef: RefObject<HTMLDivElement | null>;
  stages: PipelineStage[];
}

interface ScrollMetrics {
  left: number;
  width: number;
  scrollWidth: number;
}

const EMPTY_METRICS: ScrollMetrics = { left: 0, width: 0, scrollWidth: 0 };

/**
 * A compact minimap for wide Kanban boards. It remains invisible while the
 * board fits on screen, and lets mouse, touch and keyboard users jump between
 * distant stages without exposing a native scrollbar.
 */
export function KanbanNavigator({ boardRef, stages }: KanbanNavigatorProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [metrics, setMetrics] = useState<ScrollMetrics>(EMPTY_METRICS);
  const [boardVisible, setBoardVisible] = useState(false);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;

    const updateMetrics = () => {
      setMetrics({
        left: board.scrollLeft,
        width: board.clientWidth,
        scrollWidth: board.scrollWidth,
      });
    };
    updateMetrics();

    const resizeObserver = new ResizeObserver(updateMetrics);
    resizeObserver.observe(board);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      setBoardVisible(entry.isIntersecting);
    });
    intersectionObserver.observe(board);
    board.addEventListener('scroll', updateMetrics, { passive: true });
    window.addEventListener('resize', updateMetrics);

    return () => {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      board.removeEventListener('scroll', updateMetrics);
      window.removeEventListener('resize', updateMetrics);
    };
  }, [boardRef, stages.length]);

  const maxScroll = Math.max(0, metrics.scrollWidth - metrics.width);
  if (!boardVisible || maxScroll <= 4 || stages.length < 2) return null;

  const viewportLeft = (metrics.left / metrics.scrollWidth) * 100;
  const viewportWidth = (metrics.width / metrics.scrollWidth) * 100;
  const progress = Math.round((metrics.left / maxScroll) * 100);

  const scrollToPointer = (clientX: number) => {
    const board = boardRef.current;
    const track = trackRef.current;
    if (!board || !track) return;
    const bounds = track.getBoundingClientRect();
    const position = Math.min(
      1,
      Math.max(0, (clientX - bounds.left) / bounds.width)
    );
    board.scrollLeft = Math.min(
      board.scrollWidth - board.clientWidth,
      Math.max(0, position * board.scrollWidth - board.clientWidth / 2)
    );
  };

  const stopDragging = (pointerId: number) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const board = boardRef.current;
    if (board) {
      board.style.scrollBehavior = '';
      board.style.scrollSnapType = '';
    }
    if (trackRef.current?.hasPointerCapture(pointerId)) {
      trackRef.current.releasePointerCapture(pointerId);
    }
  };

  return (
    <div className="border-border bg-popover/95 fixed right-5 bottom-[calc(0.5rem+env(safe-area-inset-bottom))] z-30 w-48 rounded-lg border p-1 shadow-lg backdrop-blur-sm">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Navegação horizontal do Kanban"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-valuetext={`${progress}% do funil percorrido`}
        title="Clique ou arraste para percorrer as etapas"
        className="focus-visible:ring-ring relative flex h-7 cursor-grab touch-none gap-0.5 rounded-md outline-none focus-visible:ring-2 active:cursor-grabbing"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          draggingRef.current = true;
          const board = boardRef.current;
          if (board) {
            board.style.scrollBehavior = 'auto';
            board.style.scrollSnapType = 'none';
          }
          scrollToPointer(event.clientX);
        }}
        onPointerMove={(event) => {
          if (draggingRef.current) scrollToPointer(event.clientX);
        }}
        onPointerUp={(event) => stopDragging(event.pointerId)}
        onPointerCancel={(event) => stopDragging(event.pointerId)}
        onKeyDown={(event) => {
          const board = boardRef.current;
          if (!board) return;
          const step = Math.max(160, board.clientWidth * 0.7);
          let left: number;
          switch (event.key) {
            case 'ArrowLeft':
              left = board.scrollLeft - step;
              break;
            case 'ArrowRight':
              left = board.scrollLeft + step;
              break;
            case 'Home':
              left = 0;
              break;
            case 'End':
              left = board.scrollWidth - board.clientWidth;
              break;
            default:
              return;
          }
          event.preventDefault();
          board.scrollTo({ left, behavior: 'smooth' });
        }}
      >
        {stages.map((stage) => (
          <span
            key={stage.id}
            aria-hidden="true"
            title={stage.name}
            className="bg-muted relative min-w-0 flex-1 rounded-sm"
          >
            <span
              className="absolute inset-x-0 top-0 h-1 rounded-t-sm"
              style={{ backgroundColor: stage.color }}
            />
          </span>
        ))}
        <span
          aria-hidden="true"
          className="border-primary bg-primary/15 pointer-events-none absolute inset-y-0 rounded border-2 shadow-sm"
          style={{ left: `${viewportLeft}%`, width: `${viewportWidth}%` }}
        />
      </div>
    </div>
  );
}
