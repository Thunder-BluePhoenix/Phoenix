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

/** Local-only adapter; replacing it with a network adapter requires a new permission disclosure. */
export interface SlackReader {
  messages(channel: string): Promise<readonly { user: string; text: string }[]>;
}

export const localSlack: SlackReader = {
  async messages(channel) {
    return channel === "demo" ? [{ user: "phoenix", text: "Hello from a local fixture" }] : [];
  },
};

export const slackManifest: CapabilityManifest = {
  manifest_version: CAPABILITY_MANIFEST_VERSION,
  id: "phoenix-slack",
  name: "Phoenix Slack (local demo)",
  version: "1.0.0",
  description: "Reads messages from an injected local Slack adapter; no remote traffic.",
  license: "GPL-3.0-or-later",
  compatibility: { protocol: CAPABILITY_PROTOCOL_MAJOR },
  events: [],
  permissions: [],
  commands: [
    {
      name: "messages.list",
      description: "List messages from a local channel fixture",
      side_effect: "read",
      input_schema: {
        type: "object",
        required: ["channel"],
        additionalProperties: false,
        properties: { channel: { type: "string", minLength: 1 } },
      },
    },
  ],
};

export function startSlack(
  options: { coreUrl?: string; sessionToken?: string | (() => string); adapter?: SlackReader } = {},
): Promise<ExternalCapability> {
  const adapter = options.adapter ?? localSlack;
  return runExternalCapability({
    manifest: slackManifest,
    coreUrl: options.coreUrl,
    sessionToken: options.sessionToken,
    commands: {
      "messages.list": async (input) => {
        const { channel } = input as { channel: string };
        return { channel, messages: await adapter.messages(channel) };
      },
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const capability = await startSlack();
  console.log(`phoenix-slack registered on ${capability.endpoint}; waiting for Core commands`);
}
