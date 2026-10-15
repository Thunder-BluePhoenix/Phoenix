// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { fawkes, type FawkesAsset } from "@phoenix/pet-assets";
import { completionEvent, visualFor, type InteractionEmote } from "@phoenix/pet-states";
import { attachDrag, type DragEvent } from "./interaction";
import { createInteractionEngine, type InteractionConfig } from "./interaction-engine";
import type { SoundPlayer } from "./sounds";
import type { SoundEvent } from "@phoenix/pet-assets";
import { BASE_CSS, ensureStyles } from "./styles";

/** What the runtime renders; a subset of the core state snapshot. */
export interface FawkesView {
  state: string;
  explanation?: string;
  recording?: boolean;
  /** Condition key behind the shown state (state snapshot `key`). */
  key?: string;
  /**
   * The state snapshot's conditions. Used only to recognise a real, fresh completion event for the
   * happy jump; it never changes the state that is shown.
   */
  conditions?: unknown[];
}

/** Injected time so interactions are testable without real timers. */
export interface InteractionTimers {
  now(): number;
  random(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface InteractionOptions {
  timers?: InteractionTimers;
  config?: Partial<InteractionConfig>;
  /** Plays the sound bound to a real event (policy lives in the player). Omit for a silent pet. */
  sounds?: SoundPlayer;
  /** Greet once at mount (the app launched). Default true. */
  greetOnMount?: boolean;
  /** Where the cursor is tracked (default: the document). */
  cursorTarget?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
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
  /** Opt in to Phase 59 interactions: greeting, gaze, hover, poke, dizzy, completion jump. */
  interactions?: InteractionOptions;
}

export interface EmoteEvent {
  phase: "start" | "end";
  emote: InteractionEmote;
}

export interface FawkesEvents {
  activate: void;
  drag: DragEvent;
  /** A transient interaction emote started/ended. This is not a state change. */
  emote: EmoteEvent;
}

export interface FawkesController {
  readonly element: HTMLButtonElement;
  update(view: FawkesView): void;
  /** The app just launched: play the greeting (if calm). */
  greet(): void;
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
  const asset = options.asset ?? fawkes;
  ensureStyles(doc, "phoenix-fawkes-base", BASE_CSS);
  // Emote CSS comes after the state CSS so an emote may override a state animation briefly.
  ensureStyles(doc, `phoenix-fawkes-asset-${asset.id}`, `${asset.css}\n${asset.emoteCss}`);

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
    emote: new Set(),
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
    engine?.click();
    schedule();
    emit("activate", undefined);
  };
  el.addEventListener("click", onClick);

  // Pause animations while the page is hidden (no wasted CPU/GPU).
  const onVisibility = () =>
    el.setAttribute("data-paused", String(doc.visibilityState === "hidden"));
  doc.addEventListener("visibilitychange", onVisibility);
  onVisibility();

  // Interactions (opt-in). The engine is pure; this block only wires it to the DOM and the timers.
  const interactions = options.interactions;
  const timers: InteractionTimers = interactions?.timers ?? {
    now: () => Date.now(),
    random: () => Math.random(),
    setTimeout: (fn, ms) => win?.setTimeout(fn, ms),
    clearTimeout: (handle) => win?.clearTimeout(handle as number),
  };
  const engine = interactions
    ? createInteractionEngine({
        now: timers.now,
        random: timers.random,
        ...(interactions.config ? { config: interactions.config } : {}),
      })
    : null;
  let wake: unknown = null;
  const schedule = () => {
    if (!engine) return;
    if (wake !== null) timers.clearTimeout(wake);
    wake = null;
    const ms = engine.nextWakeMs();
    if (ms === null) return;
    wake = timers.setTimeout(
      () => {
        wake = null;
        engine.step();
        schedule();
      },
      Math.max(1, ms),
    );
  };
  const EMOTE_SOUND: Partial<Record<InteractionEmote, SoundEvent>> = {
    greet: "launch",
    poke: "poke",
    dizzy: "dizzy",
    recover: "recover",
    jump: "completion",
  };
  const offEngine = engine?.subscribe((change) => {
    if (change.kind === "emote-start") {
      const { emote, variant } = change.active;
      el.setAttribute("data-emote", emote);
      if (variant) el.setAttribute("data-emote-variant", variant);
      emit("emote", { phase: "start", emote });
      const sound = EMOTE_SOUND[emote];
      if (sound) void interactions?.sounds?.trigger(sound);
    } else if (change.kind === "emote-end") {
      // A newer emote that replaced this one has already set its own attributes.
      if (engine?.active() === null) {
        el.removeAttribute("data-emote");
        el.removeAttribute("data-emote-variant");
      }
      emit("emote", { phase: "end", emote: change.ended.emote });
    } else {
      el.style.setProperty("--fawkes-look-x", `${(change.gaze.x * 1.3).toFixed(3)}px`);
      el.style.setProperty("--fawkes-look-y", `${(change.gaze.y * 1.1).toFixed(3)}px`);
    }
  });
  const cursorTarget = interactions?.cursorTarget ?? doc;
  const onCursor = (e: Event) => {
    const { clientX, clientY } = e as PointerEvent;
    if (typeof clientX !== "number" || typeof clientY !== "number") return;
    const box = el.getBoundingClientRect();
    // The eye sits right of centre and a little above it in the artwork.
    engine?.setCursorOffset(
      clientX - (box.left + box.width * 0.62),
      clientY - (box.top + box.height * 0.45),
    );
    schedule();
  };
  const onLeave = () => {
    engine?.clearCursor();
    schedule();
  };
  const onEnter = () => {
    engine?.hover();
    schedule();
  };
  if (engine) {
    cursorTarget.addEventListener("pointermove", onCursor);
    doc.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointerenter", onEnter);
  }

  // Reduced motion.
  let reducedPref: boolean | "auto" = options.reducedMotion ?? "auto";
  const media = win?.matchMedia?.(REDUCED_MOTION_QUERY);
  const applyReduced = () => {
    const reduced = reducedPref === "auto" ? Boolean(media?.matches) : reducedPref;
    el.setAttribute("data-reduced-motion", String(reduced));
    engine?.setReducedMotion(reduced);
  };
  media?.addEventListener?.("change", applyReduced);
  applyReduced();

  let last: { state: string; explanation: string; recording: boolean } | null = null;

  const STATE_SOUND: Partial<Record<string, SoundEvent>> = {
    WAITING: "needs-you",
    ERROR: "failure",
  };

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
    if (engine) {
      engine.setRealState(view.state);
      // The jump answers a real completion event found in the state snapshot, never the state alone.
      const completion = completionEvent(view, timers.now());
      if (completion) engine.completion(completion.eventId);
      const sound = STATE_SOUND[view.state];
      if (sound && last?.state !== view.state) void interactions?.sounds?.trigger(sound);
      schedule();
    }
    last = { state: view.state, explanation, recording };
  };

  update({ state: "IDLE" });
  if (engine && interactions?.greetOnMount !== false) {
    engine.launch();
    schedule();
  }

  return {
    element: el,
    update,
    greet() {
      engine?.launch();
      schedule();
    },
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
      if (engine) {
        cursorTarget.removeEventListener("pointermove", onCursor);
        doc.removeEventListener("pointerleave", onLeave);
        el.removeEventListener("pointerenter", onEnter);
        offEngine?.();
        if (wake !== null) timers.clearTimeout(wake);
      }
      listeners.activate.clear();
      listeners.drag.clear();
      listeners.emote.clear();
      el.remove();
    },
  };
}
