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

/** This fixture answers an allowlisted inspection query, never arbitrary SQL. */
export interface PostgresInspector {
  tables(schema: string): Promise<readonly { name: string; rows: number }[]>;
}

export const localPostgres: PostgresInspector = {
  async tables(schema) {
    return schema === "public" ? [{ name: "demo_events", rows: 2 }] : [];
  },
};

export const postgresManifest: CapabilityManifest = {
  manifest_version: CAPABILITY_MANIFEST_VERSION,
  id: "phoenix-postgres",
  name: "Phoenix Postgres (local demo)",
  version: "1.0.0",
  description: "Inspects a local Postgres fixture without database or network access.",
  license: "GPL-3.0-or-later",
  compatibility: { protocol: CAPABILITY_PROTOCOL_MAJOR },
  events: [],
  permissions: [],
  commands: [
    {
      name: "tables.list",
      description: "List tables in a local schema fixture",
      side_effect: "read",
      input_schema: {
        type: "object",
        required: ["schema"],
        additionalProperties: false,
        properties: { schema: { type: "string", minLength: 1 } },
      },
    },
  ],
};

export function startPostgres(
  options: {
    coreUrl?: string;
    sessionToken?: string | (() => string);
    adapter?: PostgresInspector;
  } = {},
): Promise<ExternalCapability> {
  const adapter = options.adapter ?? localPostgres;
  return runExternalCapability({
    manifest: postgresManifest,
    coreUrl: options.coreUrl,
    sessionToken: options.sessionToken,
    commands: {
      "tables.list": async (input) => {
        const { schema } = input as { schema: string };
        return { schema, tables: await adapter.tables(schema) };
      },
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const capability = await startPostgres();
  console.log(`phoenix-postgres registered on ${capability.endpoint}; waiting for Core commands`);
}
