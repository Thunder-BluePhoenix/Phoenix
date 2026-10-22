// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ALWAYS_CONFIRM, type Permission, type SideEffect } from "@phoenix/protocol";
import { COLORS, type LightState, type RGB } from "./devices";

/** Fixed key layout. A key's meaning comes from its position, never from event or device text. */
export const DECK_KEYS = { status: 0, approve: 1, deny: 2, record: 3, awake: 4 } as const;
export type DeckKey = keyof typeof DECK_KEYS;

export type DeckIcon =
  | "state-idle"
  | "state-working"
  | "state-waiting"
  | "state-error"
  | "state-recording"
  | "approve"
  | "deny"
  | "record"
  | "awake";

/** What a key shows. The host maps `icon` to Phoenix's own artwork; `label` is a short code. */
export interface DeckFace {
  icon: DeckIcon;
  color: RGB;
  label: string;
  /** False while pressing the key would do nothing (nothing pending, or not allowed). */
  enabled: boolean;
}

/** The Stream Deck as the trusted host exposes it. The plugin protocol itself lives in the host. */
export interface DeckSurface {
  setKey(key: number, face: DeckFace): void;
  /** Subscribes to physical key presses; returns an unsubscribe. */
  onKeyDown(handler: (key: number) => void): () => void;
}

/** A confirmation Core is waiting on. Only the fields the deck needs; no free text. */
export interface PendingApproval {
  id: string;
  capabilityId: string;
  command: string;
  sideEffect: SideEffect;
  permissions: readonly Permission[];
}

/** Every action a key can cause goes out through these ports (Core's permission gateway). */
export interface DeckActions {
  pending(): readonly PendingApproval[];
  resolve(confirmationId: string, approved: boolean): boolean;
  /**
   * Asks the Pet Panel to open the recording consent dialog. A key press is never consent, so
   * no audio starts from the deck; the person confirms on screen.
   */
  requestRecording(): void | Promise<void>;
  /** Starts keep-awake through Core's command path (`awake.start`), which asks for confirmation. */
  keepAwake(minutes: number): void | Promise<void>;
}

export interface DeckOptions {
  surface: DeckSurface;
  actions: DeckActions;
  /** Capability ids whose confirmations the approve key may approve. Empty: it approves nothing. */
  approveCapabilities: readonly string[];
  /** This capability's id: it can never approve its own consent requests from a key. */
  selfId: string;
  awakeMinutes: number;
  onError?: (key: DeckKey) => void;
}

const SAFE_NAME = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;
const NEUTRAL: RGB = [90, 90, 90];
const ACCENT: RGB = [40, 160, 90];
const REFUSE: RGB = [160, 40, 40];

const STATE_ICON: Readonly<Record<LightState, DeckIcon>> = {
  IDLE: "state-idle",
  WORKING: "state-working",
  WAITING: "state-waiting",
  ERROR: "state-error",
  RECORDING: "state-recording",
};

/**
 * Whether the approve key may approve `p`. Never for meeting recording, microphone, camera,
 * screen capture or production changes (those always need an on-screen confirmation), never for
 * this capability's own consent, and only for capabilities the user listed.
 */
export function deckMayApprove(
  p: PendingApproval,
  allowed: readonly string[],
  selfId: string,
): boolean {
  if (p.capabilityId === selfId || !allowed.includes(p.capabilityId)) return false;
  if (p.sideEffect !== "write" && p.sideEffect !== "execute") return false;
  return !p.permissions.some((permission) => ALWAYS_CONFIRM.has(permission));
}

/** Short, display-safe name of a pending approval; anything unexpected is hidden. */
function nameOf(p: PendingApproval): string {
  return SAFE_NAME.test(p.capabilityId) && SAFE_NAME.test(p.command)
    ? `${p.capabilityId} ${p.command}`.slice(0, 40)
    : "?";
}

export class StreamDeck {
  private off: (() => void) | undefined;
  private shown: LightState = "IDLE";

  constructor(private readonly options: DeckOptions) {}

  start(): void {
    if (this.off) return;
    this.off = this.options.surface.onKeyDown((key) => this.press(key));
    this.render();
  }

  stop(): void {
    this.off?.();
    this.off = undefined;
  }

  /** Redraws all keys. `shown` is what the lights show now (already dark under focus/quiet). */
  update(shown: LightState): void {
    this.shown = shown;
    if (this.off) this.render();
  }

  render(): void {
    const { surface, approveCapabilities, selfId } = this.options;
    surface.setKey(DECK_KEYS.status, {
      icon: STATE_ICON[this.shown],
      color: COLORS[this.shown],
      label: this.shown,
      enabled: false,
    });
    const pending = this.options.actions.pending();
    const next = pending[0];
    const approvable = pending.find((p) => deckMayApprove(p, approveCapabilities, selfId));
    surface.setKey(DECK_KEYS.approve, {
      icon: "approve",
      color: approvable ? ACCENT : NEUTRAL,
      label: approvable ? nameOf(approvable) : "",
      enabled: approvable !== undefined,
    });
    surface.setKey(DECK_KEYS.deny, {
      icon: "deny",
      color: next ? REFUSE : NEUTRAL,
      label: next ? nameOf(next) : "",
      enabled: next !== undefined,
    });
    surface.setKey(DECK_KEYS.record, {
      icon: "record",
      color: COLORS.RECORDING,
      label: "REC",
      enabled: true,
    });
    surface.setKey(DECK_KEYS.awake, {
      icon: "awake",
      color: COLORS.WORKING,
      label: `${this.options.awakeMinutes}m`,
      enabled: true,
    });
  }

  /** Runs a key's action; failures are contained and reported by key name only. */
  private press(key: number): void {
    const { actions, approveCapabilities, selfId } = this.options;
    const run = async (name: DeckKey, act: () => void | Promise<void>): Promise<void> => {
      try {
        await act();
      } catch {
        this.options.onError?.(name);
      }
      if (this.off) this.render();
    };
    switch (key) {
      case DECK_KEYS.approve: {
        const target = actions
          .pending()
          .find((p) => deckMayApprove(p, approveCapabilities, selfId));
        if (target) void run("approve", () => void actions.resolve(target.id, true));
        break;
      }
      case DECK_KEYS.deny: {
        const target = actions.pending()[0];
        if (target) void run("deny", () => void actions.resolve(target.id, false));
        break;
      }
      case DECK_KEYS.record:
        void run("record", () => actions.requestRecording());
        break;
      case DECK_KEYS.awake:
        void run("awake", () => actions.keepAwake(this.options.awakeMinutes));
        break;
      default:
        break; // the status key and unknown keys do nothing
    }
  }
}
