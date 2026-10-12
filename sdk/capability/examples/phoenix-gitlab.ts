// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CAPABILITY_MANIFEST_VERSION,
  CAPABILITY_PROTOCOL_MAJOR,
  runExternalCapability,
  type CapabilityManifest,
  type ExternalCapability,
} from "@phoenix/sdk";

/** Replace only this adapter when connecting a real GitLab instance; never put credentials in config. */
export interface GitLabReader {
  issues(project: string): Promise<readonly { iid: number; title: string; state: string }[]>;
}

export const localGitLab: GitLabReader = {
  async issues(project) {
    return project === "phoenix/demo"
      ? [{ iid: 7, title: "Review local example", state: "opened" }]
      : [];
  },
};

export const gitlabManifest: CapabilityManifest = {
  manifest_version: CAPABILITY_MANIFEST_VERSION,
  id: "phoenix-gitlab",
  name: "Phoenix GitLab (local demo)",
  version: "1.0.0",
  description: "Reads issues from an injected local GitLab adapter; no remote traffic.",
  license: "GPL-3.0-or-later",
  compatibility: { protocol: CAPABILITY_PROTOCOL_MAJOR },
  events: [],
  permissions: [],
  commands: [
    {
      name: "issues.list",
      description: "List issues for a project in the local adapter",
      side_effect: "read",
      input_schema: {
        type: "object",
        required: ["project"],
        additionalProperties: false,
        properties: { project: { type: "string", minLength: 1 } },
      },
    },
  ],
};

export function startGitLab(
  options: {
    coreUrl?: string;
    sessionToken?: string | (() => string);
    adapter?: GitLabReader;
  } = {},
): Promise<ExternalCapability> {
  const adapter = options.adapter ?? localGitLab;
  return runExternalCapability({
    manifest: gitlabManifest,
    coreUrl: options.coreUrl,
    sessionToken: options.sessionToken,
    commands: {
      "issues.list": async (input) => {
        const { project } = input as { project: string };
        return { project, issues: await adapter.issues(project) };
      },
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const capability = await startGitLab();
  console.log(`phoenix-gitlab registered on ${capability.endpoint}; waiting for Core commands`);
}
