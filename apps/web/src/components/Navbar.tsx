// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { visualFor } from "@phoenix/pet-states";
import { forwardRef } from "react";
import type { ConnectionStatus, PetState } from "../core/types";
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
  return (
    <header className="navbar">
      <a className="brand" href="#/" aria-label="Phoenix home">
        <span aria-hidden="true">🐦‍🔥</span> <span className="brand-name">Phoenix</span>
      </a>
      <nav aria-label="Main" className="nav-links">
        <a href="#/" aria-current={route === "/" ? "page" : undefined}>
          Home
        </a>
        <a href="#/meetings" aria-current={route.startsWith("/meetings") ? "page" : undefined}>
          Meetings
        </a>
      </nav>
      <div className="navbar-fawkes">
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
          onActivate={onToggleFawkes}
        />
      </div>
    </header>
  );
});
