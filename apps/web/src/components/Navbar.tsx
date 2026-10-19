// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { visualFor } from "@phoenix/pet-states";
import { forwardRef } from "react";
import type { ConnectionStatus, PetState } from "../core/types";
import { useWornOutfit, WARDROBE_ROUTE } from "../core/appearance";
import { usePetSettings } from "../core/hooks";
import { FawkesAvatar, type FawkesAvatarHandle } from "./FawkesAvatar";
import { NotificationCenter } from "./NotificationCenter";

const CONNECTION_TEXT: Record<ConnectionStatus, string | null> = {
  online: null,
  connecting: "Connecting…",
  offline: "Offline",
  unauthenticated: "Not connected",
};

export interface NavbarProps {
  state: PetState;
  connection: ConnectionStatus;
  panelOpen: boolean;
  panelId: string;
  /** Current hash route, to mark the active link. */
  route?: string;
  onToggleFawkes: () => void;
}

export const Navbar = forwardRef<FawkesAvatarHandle, NavbarProps>(function Navbar(
  { state, connection, panelOpen, panelId, route = "/", onToggleFawkes },
  ref,
) {
  const connectionText = CONNECTION_TEXT[connection];
  const { data: petSettings } = usePetSettings();
  const outfit = useWornOutfit();
  return (
    <header className="navbar">
      <a className="brand" href="#/" aria-label="Phoenix home">
        <span aria-hidden="true">🐦‍🔥</span> <span className="brand-name">Phoenix</span>
      </a>
      <nav aria-label="Main" className="nav-links">
        <a href="#/meetings" aria-current={route.startsWith("/meetings") ? "page" : undefined}>
          Meetings
        </a>
        <a href="#/provenance" aria-current={route.startsWith("/provenance") ? "page" : undefined}>
          Provenance
        </a>
        <a href="#/agents" aria-current={route.startsWith("/agents") ? "page" : undefined}>
          Agents
        </a>
        <a href="#/workflows" aria-current={route.startsWith("/workflows") ? "page" : undefined}>
          Workflows
        </a>
        <a href="#/recap" aria-current={route === "/recap" ? "page" : undefined}>
          Recap
        </a>
        <a href="#/settings" aria-current={route === "/settings" ? "page" : undefined}>
          Settings
        </a>
      </nav>
      {/* Right-click Fawkes: the Wardrobe (the desktop pet's native menu opens the same route). */}
      <div
        className="navbar-fawkes"
        onContextMenu={(e) => {
          e.preventDefault();
          window.location.hash = `#${WARDROBE_ROUTE}`;
        }}
      >
        {state.recording && (
          <span className="rec-pill" role="status">
            <span className="rec-dot" aria-hidden="true" /> Recording
          </span>
        )}
        {connectionText && (
          <span className={`conn conn-${connection}`} role="status">
            {connectionText}
          </span>
        )}
        {/* The recording pill already names the state; showing it twice crowds Fawkes off narrow screens. */}
        {!connectionText && !state.recording && (
          <span className="state-text" aria-hidden="true">
            {visualFor(state.state).label}
          </span>
        )}
        {connection === "online" && <NotificationCenter />}
        <FawkesAvatar
          ref={ref}
          state={state}
          expanded={panelOpen}
          controls={panelId}
          reducedMotion={petSettings.reduced_motion}
          outfit={outfit}
          onActivate={onToggleFawkes}
        />
      </div>
    </header>
  );
});
