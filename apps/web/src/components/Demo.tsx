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
import { demoCaption } from "../core/demo";
import {
  DemoController,
  type DemoClientFactory,
  type DemoRouter,
  type DemoSnapshot,
} from "../core/demo-controller";
import { formatNumber } from "../core/format";
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
  const t = useT();
  return (
    <div className="demo-banner" role="status">
      <strong>{t("services.demo.banner")}</strong>
      <span className="demo-banner-detail">{t("services.demo.bannerDetail")}</span>
    </div>
  );
}

function DemoWalkthrough() {
  const t = useT();
  const { locale } = useLocale();
  const { controller, state } = useDemo();
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
