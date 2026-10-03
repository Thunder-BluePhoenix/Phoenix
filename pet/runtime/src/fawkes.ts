// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { placeholderFawkes, type FawkesAsset } from "@phoenix/pet-assets";
import { visualFor } from "@phoenix/pet-states";
import { attachDrag, type DragEvent } from "./interaction";
import { BASE_CSS, ensureStyles } from "./styles";

/** What the runtime renders; a subset of the core state snapshot. */
export interface FawkesView {
  state: string;
  explanation?: string;
  recording?: boolean;
}

export interface MountOptions {
  /** Rendered size in CSS pixels (default 32). */
  size?: number;
  /** true/false forces; "auto" follows prefers-reduced-motion (default). */
  reducedMotion?: boolean | "auto";
  asset?: FawkesAsset;
  /** Enable pointer dragging (floating desktop pet). */
  draggable?: boolean;
  /** Suffix for the accessible name, e.g. "Open Pet Panel". */
  actionHint?: string;
}

export interface FawkesEvents {
  activate: void;
  drag: DragEvent;
}

export interface FawkesController {
  readonly element: HTMLButtonElement;
  update(view: FawkesView): void;
  setReducedMotion(value: boolean | "auto"): void;
  on<K extends keyof FawkesEvents>(
    type: K,
    listener: (payload: FawkesEvents[K]) => void,
  ): () => void;
  destroy(): void;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Renders Fawkes into `container` as an accessible button.
 *
 * The runtime knows only display states; it never knows which integration
 * caused them (ADR-0007). State is always available as text through the
 * accessible name, tooltip and a live region — animation is supplementary.
 */
export function mountFawkes(container: HTMLElement, options: MountOptions = {}): FawkesController {
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const asset = options.asset ?? placeholderFawkes;
  ensureStyles(doc, "phoenix-fawkes-base", BASE_CSS);
  ensureStyles(doc, `phoenix-fawkes-asset-${asset.id}`, asset.css);

  const el = doc.createElement("button");
  el.type = "button";
  el.className = "fawkes";
  el.style.setProperty("--fawkes-size", `${options.size ?? 32}px`);

  const art = doc.createElement("span");
  art.className = "fawkes-art";
  art.innerHTML = asset.svg; // trusted, bundled artwork (no user input)

  const rec = doc.createElement("span");
  rec.className = "fawkes-rec";
  rec.hidden = true;
  rec.setAttribute("aria-hidden", "true");

  const live = doc.createElement("span");
  live.className = "fawkes-sr";
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");

  el.append(art, rec, live);
  container.appendChild(el);

  const listeners: { [K in keyof FawkesEvents]: Set<(p: FawkesEvents[K]) => void> } = {
    activate: new Set(),
    drag: new Set(),
  };
  const emit = <K extends keyof FawkesEvents>(type: K, payload: FawkesEvents[K]) => {
    for (const l of listeners[type]) {
      try {
        l(payload);
      } catch {
        // A faulty listener must not break the pet.
      }
    }
  };

  const drag = options.draggable ? attachDrag(el, (e) => emit("drag", e)) : null;
  const onClick = () => {
    if (drag?.consumeClick()) return;
    emit("activate", undefined);
  };
  el.addEventListener("click", onClick);

  // Pause animations while the page is hidden (no wasted CPU/GPU).
  const onVisibility = () =>
    el.setAttribute("data-paused", String(doc.visibilityState === "hidden"));
  doc.addEventListener("visibilitychange", onVisibility);
  onVisibility();

  // Reduced motion.
  let reducedPref: boolean | "auto" = options.reducedMotion ?? "auto";
  const media = win?.matchMedia?.(REDUCED_MOTION_QUERY);
  const applyReduced = () => {
    const reduced = reducedPref === "auto" ? Boolean(media?.matches) : reducedPref;
    el.setAttribute("data-reduced-motion", String(reduced));
  };
  media?.addEventListener?.("change", applyReduced);
  applyReduced();

  let last: { state: string; explanation: string; recording: boolean } | null = null;

  const update = (view: FawkesView) => {
    const visual = visualFor(view.state);
    const explanation = view.explanation?.trim() || visual.label;
    const recording = Boolean(view.recording);

    el.setAttribute("data-state", view.state);
    el.setAttribute("data-animation", visual.animation);
    el.setAttribute("data-tone", visual.tone);
    el.setAttribute("data-loop", String(visual.loop));
    rec.hidden = !recording;

    const parts = [`Fawkes — ${visual.label}`];
    if (explanation !== visual.label) parts.push(explanation);
    if (recording && view.state !== "RECORDING") parts.push("Recording active");
    const text = parts.join(". ");
    el.setAttribute("aria-label", options.actionHint ? `${text}. ${options.actionHint}` : text);
    el.title = text;

    if (
      !last ||
      last.state !== view.state ||
      last.explanation !== explanation ||
      last.recording !== recording
    ) {
      live.setAttribute("aria-live", visual.urgent ? "assertive" : "polite");
      live.textContent = text;
    }
    last = { state: view.state, explanation, recording };
  };

  update({ state: "IDLE" });

  return {
    element: el,
    update,
    setReducedMotion(value) {
      reducedPref = value;
      applyReduced();
    },
    on(type, listener) {
      listeners[type].add(listener as never);
      return () => listeners[type].delete(listener as never);
    },
    destroy() {
      el.removeEventListener("click", onClick);
      doc.removeEventListener("visibilitychange", onVisibility);
      media?.removeEventListener?.("change", applyReduced);
      drag?.detach();
      listeners.activate.clear();
      listeners.drag.clear();
      el.remove();
    },
  };
}
