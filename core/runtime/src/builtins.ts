// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createAgentsCapability, type AgentsServices } from "@phoenix/capability-agents";
import { createDockerCapability } from "@phoenix/capability-docker";
import { createFrappeCapability } from "@phoenix/capability-frappe";
import { createGitCapability } from "@phoenix/capability-git";
import { createGithubCapability } from "@phoenix/capability-github";
import { createIssuesCapability } from "@phoenix/capability-issues";
import { createKageCapability } from "@phoenix/capability-kage";
import { mockCapability } from "@phoenix/capability-mock";
import { terminalCapability } from "@phoenix/capability-terminal";
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
): CapabilityModule[] {
  return [
    createKageCapability(),
    createGitCapability(),
    createGithubCapability(),
    terminalCapability,
    createDockerCapability(),
    createFrappeCapability(),
    createAgentsCapability(agentsServices ? { services: agentsServices } : {}),
    createIssuesCapability(),
    ...(env === "dev" ? [mockCapability] : []),
  ];
}
