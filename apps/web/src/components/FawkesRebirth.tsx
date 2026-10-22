// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useRef, useState, type ReactNode } from "react";

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
  milestonesEnabled?: boolean;
  highContrast?: boolean;
  spokenChanges?: boolean;
  reducedMotion?: boolean;
  /** Localized strings supplied by the host, with no event/user data interpolated. */
  labels: Record<FawkesCelebration["kind"], string>;
  /** Injected speech backend; host controls availability and consent. */
  speak?: (text: string) => void;
}

/** Lightweight original CSS pulse; no asset downloads or persistent celebration scores. */
export function FawkesRebirth({ celebration, children, milestonesEnabled = false,
  highContrast = false, spokenChanges = false, reducedMotion = false, labels, speak,
}: FawkesRebirthProps) {
  const lastId = useRef<number | null>(null);
  const [display, setDisplay] = useState<FawkesCelebration | null>(null);
  useEffect(() => {
    if (!celebration || celebration.id === lastId.current || !Number.isSafeInteger(celebration.id)) return;
    lastId.current = celebration.id;
    if (celebration.kind !== "rebirth" && !milestonesEnabled) return;
    setDisplay(celebration);
    if (spokenChanges) speak?.(labels[celebration.kind]);
  }, [celebration, milestonesEnabled, spokenChanges, speak, labels]);
  const message = display ? labels[display.kind] : "";
  return (
    <span className={`fawkes-rebirth${highContrast ? " fawkes-rebirth--contrast" : ""}`}
      data-celebration={display?.kind ?? "none"}>
      <span className={display && !reducedMotion ? "fawkes-rebirth__pulse" : undefined}
        key={display?.id ?? "none"}>{children}</span>
      <span className="fawkes-rebirth__status" role="status" aria-live="polite" aria-atomic="true">{message}</span>
    </span>
  );
}

/** Host stylesheet can import this constant once; animation is cosmetic and short-lived. */
export const FAWKES_REBIRTH_CSS = `
.fawkes-rebirth { display: inline-flex; flex-direction: column; align-items: center; }
.fawkes-rebirth__status { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.fawkes-rebirth__pulse { display: inline-block; animation: phoenix-rebirth 650ms ease-out 1; }
@keyframes phoenix-rebirth { 0% { transform: scale(.92); opacity: .7; } 55% { transform: scale(1.09); opacity: 1; } 100% { transform: scale(1); } }
.fawkes-rebirth--contrast .fawkes { background: #000; outline: 2px solid #fff; border-radius: 50%; }
.fawkes-rebirth--contrast .fawkes-art svg { filter: grayscale(1) contrast(3); }
@media (prefers-reduced-motion: reduce) { .fawkes-rebirth__pulse { animation: none; } }
@media (forced-colors: active) { .fawkes-rebirth--contrast .fawkes { outline: 2px solid ButtonText; } .fawkes-rebirth--contrast .fawkes-art svg { filter: none; } }
`;
