// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT, type MessageKey } from "../i18n";
import "./fawkes-rebirth.css";

/** Only results of createCelebrationGate may be passed here; never derive recovery from PetState. */
export interface FawkesCelebration {
  kind: "rebirth" | "first-green-week" | "pr-streak";
  /** A monotonic delivery ID, not a user or repository identifier. */
  id: number;
}

export interface FawkesRebirthProps {
  celebration?: FawkesCelebration | null;
  /** The existing FawkesAvatar; appearance never replaces the pet's semantic state. */
  children: ReactNode;
  /** Opt-in. Milestones are ignored (not queued) while this is false; rebirth is unaffected. */
  milestonesEnabled?: boolean;
  /** Black-and-white Fawkes with a visible outline. */
  highContrast?: boolean;
  /** Announce the celebration through `speak`. Off by default. */
  spokenChanges?: boolean;
  /** Skip the pulse entirely (the CSS media query also disables it for OS-level reduced motion). */
  reducedMotion?: boolean;
  /** Injected speech backend; host controls availability and consent. */
  speak?: (text: string) => void;
}

const MESSAGE: Record<FawkesCelebration["kind"], MessageKey> = {
  rebirth: "fawkesRebirth.rebirth",
  "first-green-week": "fawkesRebirth.firstGreenWeek",
  "pr-streak": "fawkesRebirth.prStreak",
};

/** Short original CSS pulse around Fawkes plus a polite live-region announcement. No scores. */
export function FawkesRebirth({
  celebration,
  children,
  milestonesEnabled = false,
  highContrast = false,
  spokenChanges = false,
  reducedMotion = false,
  speak,
}: FawkesRebirthProps) {
  const t = useT();
  const lastId = useRef<number | null>(null);
  const [display, setDisplay] = useState<FawkesCelebration | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!celebration || !Number.isSafeInteger(celebration.id)) return;
    if (celebration.id === lastId.current) return;
    lastId.current = celebration.id;
    if (celebration.kind !== "rebirth" && !milestonesEnabled) return;
    setDisplay(celebration);
    setPlaying(!reducedMotion);
    if (spokenChanges) speak?.(t(MESSAGE[celebration.kind]));
  }, [celebration, milestonesEnabled, spokenChanges, reducedMotion, speak, t]);
  const shown = display && (display.kind === "rebirth" || milestonesEnabled) ? display : null;
  const pulse = playing && !reducedMotion && shown !== null;
  return (
    <span
      className={`fawkes-rebirth${highContrast ? " fawkes-rebirth--contrast" : ""}`}
      data-celebration={shown?.kind ?? "none"}
    >
      <span
        className={
          pulse ? "fawkes-rebirth__pulse fawkes-rebirth__pulse--playing" : "fawkes-rebirth__pulse"
        }
        key={shown?.id ?? "none"}
        onAnimationEnd={() => setPlaying(false)}
      >
        {children}
      </span>
      <span className="fawkes-rebirth__status" role="status" aria-live="polite" aria-atomic="true">
        {shown ? t(MESSAGE[shown.kind]) : ""}
      </span>
    </span>
  );
}
