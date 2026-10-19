// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { route, type Route } from "./http";
import type { CoreServices } from "./services";

/** One step of the demo walkthrough. `caption_id` is the translation key; `caption` its English text. */
export interface DemoStepView {
  /** A scenario the mock capability can play (`simulate`). */
  scenario: string;
  caption_id: string;
  caption: string;
  /** Hash route (starts with `/`) the web app shows while the scenario plays. */
  route: string;
}

/** What `POST /api/demo/start` returns: where the isolated demo Core listens and how to talk to it. */
export interface DemoStartView {
  url: string;
  /** The demo Core's own session token. It is not valid on the real Core, and the real one is not valid there. */
  token: string;
  steps: DemoStepView[];
}

export interface DemoStatusView {
  running: boolean;
  step_count: number;
  idle_limit_ms: number;
}

/** Phase 70: demo mode. Session-token routes only; the demo itself runs in a second, in-memory Core. */
export interface DemoApi {
  /** `origin` is the browser origin that asked (already accepted by this Core); the demo Core accepts it too. */
  start(origin: string | undefined): Promise<DemoStartView>;
  stop(): Promise<{ stopped: boolean }>;
  status(): DemoStatusView;
}

export function demoRoutes(s: CoreServices): Route[] {
  const demo = () => {
    if (!s.demo) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Demo mode not available");
    return s.demo;
  };
  return [
    route("POST", "/api/demo/start", ({ req }) => demo().start(req.headers.origin)),
    route("POST", "/api/demo/stop", () => demo().stop()),
    route("GET", "/api/demo/status", () => demo().status()),
  ];
}
