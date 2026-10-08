// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Database } from "@phoenix/persistence";
import { compileSchema, validateManifest, type CapabilityManifest } from "@phoenix/protocol";
import type { ToolContract } from "./contract";

export interface ToolRegistryOptions {
  /** Current manifests. Called on every lookup so newly registered capabilities appear. */
  manifests: () => readonly CapabilityManifest[];
  /** Trusted, code-supplied output schemas by tool name (manifests do not declare outputs). */
  outputSchemas?: Readonly<Record<string, Record<string, unknown>>>;
  /** Timeout for commands whose manifest sets none. */
  defaultTimeoutMs?: number;
}

export interface RegisteredTool {
  contract: ToolContract;
  /** Returns problems; empty when valid. */
  checkInput(value: unknown): string[];
  /** Returns problems; empty when valid or when the tool declares no output schema. */
  checkOutput(value: unknown): string[];
}

type Check = (value: unknown) => string[];

const EMPTY_INPUT: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  maxProperties: 0,
};

/** Manifests persisted by the capability manager (builtin and external), for the runtime wiring. */
export function manifestsFromDatabase(db: Database): CapabilityManifest[] {
  const rows = db.prepare("SELECT manifest FROM capabilities").all() as unknown as {
    manifest: string;
  }[];
  const out: CapabilityManifest[] = [];
  for (const row of rows) {
    const result = validateManifest(JSON.parse(row.manifest));
    if (result.ok) out.push(result.manifest);
  }
  return out;
}

/**
 * Every command of every known capability is a tool named `<capabilityId>.<command>`.
 * Side effect, permissions and timeout come from the manifest only.
 */
export class ToolRegistry {
  private readonly checks: Record<string, Check> = {};
  private readonly defaultTimeoutMs: number;

  constructor(private readonly o: ToolRegistryOptions) {
    this.defaultTimeoutMs = o.defaultTimeoutMs ?? 10_000;
  }

  get(name: string): RegisteredTool | undefined {
    if (typeof name !== "string") return undefined;
    for (const manifest of this.o.manifests()) {
      if (!name.startsWith(`${manifest.id}.`)) continue;
      const command = manifest.commands.find((c) => `${manifest.id}.${c.name}` === name);
      if (command) return this.tool(manifest, command);
    }
    return undefined;
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  list(): ToolContract[] {
    return this.o
      .manifests()
      .flatMap((m) => m.commands.map((c) => this.tool(m, c).contract))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private tool(
    manifest: CapabilityManifest,
    command: CapabilityManifest["commands"][number],
  ): RegisteredTool {
    const name = `${manifest.id}.${command.name}`;
    const outputSchema = this.o.outputSchemas?.[name];
    const contract: ToolContract = {
      name,
      description: command.description,
      capabilityId: manifest.id,
      command: command.name,
      inputSchema: command.input_schema ?? EMPTY_INPUT,
      ...(outputSchema ? { outputSchema } : {}),
      sideEffect: command.side_effect,
      permissions: command.permissions ?? [],
      timeoutMs: command.timeout_ms ?? this.defaultTimeoutMs,
      idempotent: command.side_effect === "none" || command.side_effect === "read",
      auditMetadata: {
        capabilityName: manifest.name,
        capabilityVersion: manifest.version,
        dataCategories: manifest.data_categories ?? [],
      },
    };
    return {
      contract,
      checkInput: this.compiled(contract.inputSchema),
      checkOutput: outputSchema ? this.compiled(outputSchema) : () => [],
    };
  }

  private compiled(schema: Record<string, unknown>): Check {
    const key = JSON.stringify(schema);
    return (this.checks[key] ??= compileSchema(schema));
  }
}
