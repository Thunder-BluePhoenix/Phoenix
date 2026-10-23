// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { detectPlatform } from "./commands/keys";
import { buildBindings, COMMANDS, type CommandContext } from "./commands/registry";
import { tauriShortcuts } from "./commands/shortcuts-shell";
import { useShortcuts } from "./commands/useShortcuts";
import { AgentSessionDetail, AgentSessionsPage } from "./components/AgentSessions";
import { CommandPalette } from "./components/CommandPalette";
import { useOptionalDemo } from "./components/Demo";
import type { FawkesAvatarHandle } from "./components/FawkesAvatar";
import { MeetingDetail, MeetingsPage } from "./components/Meetings";
import { Navbar } from "./components/Navbar";
import { VoiceBanner } from "./components/Voice";
import { PlanPage } from "./components/Plans";
import { ProvenanceNode, ProvenancePage } from "./components/Provenance";
import { RecapPage } from "./components/Recap";
import { MissionPage } from "./components/MissionControl";
import {
  DailyDigestCommitPage,
  DailyDigestEventPage,
  DailyDigestPage,
} from "./components/DailyDigest";
import { CalendarPrepPage } from "./components/CalendarPrep";
import { SettingsPage } from "./components/Settings";
import { WorkflowDetailPage, WorkflowRunPage, WorkflowsPage } from "./components/Workflows";
import { isTabId, PetPanel, type TabId } from "./components/PetPanel";
import { useClient, useConnection, useDisplayedState, useTasks } from "./core/context";
import { useHashRoute } from "./core/hooks";
import { useMute } from "./core/mute";
import { useSoundHost } from "./core/sounds";
import { switchPillsCommand, usePillSwitcher } from "./core/pill-switch";
import { useT } from "./i18n";

