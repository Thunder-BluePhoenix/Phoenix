// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useId, useRef, useState } from "react";
import type { FawkesAvatarHandle } from "./components/FawkesAvatar";
import { MeetingDetail, MeetingsPage } from "./components/Meetings";
import { Navbar } from "./components/Navbar";
import { PetPanel } from "./components/PetPanel";
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

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    avatar.current?.focus();
  }, []);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
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
      {panelOpen && <PetPanel id={panelId} state={state} tasks={tasks} onClose={closePanel} />}
      <main id="main" className="content">
        {connection !== "unauthenticated" && route === "/meetings" ? (
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
