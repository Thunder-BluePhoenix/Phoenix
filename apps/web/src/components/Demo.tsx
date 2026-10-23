// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { PhoenixClient } from "../core/client";
import { CoreProvider } from "../core/context";
import { demoCaption } from "../core/demo";
import {
  DemoController,
  type DemoClientFactory,
  type DemoRouter,
  type DemoSnapshot,
} from "../core/demo-controller";
import { DemoTimeline, type DemoTimelineOptions } from "../core/demo-timeline";
import { formatNumber } from "../core/format";
import { useHashRoute } from "../core/hooks";
import { useLocale, useT } from "../i18n";
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

/** Like useDemo, but null where there is no <DemoHost> (the palette's demo commands then vanish). */
export function useOptionalDemo(): { controller: DemoController; state: DemoSnapshot } | null {
  const controller = useContext(DemoContext);
  const state = useSyncExternalStore(
    controller ? controller.subscribe : NO_SUBSCRIBE,
    controller ? controller.getSnapshot : NO_SNAPSHOT,
  );
  return controller && state ? { controller, state } : null;
}

const NO_SUBSCRIBE = (): (() => void) => () => {};
const NO_SNAPSHOT = (): DemoSnapshot | null => null;

/**
 * The root of the app. It owns which Core the page talks to: the real one, or, while the demo runs,
 * the demo's own. Switching remounts everything below (so no view keeps data from the other Core)
 * and closes the previous client. While the demo runs the banner and the walkthrough are on screen.
 */
export function DemoHost({
  client,
  makeClient,
  router,
  timeline,
  children,
}: {
  client: PhoenixClient;
  makeClient?: DemoClientFactory;
  router?: DemoRouter;
  /** Interval, timers and motion preference of the optional timed walkthrough (tests inject fakes). */
  timeline?: DemoTimelineOptions;
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
        {state.phase === "on" && <DemoWalkthrough timelineOptions={timeline} />}
      </CoreProvider>
    </DemoContext.Provider>
  );
}

function DemoBanner() {
  const t = useT();
  return (
    <div className="demo-banner" role="status">
      <strong>{t("services.demo.banner")}</strong>
      <span className="demo-banner-detail">{t("services.demo.bannerDetail")}</span>
    </div>
  );
}

function DemoWalkthrough({ timelineOptions }: { timelineOptions?: DemoTimelineOptions }) {
  const t = useT();
  const { locale } = useLocale();
  const { controller, state } = useDemo();
  const [timeline] = useState(() => new DemoTimeline(controller, timelineOptions));
  const auto = useSyncExternalStore(timeline.subscribe, timeline.getSnapshot);
  const route = useHashRoute();
  // The timeline lives exactly as long as the walkthrough is on screen: leaving the demo unmounts it.
  useEffect(() => timeline.attach(), [timeline]);
  useEffect(() => timeline.routeChanged(route), [timeline, route]);
  const steps = state.session?.steps ?? [];
  const current = state.step >= 0 ? steps[state.step] : undefined;
  const next = state.step + 1;
  const last = state.step >= steps.length - 1 && state.step >= 0;
  return (
    <section className="demo-walkthrough card" aria-label={t("services.demo.settingsTitle")}>
      <p className="small muted">
        {current
          ? t("services.demo.stepOf", {
              n: formatNumber(state.step + 1),
              total: formatNumber(steps.length),
            })
          : t("services.demo.stepCount", { count: steps.length })}
      </p>
      <p className="demo-caption" aria-live="polite">
        {current ? demoCaption(current, t, locale) : t("services.demo.settingsIntro")}
      </p>
      {last && !state.playing && <p className="small">{t("services.demo.finished")}</p>}
      <div className="button-row wrap">
        <button
          type="button"
          className="btn"
          disabled={state.playing || state.step <= 0}
          onClick={() => void controller.play(state.step - 1)}
        >
          {t("services.demo.previous")}
        </button>
        {current && (
          <button
            type="button"
            className="btn"
            disabled={state.playing}
            onClick={() => void controller.play(state.step)}
          >
            {state.playing ? t("services.demo.playing") : t("services.demo.play")}
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={state.playing || next >= steps.length}
          onClick={() => void controller.play(next)}
        >
          {t("services.demo.next")}
        </button>
        <button
          type="button"
          className="btn"
          disabled={state.phase !== "on"}
          onClick={() => void controller.stop()}
        >
          {t("services.demo.stop")}
        </button>
      </div>
      <div className="button-row wrap" role="group" aria-label={t("services.demo.auto.group")}>
        {auto.status === "idle" && (
          <button
            type="button"
            className="btn"
            disabled={state.playing || steps.length === 0}
            onClick={() => timeline.play()}
          >
            {t("services.demo.auto.play")}
          </button>
        )}
        {auto.status === "playing" && (
          <button type="button" className="btn" onClick={() => timeline.pause()}>
            {t("services.demo.auto.pause")}
          </button>
        )}
        {auto.status === "paused" && (
          <button
            type="button"
            className="btn"
            disabled={state.playing}
            onClick={() => timeline.play()}
          >
            {t("services.demo.auto.resume")}
          </button>
        )}
        {auto.status !== "idle" && (
          <button type="button" className="btn" onClick={() => timeline.stop()}>
            {t("services.demo.auto.stop")}
          </button>
        )}
      </div>
      <p className="small muted" role="status">
        {auto.status === "playing"
          ? t("services.demo.auto.running", { seconds: formatNumber(auto.intervalMs / 1000) })
          : auto.status === "paused"
            ? t("services.demo.auto.paused")
            : auto.reducedMotion
              ? t("services.demo.auto.reducedMotion")
              : ""}
      </p>
      <Feedback error={state.error} saved={state.notice} />
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
  const t = useT();
  const { controller, state } = useDemo();
  const busy = state.phase === "starting" || state.phase === "stopping";
  return (
    <section aria-labelledby="demo-h" className="card">
      <h2 id="demo-h" className="h3">
        {t("services.demo.settingsTitle")}
      </h2>
      <p className="small">{t("services.demo.settingsIntro")}</p>
      <div className="button-row wrap">
        <button
          type="button"
          className="btn"
          disabled={busy || state.phase === "on"}
          onClick={() => void controller.start()}
        >
          {state.phase === "starting" ? t("services.demo.starting") : t("services.demo.start")}
        </button>
      </div>
      <Feedback error={state.error} />
    </section>
  );
}
