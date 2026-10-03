// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Ready-made event sequences for demos, the simulator and the mock capability.
import { agent, build, deploy, frappe, git, kage, test, type EventInput } from "./builders";

export interface ScenarioStep {
  /** Delay before this step, in milliseconds (scaled by the simulator's speed). */
  afterMs: number;
  /** Source the simulator publishes as (the mock capability always uses its own id). */
  source: string;
  event: EventInput;
}

export interface Scenario {
  description: string;
  steps: ScenarioStep[];
}

const step = (afterMs: number, source: string, event: EventInput): ScenarioStep => ({
  afterMs,
  source,
  event,
});

export const SCENARIOS: Readonly<Record<string, Scenario>> = {
  "build-pass": {
    description: "A build runs and passes",
    steps: [
      step(0, "terminal", build.started("pnpm build")),
      step(1500, "terminal", build.progress(0.5)),
      step(1500, "terminal", build.passed()),
    ],
  },
  "build-fail": {
    description: "A build runs and fails (US-03)",
    steps: [
      step(0, "terminal", build.started("pnpm build")),
      step(2000, "terminal", build.failed("Type error in src/app.ts")),
    ],
  },
  tests: {
    description: "Tests run and pass",
    steps: [step(0, "terminal", test.started()), step(2000, "terminal", test.passed())],
  },
  "agent-waiting": {
    description: "A coding agent works, then needs input",
    steps: [
      step(0, "codex", agent.started("Codex")),
      step(1500, "codex", agent.working("Codex")),
      step(1500, "codex", agent.waiting("Codex", "Allow writing to src/?")),
    ],
  },
  "agent-done": {
    description: "A coding agent finishes",
    steps: [
      step(0, "codex", agent.started("Codex")),
      step(2500, "codex", agent.completed("Codex")),
    ],
  },
  deploy: {
    description: "A staging deployment with progress",
    steps: [
      step(0, "ci", deploy.started("staging")),
      step(1000, "ci", deploy.progress(0.25)),
      step(1000, "ci", deploy.progress(0.6)),
      step(1000, "ci", deploy.progress(0.9)),
      step(1000, "ci", deploy.succeeded("staging")),
    ],
  },
  "deploy-fail": {
    description: "A production deployment fails",
    steps: [
      step(0, "ci", deploy.started("production")),
      step(2000, "ci", deploy.failed("production")),
    ],
  },
  meeting: {
    description: "Full Kage meeting: record → transcribe → summarise",
    steps: [
      step(0, "kage", kage.meetingStarted("meeting_demo", "Weekly sync")),
      step(800, "kage", kage.recording("meeting_demo")),
      step(4000, "kage", kage.ended("meeting_demo")),
      step(800, "kage", kage.transcriptionStarted("meeting_demo")),
      step(2000, "kage", kage.transcriptionCompleted("meeting_demo")),
      step(500, "kage", kage.summaryStarted("meeting_demo")),
      step(2000, "kage", kage.summaryReady("meeting_demo", "summary_demo")),
    ],
  },
  "frappe-down": {
    description: "A Frappe site becomes unhealthy, then recovers",
    steps: [
      step(0, "frappe", frappe.siteUnhealthy("erp.local")),
      step(5000, "frappe", frappe.siteHealthy("erp.local")),
    ],
  },
  "merge-conflict": {
    description: "A merge conflict appears and is resolved",
    steps: [
      step(0, "git", git.mergeConflict("phoenix")),
      step(4000, "git", git.mergeConflictResolved("phoenix")),
      step(500, "git", git.commitCreated("phoenix", "1a2b3c4")),
    ],
  },
};

export const SCENARIO_NAMES = Object.keys(SCENARIOS);
