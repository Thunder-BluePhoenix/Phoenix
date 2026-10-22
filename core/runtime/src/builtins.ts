// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createAwakeCapability, type SessionController } from "@phoenix/capability-awake";
import { createAgentsCapability, type AgentsServices } from "@phoenix/capability-agents";
import { createAppleMusicCapability } from "@phoenix/capability-apple-music";
import { createDockerCapability } from "@phoenix/capability-docker";
import { createFrappeCapability } from "@phoenix/capability-frappe";
import { createCalcomCapability } from "@phoenix/capability-calcom";
import { createCalendarCapability } from "@phoenix/capability-calendar";
import { createGitCapability } from "@phoenix/capability-git";
import { createGithubCapability } from "@phoenix/capability-github";
import { createIssuesCapability } from "@phoenix/capability-issues";
import { createKageCapability } from "@phoenix/capability-kage";
import { createN8nCapability } from "@phoenix/capability-n8n";
import { createMachineCapability } from "@phoenix/capability-machine";
import { mockCapability } from "@phoenix/capability-mock";
import { createNotionCapability } from "@phoenix/capability-notion";
import { createPlanningCapability, type PlanningServices } from "@phoenix/capability-planning";
import { createPortsCapability } from "@phoenix/capability-ports";
import { createResendCapability } from "@phoenix/capability-resend";
import { createPortfolioCapability } from "@phoenix/capability-portfolio";
import {
  createStatusLightsCapability,
  type StatusLightsOptions,
} from "@phoenix/capability-status-lights";
import { createStripeCapability } from "@phoenix/capability-stripe";
import { createSpotifyCapability } from "@phoenix/capability-spotify";
import { terminalCapability } from "@phoenix/capability-terminal";
import { createVercelCapability } from "@phoenix/capability-vercel";
import type { CapabilityModule } from "@phoenix/capability-manager";
import type { PhoenixConfig } from "@phoenix/config";

/** What the runtime lends to capabilities that need to reach back into Core. */
export interface BuiltinHost {
  /** Phase 88: the lights Core can reach and the event feed they follow. */
  statusLights?: StatusLightsOptions;
  /** Phase 90: told about the live keep-awake session so the scheduler can hold the same one. */
  onAwakeSession?: (session: SessionController | undefined) => void;
}

/**
 * The first-party capabilities Core installs at startup. They are installed, never enabled: each
 * needs the user to enable it and grant its permissions. Stateful capabilities are built per call
 * (their factories), so two runtimes in one process do not share polling state. The mock capability plays
 * demo scenarios and only exists in development.
 *
 * `agentsServices` is called each time the agents capability is enabled, after the runtime exists
 * (the capabilities are built first, the runtime needs them). Without it only the observe-only
 * agent commands work and session orchestration answers NOT_CONNECTED.
 */
export function builtinCapabilities(
  env: PhoenixConfig["env"],
  agentsServices?: () => AgentsServices | undefined,
  planningServices?: () => PlanningServices | undefined,
  host: BuiltinHost = {},
): CapabilityModule[] {
  return [
    createKageCapability(),
    createGitCapability(),
    createGithubCapability(),
    createVercelCapability(),
    createStripeCapability(),
    createN8nCapability(),
    createResendCapability(),
    createNotionCapability(),
    createCalcomCapability(),
    createCalendarCapability(),
    createSpotifyCapability(),
    createAppleMusicCapability(),
    createPortfolioCapability(),
    terminalCapability,
    createDockerCapability(),
    createFrappeCapability(),
    createMachineCapability(),
    createAgentsCapability(agentsServices ? { services: agentsServices } : {}),
    createAwakeCapability({
      feed: () => agentsServices?.()?.events,
      ...(host.onAwakeSession ? { onSession: host.onAwakeSession } : {}),
    }),
    createIssuesCapability(),
    createPlanningCapability({ services: planningServices }),
    createPortsCapability(),
    createStatusLightsCapability(host.statusLights),
    ...(env === "dev" ? [mockCapability] : []),
  ];
}