/** AppShell: navbar with Fawkes, Pet Panel, and the main content area. */
export function App() {
  const t = useT();
  const state = useDisplayedState();
  const connection = useConnection();
  const tasks = useTasks();
  const [panelOpen, setPanelOpen] = useState(false);
  const panelId = useId();
  const avatar = useRef<FawkesAvatarHandle>(null);
  const route = useHashRoute();
  const meetingId = /^\/meetings\/(.+)$/.exec(route)?.[1];
  const agentId = /^\/agents\/(.+)$/.exec(route)?.[1];
  const runMatch = /^\/workflows\/([^/]+)\/runs\/([^/]+)$/.exec(route);
  const workflowId = /^\/workflows\/([^/]+)$/.exec(route)?.[1];
  const planId = /^\/plans\/(.+)$/.exec(route)?.[1];
  const provenanceId = /^\/provenance\/(.+)$/.exec(route)?.[1];
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

  // Command palette and in-app shortcuts: one registry, one document keydown listener.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [panelNonce, setPanelNonce] = useState(0);
  const [languageFocus, setLanguageFocus] = useState(0);
  const wantLanguage = useRef(false);
  const platform = useMemo(() => detectPlatform(), []);
  const bindings = useMemo(() => buildBindings(COMMANDS), []);
  const [shortcutsShell] = useState(() => tauriShortcuts());
  const soundHost = useSoundHost();
  const mute = useMute(shortcutsShell, soundHost.player);
  // The Settings preview obeys the desktop's mute flag too (unknown counts as muted).
  soundHost.setMuted(mute.muted);
  // The palette and the spoken request switch over the pills this window can see.
  const client = useClient();
  usePillSwitcher();
  const demo = useOptionalDemo();
  const demoPhase = demo?.state.phase;
  const demoController = demo?.controller;
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const commandContext = useMemo<CommandContext>(
    () => ({
      navigate: (to) => {
        window.location.hash = `#${to}`;
      },
      openPanelTab: (tab: TabId) => {
        // Already on that route (the panel was closed meanwhile): the hash would not change.
        if (route === `/panel/${tab}`) {
          setPanelOpen(true);
          setPanelNonce((n) => n + 1);
        } else window.location.hash = `#/panel/${tab}`;
      },
      openLanguageSettings: () => {
        wantLanguage.current = true;
        if (route === "/settings") setLanguageFocus((n) => n + 1);
        else window.location.hash = "#/settings";
      },
      togglePalette: () => setPaletteOpen((open) => !open),
      switchPills: (direction) => switchPillsCommand(client, direction),
      demo:
        demoController && demoPhase
          ? {
              phase: demoPhase,
              start: () => void demoController.start(),
              stop: () => void demoController.stop(),
            }
          : null,
      mute: mute.toggle ? { muted: mute.muted, toggle: mute.toggle } : null,
    }),
    [client, route, demoController, demoPhase, mute.toggle, mute.muted],
  );
  useShortcuts(bindings, platform, commandContext);

  // "Open Settings > Language": focus the language picker once the page is there. Runs after the
  // palette has closed and given focus back, so the picker keeps it.
  useEffect(() => {
    if (!wantLanguage.current || route !== "/settings") return;
    wantLanguage.current = false;
    const picker = document.querySelector<HTMLElement>('[data-focus-target="language"]');
    picker?.scrollIntoView?.({ block: "center" });
    picker?.focus();
  }, [route, languageFocus]);

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
        {t("shell.app.skipToContent")}
      </a>
      <Navbar
        ref={avatar}
        state={state}
        connection={connection}
        panelOpen={panelOpen}
        panelId={panelId}
        route={route}
        {...(mute.sounds ? { sounds: mute.sounds } : {})}
        onToggleFawkes={() => (panelOpen ? closePanel() : setPanelOpen(true))}
      />
      {panelOpen && (
        <PetPanel
          key={`${panelRoute ? route : "panel"}:${panelNonce}`}
          id={panelId}
          state={state}
          tasks={tasks}
          onClose={closePanel}
          {...(panelRoute ? { initialTab: panelRoute } : {})}
        />
      )}
      <main id="main" ref={main} tabIndex={-1} className="content">
        <VoiceBanner />
        {connection !== "unauthenticated" && route === "/settings" ? (
          <SettingsPage state={state} />
        ) : connection !== "unauthenticated" && route === "/meetings" ? (
          <MeetingsPage state={state} />
        ) : connection !== "unauthenticated" && meetingId ? (
          <MeetingDetail key={meetingId} id={decodeURIComponent(meetingId)} state={state} />
        ) : connection !== "unauthenticated" && route === "/workflows" ? (
          <WorkflowsPage />
        ) : connection !== "unauthenticated" && runMatch ? (
          <WorkflowRunPage
            key={runMatch[2]}
            workflowId={decodeURIComponent(runMatch[1] ?? "")}
            runId={decodeURIComponent(runMatch[2] ?? "")}
          />
        ) : connection !== "unauthenticated" && workflowId ? (
          <WorkflowDetailPage key={workflowId} workflowId={decodeURIComponent(workflowId)} />
        ) : connection !== "unauthenticated" && planId ? (
          <PlanPage key={planId} planId={decodeURIComponent(planId)} />
        ) : connection !== "unauthenticated" && route === "/provenance" ? (
          <ProvenancePage />
        ) : connection !== "unauthenticated" && provenanceId ? (
          <ProvenanceNode key={provenanceId} nodeId={decodeURIComponent(provenanceId)} />
        ) : connection !== "unauthenticated" && route === "/agents" ? (
          <AgentSessionsPage />
        ) : connection !== "unauthenticated" && agentId ? (
          <AgentSessionDetail key={agentId} sessionId={decodeURIComponent(agentId)} />
        ) : connection !== "unauthenticated" && route === "/recap" ? (
          <RecapPage />
        ) : connection !== "unauthenticated" && route === "/mission" ? (
          <MissionPage />
        ) : connection !== "unauthenticated" && route === "/calendar" ? (
          <CalendarPrepPage />
        ) : connection !== "unauthenticated" && route === "/digest" ? (
          <DailyDigestPage />
        ) : connection !== "unauthenticated" && route.startsWith("/digest/event/") ? (
          <DailyDigestEventPage id={decodeURIComponent(route.slice("/digest/event/".length))} />
        ) : connection !== "unauthenticated" && route.startsWith("/digest/commit/") ? (
          <DailyDigestCommitPage sha={decodeURIComponent(route.slice("/digest/commit/".length))} />
        ) : (
          <Home connection={connection} />
        )}
      </main>
      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        commands={COMMANDS}
        bindings={bindings}
        platform={platform}
        ctx={commandContext}
      />
    </div>
  );
}

function Home({ connection }: { connection: string }) {
  const t = useT();
  return (
    <>
      <h1>Phoenix</h1>
      <p className="lead">{t("shell.app.tagline")}</p>
      {connection === "unauthenticated" ? (
        <p role="alert">{t.rich("shell.app.noToken", { command: <code>pnpm dev:core</code> })}</p>
      ) : (
        <p className="muted">{t("shell.app.hint")}</p>
      )}
    </>
  );
}
