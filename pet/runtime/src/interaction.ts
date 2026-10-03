// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

export interface DragEvent {
  phase: "start" | "move" | "end";
  /** Movement since the previous drag event, in CSS pixels. */
  dx: number;
  dy: number;
}

const DRAG_THRESHOLD_PX = 4;

/**
 * Pointer drag detection. A press that moves more than a few pixels becomes a
 * drag and suppresses the click that follows it.
 */
export function attachDrag(
  el: HTMLElement,
  onDrag: (e: DragEvent) => void,
): {
  consumeClick(): boolean;
  detach(): void;
} {
  let start: { x: number; y: number } | null = null;
  let last = { x: 0, y: 0 };
  let dragging = false;
  let suppressClick = false;

  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY };
    last = { ...start };
    dragging = false;
    el.setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!start) return;
    if (!dragging) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      onDrag({ phase: "start", dx: 0, dy: 0 });
    }
    onDrag({ phase: "move", dx: e.clientX - last.x, dy: e.clientY - last.y });
    last = { x: e.clientX, y: e.clientY };
  };
  const up = () => {
    if (dragging) {
      onDrag({ phase: "end", dx: 0, dy: 0 });
      suppressClick = true;
    }
    start = null;
    dragging = false;
  };

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);

  return {
    consumeClick() {
      const s = suppressClick;
      suppressClick = false;
      return s;
    },
    detach() {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    },
  };
}
