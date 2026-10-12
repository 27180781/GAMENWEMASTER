/**
 * גרירה של חלונית צפה על המסך הראשי — «המצלמה שלי» (HostSelfView.tsx) וחלונית
 * הבמה (StageHostViews.tsx). הקואורדינטות של הבמה (1920×1080), שמוקטנת
 * ב-transform; החישובים עצמם ב-selfView.ts.
 *
 * תזוזה קטנה היא לחיצה (`onTap`) ולא גרירה, כדי שלחיצה על הכפתור הממוזער
 * תפתח אותו ולא תזיז אותו בפיקסל.
 */

import { useRef, useState, type PointerEvent } from 'react';
import { STAGE_WIDTH } from '../../render/Stage.tsx';
import { dragSelfView, isDrag, type Point, type Size } from './selfView.ts';

/** כמה פיקסלים במסך הם פיקסל אחד בבמה (הבמה מוקטנת ב-transform). */
function stageScaleOf(el: Element): number {
  const width = el.closest('.stage')?.getBoundingClientRect().width ?? 0;
  return width > 0 ? width / STAGE_WIDTH : 1;
}

interface DragState {
  id: number;
  start: Point;
  pointer: Point;
  scale: number;
  moved: boolean;
  last: Point;
}

export interface FloatingDragOptions {
  /** איפה החלונית מוצגת עכשיו. */
  shown: Point;
  /** הגודל שלה עכשיו — הגבול של הגרירה. */
  size: Size;
  /** תוך כדי גרירה. */
  onMove: (pos: Point) => void;
  /** סוף הגרירה — המקום לשמור. */
  onDrop: (pos: Point) => void;
  /** לחיצה בלי גרירה. */
  onTap: () => void;
}

export interface FloatingDragHandlers {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
}

export function useFloatingDrag(options: FloatingDragOptions): {
  dragging: boolean;
  handlers: FloatingDragHandlers;
} {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<DragState | null>(null);
  const latest = useRef(options);
  latest.current = options;

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const { shown } = latest.current;
    drag.current = {
      id: event.pointerId,
      start: shown,
      pointer: { x: event.clientX, y: event.clientY },
      scale: stageScaleOf(event.currentTarget),
      moved: false,
      last: shown,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (d === null || d.id !== event.pointerId) return;
    const now = { x: event.clientX, y: event.clientY };
    if (!d.moved && !isDrag(d.pointer, now)) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
    }
    d.last = dragSelfView(d.start, d.pointer, now, d.scale, latest.current.size);
    latest.current.onMove(d.last);
  };

  const finish = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const d = drag.current;
    if (d === null || d.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (d.moved) {
      setDragging(false);
      const { size, onDrop } = latest.current;
      onDrop(
        cancelled
          ? d.last
          : dragSelfView(d.start, d.pointer, { x: event.clientX, y: event.clientY }, d.scale, size),
      );
      return;
    }
    if (!cancelled) latest.current.onTap();
  };

  return {
    dragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event) => finish(event, false),
      onPointerCancel: (event) => finish(event, true),
    },
  };
}
