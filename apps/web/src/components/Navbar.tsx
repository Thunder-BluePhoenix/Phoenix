// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { visualFor } from "@phoenix/pet-states";
import { forwardRef } from "react";
import type { ConnectionStatus, PetState } from "../core/types";
import { useWornOutfit, WARDROBE_ROUTE } from "../core/appearance";
import { usePetSettings } from "../core/hooks";
import { FawkesAvatar, type FawkesAvatarHandle } from "./FawkesAvatar";
import { NotificationCenter } from "./NotificationCenter";
import { isMessageKey, useT, type MessageKey } from "../i18n";

const CONNECTION_TEXT: Record<ConnectionStatus, MessageKey | null> = {
  online: null,
  connecting: "common.connection.connecting",
  offline: "common.connection.offline",
  unauthenticated: "common.connection.notConnected",
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
  const t = useT();
  const connectionKey = CONNECTION_TEXT[connection];
  const connectionText = connectionKey ? t(connectionKey) : null;
  const stateKey = `common.petState.${state.state}`;
  const stateText = isMessageKey(stateKey) ? t(stateKey) : visualFor(state.state).label;
  const { data: petSettings } = usePetSettings();
  const outfit = useWornOutfit();
  return (
    <header className="navbar">
      <a className="brand" href="#/" aria-label={t("shell.nav.home")}>
        <span aria-hidden="true">🐦‍🔥</span> <span className="brand-name">Phoenix</span>
      </a>
      <nav aria-label={t("shell.nav.main")} className="nav-links">
        <a href="#/meetings" aria-current={route.startsWith("/meetings") ? "page" : undefined}>
          {t("shell.nav.meetings")}
        </a>
        <a href="#/provenance" aria-current={route.startsWith("/provenance") ? "page" : undefined}>
          {t("shell.nav.provenance")}
        </a>
        <a href="#/agents" aria-current={route.startsWith("/agents") ? "page" : undefined}>
          {t("shell.nav.agents")}
        </a>
        <a href="#/workflows" aria-current={route.startsWith("/workflows") ? "page" : undefined}>
          {t("shell.nav.workflows")}
        </a>
        <a href="#/mission" aria-current={route === "/mission" ? "page" : undefined}>
          {t("mission.nav")}
        </a>
        <a href="#/calendar" aria-current={route === "/calendar" ? "page" : undefined}>
          {t("calendar.title")}
        </a>
        <a href="#/digest" aria-current={route.startsWith("/digest") ? "page" : undefined}>
          {t("digest.title")}
        </a>
        <a href="#/recap" aria-current={route === "/recap" ? "page" : undefined}>
          {t("shell.nav.recap")}
        </a>
        <a href="#/settings" aria-current={route === "/settings" ? "page" : undefined}>
          {t("shell.nav.settings")}
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
            <span className="rec-dot" aria-hidden="true" /> {t("shell.nav.recording")}
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
            {stateText}
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
