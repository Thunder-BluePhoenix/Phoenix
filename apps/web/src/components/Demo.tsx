// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  createContext,
  Fragment,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { PhoenixClient } from "../core/client";
import { CoreProvider } from "../core/context";
import { DEMO_UI_TEXT } from "../core/demo";
import {
  DemoController,
  type DemoClientFactory,
  type DemoRouter,
  type DemoSnapshot,
} from "../core/demo-controller";
import { Feedback } from "./Feedback";
import "./demo.css";

const DemoContext = createContext<DemoController | null>(null);

/** The demo controller and its current state. Inside a <DemoHost> only. */
export function useDemo(): { controller: DemoController; state: DemoSnapshot } {
  const controller = useContext(DemoContext);
  if (!controller) throw new Error("useDemo must be used inside <DemoHost>");
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return { controller, state };
}

/**
 * The root of the app. It owns which Core the page talks to: the real one, or, while the demo runs,
 * the demo's own. Switching remounts everything below (so no view keeps data from the other Core)
 * and closes the previous client. While the demo runs the banner and the walkthrough are on screen.
 */
export function DemoHost({
  client,
  makeClient,
  router,
  children,
}: {
  client: PhoenixClient;
  makeClient?: DemoClientFactory;
  router?: DemoRouter;
  children: ReactNode;
}) {
  const [controller] = useState(() => new DemoController(client, makeClient, router));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const demoToken = state.session?.token ?? "real";
  return (
    <DemoContext.Provider value={controller}>
      {state.phase === "on" && <DemoBanner />}
      <CoreProvider client={state.client}>
        <Fragment key={demoToken}>{children}</Fragment>
        {state.phase === "on" && <DemoWalkthrough />}
      </CoreProvider>
    </DemoContext.Provider>
  );
}

function DemoBanner() {
  return (
    <div className="demo-banner" role="status">
      <strong>{DEMO_UI_TEXT.banner}</strong>
      <span className="demo-banner-detail">{DEMO_UI_TEXT.bannerDetail}</span>
    </div>
  );
}

function DemoWalkthrough() {
  const { controller, state } = useDemo();
  const steps = state.session?.steps ?? [];
  const current = state.step >= 0 ? steps[state.step] : undefined;
  const next = state.step + 1;
  const last = state.step >= steps.length - 1 && state.step >= 0;
  return (
    <section className="demo-walkthrough card" aria-label={DEMO_UI_TEXT.settingsTitle}>
      <p className="small muted">
        {current
          ? `${DEMO_UI_TEXT.stepOf} ${state.step + 1} / ${steps.length}`
          : `${steps.length} ${DEMO_UI_TEXT.stepOf.toLowerCase()}s`}
      </p>
      <p className="demo-caption" aria-live="polite">
        {current ? current.caption : DEMO_UI_TEXT.settingsIntro}
      </p>
      {last && !state.playing && <p className="small">{DEMO_UI_TEXT.finished}</p>}
      <div className="button-row wrap">
        <button
          type="button"
          className="btn"
          disabled={state.playing || state.step <= 0}
          onClick={() => void controller.play(state.step - 1)}
        >
          {DEMO_UI_TEXT.previous}
        </button>
        {current && (
          <button
            type="button"
            className="btn"
            disabled={state.playing}
            onClick={() => void controller.play(state.step)}
          >
            {state.playing ? DEMO_UI_TEXT.playing : DEMO_UI_TEXT.play}
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={state.playing || next >= steps.length}
          onClick={() => void controller.play(next)}
        >
          {DEMO_UI_TEXT.next}
        </button>
        <button
          type="button"
          className="btn"
          disabled={state.phase !== "on"}
          onClick={() => void controller.stop()}
        >
          {DEMO_UI_TEXT.stop}
        </button>
      </div>
      <Feedback error={state.error} />
    </section>
  );
}

/**
 * The single entry point (Settings): starts the demo. Renders nothing where there is no <DemoHost>
 * (the floating window and the pill, which never switch Cores).
 */
export function DemoSettingsSection() {
  return useContext(DemoContext) ? <DemoStart /> : null;
}

function DemoStart() {
  const { controller, state } = useDemo();
  const busy = state.phase === "starting" || state.phase === "stopping";
  return (
    <section aria-labelledby="demo-h" className="card">
      <h2 id="demo-h" className="h3">
        {DEMO_UI_TEXT.settingsTitle}
      </h2>
      <p className="small">{DEMO_UI_TEXT.settingsIntro}</p>
      <div className="button-row wrap">
        <button
          type="button"
          className="btn"
          disabled={busy || state.phase === "on"}
          onClick={() => void controller.start()}
        >
          {state.phase === "starting" ? DEMO_UI_TEXT.starting : DEMO_UI_TEXT.start}
        </button>
      </div>
      <Feedback error={state.error} />
    </section>
  );
}
