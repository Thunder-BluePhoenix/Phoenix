// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createAwakeCapability } from "@phoenix/capability-awake";
import { createAgentsCapability, type AgentsServices } from "@phoenix/capability-agents";
import { createAppleMusicCapability } from "@phoenix/capability-apple-music";
import { createDockerCapability } from "@phoenix/capability-docker";
import { createFrappeCapability } from "@phoenix/capability-frappe";
import { createCalcomCapability } from "@phoenix/capability-calcom";
import { createGitCapability } from "@phoenix/capability-git";
import { createGithubCapability } from "@phoenix/capability-github";
import { createIssuesCapability } from "@phoenix/capability-issues";
import { createKageCapability } from "@phoenix/capability-kage";
import { createN8nCapability } from "@phoenix/capability-n8n";
import { mockCapability } from "@phoenix/capability-mock";
import { createNotionCapability } from "@phoenix/capability-notion";
import { createPlanningCapability, type PlanningServices } from "@phoenix/capability-planning";
import { createResendCapability } from "@phoenix/capability-resend";
import { createPortfolioCapability } from "@phoenix/capability-portfolio";
import { createStripeCapability } from "@phoenix/capability-stripe";
import { createSpotifyCapability } from "@phoenix/capability-spotify";
import { terminalCapability } from "@phoenix/capability-terminal";
import { createVercelCapability } from "@phoenix/capability-vercel";
import type { CapabilityModule } from "@phoenix/capability-manager";
import type { PhoenixConfig } from "@phoenix/config";

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
    createSpotifyCapability(),
    createAppleMusicCapability(),
    createPortfolioCapability(),
    terminalCapability,
    createDockerCapability(),
    createFrappeCapability(),
    createAgentsCapability(agentsServices ? { services: agentsServices } : {}),
    createAwakeCapability({ feed: () => agentsServices?.()?.events }),
    createIssuesCapability(),
    createPlanningCapability({ services: planningServices }),
    ...(env === "dev" ? [mockCapability] : []),
  ];
}
