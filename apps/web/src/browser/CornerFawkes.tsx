// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useMemo } from "react";
import { RebirthAvatar } from "../components/RebirthAvatar";
import { useWornOutfit } from "../core/appearance";
import type { PetSettings } from "../core/hooks";
import type { PetState } from "../core/types";
import { useT } from "../i18n";
import type { CornerView } from "./corner";

/** The corner Fawkes is small: it is a status light, not a companion. */
export const CORNER_SIZE = 26;

/**
 * Phase 93: Fawkes in the corner of the browser CHROME window (never in a page: the pages are
 * separate content webviews and nothing here is injected into them). It is the existing pet runtime
 * showing an existing display state; `view.explanation` is a translated message of Phoenix's own, so
 * page text never reaches it. It honours the pet's reduced-motion setting and has no click action.
 */
export function CornerFawkes({
  view,
  reducedMotion,
}: {
  view: CornerView;
  reducedMotion: PetSettings["reduced_motion"];
}) {
  const t = useT();
  // The same outfit and celebration wrapper the island, the floating window and the navbar use, so
  // the corner is the same Fawkes, not a plainer copy of it.
  const outfit = useWornOutfit();
  const explanation = t(view.explanation, view.vars);
  const state = useMemo<PetState>(
    () => ({
      state: view.state,
      explanation,
      since: new Date(0).toISOString(),
      recording: false,
      sleeping: view.state === "SLEEPING",
    }),
    [view.state, explanation],
  );
  return (
    <div className="browser-corner" data-state={view.state}>
      <RebirthAvatar
        state={state}
        size={CORNER_SIZE}
        actionHint=""
        interactive={false}
        reducedMotion={reducedMotion}
        outfit={outfit}
      />
    </div>
  );
}
