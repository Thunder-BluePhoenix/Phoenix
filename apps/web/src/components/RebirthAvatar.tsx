// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { forwardRef } from "react";
import { useCelebration, useRebirthSettings } from "../core/rebirth";
import { FawkesAvatar, type FawkesAvatarHandle, type FawkesAvatarProps } from "./FawkesAvatar";
import { FawkesRebirth } from "./FawkesRebirth";

/**
 * The avatar every Fawkes view shows, wrapped in the Phase 91 celebration. Core decides when to
 * celebrate (a fixed build on the same pipeline); this only draws it. `reducedMotion` keeps the
 * avatar's own meaning: "on" skips the pulse, "auto" leaves it to the OS media query in the CSS.
 */
export const RebirthAvatar = forwardRef<FawkesAvatarHandle, FawkesAvatarProps>(
  function RebirthAvatar(props, ref) {
    const celebration = useCelebration();
    const { data } = useRebirthSettings();
    return (
      <FawkesRebirth
        celebration={celebration}
        milestonesEnabled={data.milestones}
        highContrast={data.highContrast}
        reducedMotion={props.reducedMotion === "on"}
      >
        <FawkesAvatar ref={ref} {...props} />
      </FawkesRebirth>
    );
  },
);
