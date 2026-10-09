// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FawkesAvatarHandle } from "./components/FawkesAvatar";
import { MeetingDetail, MeetingsPage } from "./components/Meetings";
import { Navbar } from "./components/Navbar";
import { SettingsPage } from "./components/Settings";
import { isTabId, PetPanel } from "./components/PetPanel";
import { useConnection, useDisplayedState, useTasks } from "./core/context";
import { useHashRoute } from "./core/hooks";

/** AppShell: navbar with Fawkes, Pet Panel, and the main content area. */
export function App() {
  const state = useDisplayedState();
  const connection = useConnection();
  const tasks = useTasks();
  const [panelOpen, setPanelOpen] = useState(false);
  const panelId = useId();
  const avatar = useRef<FawkesAvatarHandle>(null);
  const route = useHashRoute();
  const meetingId = /^\/meetings\/(.+)$/.exec(route)?.[1];
  const main = useRef<HTMLElement>(null);
  // "#/panel/<tab>" opens the Pet Panel on that tab: how the floating desktop pet sends you to
  // the approval it is waiting for (its own window is too small to hold the panel).
  const requestedTab = /^\/panel\/([a-z]+)$/.exec(route)?.[1];
  const panelRoute = isTabId(requestedTab) ? requestedTab : undefined;
  useEffect(() => {
    if (panelRoute) setPanelOpen(true);
  }, [route, panelRoute]);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    avatar.current?.focus();
  }, []);

  return (
    <div className="app-shell">
      {/* Not a plain #main link: the hash is the router, so that would navigate to a route "main". */}
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          main.current?.focus();
        }}
      >
        Skip to content
      </a>
      <Navbar
        ref={avatar}
        state={state}
        connection={connection}
        panelOpen={panelOpen}
        panelId={panelId}
        route={route}
        onToggleFawkes={() => (panelOpen ? closePanel() : setPanelOpen(true))}
      />
      {panelOpen && (
        <PetPanel
          key={panelRoute ? route : "panel"}
          id={panelId}
          state={state}
          tasks={tasks}
          onClose={closePanel}
          {...(panelRoute ? { initialTab: panelRoute } : {})}
        />
      )}
      <main id="main" ref={main} tabIndex={-1} className="content">
        {connection !== "unauthenticated" && route === "/settings" ? (
          <SettingsPage state={state} />
        ) : connection !== "unauthenticated" && route === "/meetings" ? (
          <MeetingsPage state={state} />
        ) : connection !== "unauthenticated" && meetingId ? (
          <MeetingDetail key={meetingId} id={decodeURIComponent(meetingId)} state={state} />
        ) : (
          <Home connection={connection} />
        )}
      </main>
    </div>
  );
}

function Home({ connection }: { connection: string }) {
  return (
    <>
      <h1>Phoenix</h1>
      <p className="lead">Phoenix is the platform. Fawkes is the pet.</p>
      {connection === "unauthenticated" ? (
        <p role="alert">
          This page has no session token. Open Phoenix from the address printed by{" "}
          <code>pnpm dev:core</code>.
        </p>
      ) : (
        <p className="muted">Click Fawkes in the top bar to see what Phoenix is doing.</p>
      )}
    </>
  );
}
