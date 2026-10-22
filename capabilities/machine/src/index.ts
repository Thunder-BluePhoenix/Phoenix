// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { defineCapability, type CapabilityContext } from "@phoenix/sdk";
import {
  checkFit,
  createLocalModelClient,
  field,
  listModels,
  MachineError,
  manageModel,
  modelProvider,
  modelSize,
  parseModelRequest,
  type ModelClient,
} from "./models";
import { createMachineProbe, type MachineProbe, type MachineReading } from "./probes";
export * from "./models";
export * from "./probes";

export interface MachineOptions {
  probe?: MachineProbe;
  client?: ModelClient;
  catalogSize?: (provider: "ollama" | "lmstudio", name: string) => Promise<number | null>;
}
export interface MachineSnapshot {
  platform: MachineProbe["platform"];
  reading: MachineReading;
  warnings: string[];
}
const GIB = 1024 ** 3;
export function assessHealth(reading: MachineReading): string[] {
  const warnings: string[] = [];
  if (
    reading.diskFreeBytes !== null &&
    (reading.diskFreeBytes < 10 * GIB ||
      (reading.diskTotalBytes !== null &&
        reading.diskTotalBytes > 0 &&
        reading.diskFreeBytes / reading.diskTotalBytes < 0.1))
  )
    warnings.push("disk");
  if (reading.memoryFreeBytes !== null && reading.memoryFreeBytes < 2 * GIB)
    warnings.push("memory");
  if (reading.cpuPercent !== null && reading.cpuPercent >= 90) warnings.push("cpu");
  if (reading.batteryPercent !== null && reading.charging === false && reading.batteryPercent <= 15)
    warnings.push("battery");
  if (reading.temperatureCelsius !== null && reading.temperatureCelsius >= 85)
    warnings.push("thermal");
  return warnings;
}
const PROVIDER = {
  type: "string",
  enum: ["ollama", "lmstudio"],
  "x-phoenix-confirm": true,
} as const;
const NAME = { type: "string", minLength: 1, maxLength: 180, "x-phoenix-confirm": true } as const;
const TARGET = {
  type: "object",
  additionalProperties: false,
  required: ["provider", "name"],
  properties: { provider: PROVIDER, name: NAME },
} as const;
const DOWNLOAD = TARGET;
const EMPTY = { type: "object", additionalProperties: false, properties: {} } as const;
const LIST = {
  type: "object",
  additionalProperties: false,
  required: ["provider"],
  properties: { provider: PROVIDER },
} as const;

export function createMachineCapability(options: MachineOptions = {}) {
  const probe = options.probe ?? createMachineProbe();
  const client = options.client ?? createLocalModelClient();
  let latest: MachineSnapshot | null = null;
  async function trustedSize(provider: "ollama" | "lmstudio", name: string): Promise<number> {
    const size = await options.catalogSize?.(provider, name);
    if (size === undefined || size === null)
      throw new MachineError("unavailable", "Verified model size unavailable; download refused");
    return modelSize(size);
  }
  async function snapshot(ctx: CapabilityContext): Promise<MachineSnapshot> {
    const reading = await probe.sample();
    const warnings = assessHealth(reading);
    const previous = latest?.warnings ?? [];
    latest = { platform: probe.platform, reading, warnings };
    for (const warning of warnings)
      if (!previous.includes(warning))
        ctx.emit({
          event_type: "machine.health.warning",
          severity: "warning",
          subject: warning,
          payload: { metric: warning },
        });
    for (const warning of previous)
      if (!warnings.includes(warning))
        ctx.emit({
          event_type: "machine.health.recovered",
          severity: "info",
          subject: warning,
          payload: { metric: warning },
        });
    return latest;
  }
  return defineCapability({
    manifest: {
      id: "machine",
      name: "Machine health and local models",
      version: "0.1.0",
      description:
        "Read local resource health and manage models through loopback-only Ollama and LM Studio APIs. Downloads and removals require approval.",
      license: "GPL-3.0-or-later",
      homepage: "https://github.com/Thunder-BluePhoenix/Phoenix",
      permissions: ["shell_command", "filesystem_read", "network"],
      data_categories: ["local machine resource readings", "local model identifiers"],
      events: ["machine.health.*"],
      state_rules: [
        {
          match: "machine.health.warning",
          group: "machine.health",
          effect: { state: "WARNING", explain: "Machine health warning: {subject}" },
        },
        {
          match: "machine.health.recovered",
          group: "machine.health",
          effect: { clear: true },
        },
      ],
      commands: [
        {
          name: "health_snapshot",
          description: "Read disk, memory, CPU, battery and thermal health",
          side_effect: "read",
          permissions: ["shell_command", "filesystem_read"],
          input_schema: EMPTY,
        },
        {
          name: "list_models",
          description: "List local models in a local service",
          side_effect: "read",
          permissions: ["network"],
          input_schema: LIST,
        },
        {
          name: "check_fit",
          description: "Check model disk and memory fit before download",
          side_effect: "read",
          permissions: ["filesystem_read"],
          input_schema: DOWNLOAD,
        },
        {
          name: "download_model",
          description:
            "Download a model into a local model service after confirming fit and approval",
          side_effect: "execute",
          permissions: ["network"],
          timeout_ms: 120_000,
          input_schema: DOWNLOAD,
        },
        {
          name: "remove_model",
          description:
            "Remove one installed Ollama model after approval; LM Studio deletion is unsupported",
          side_effect: "execute",
          permissions: ["network"],
          input_schema: TARGET,
        },
        {
          name: "run_model",
          description: "Load an installed local model into memory after approval",
          side_effect: "execute",
          permissions: ["network"],
          input_schema: TARGET,
        },
        {
          name: "suggest_cleanup",
          description: "Suggest installed models to remove; no files are deleted",
          side_effect: "read",
          permissions: ["network"],
          input_schema: LIST,
        },
      ],
    },
    async init() {
      latest = null;
    },
    commands: {
      health_snapshot(_input, ctx) {
        return snapshot(ctx);
      },
      list_models(input) {
        return listModels(client, modelProvider(field(input, "provider")));
      },
      async check_fit(input) {
        const { provider, name } = parseModelRequest(input);
        return checkFit(await probe.sample(), await trustedSize(provider, name));
      },
      async download_model(input) {
        const { provider, name } = parseModelRequest(input);
        const fit = checkFit(await probe.sample(), await trustedSize(provider, name));
        if (!fit.fits)
          throw new MachineError(
            "insufficient",
            `Model download refused: ${fit.reason} capacity is insufficient or unknown`,
          );
        return manageModel(client, "download", provider, name);
      },
      async remove_model(input) {
        const { provider, name } = parseModelRequest(input);
        return manageModel(client, "remove", provider, name);
      },
      async run_model(input) {
        const { provider, name } = parseModelRequest(input);
        return manageModel(client, "run", provider, name);
      },
      async suggest_cleanup(input) {
        const provider = modelProvider(field(input, "provider"));
        const models = await listModels(client, provider);
        return {
          suggestions: models
            .filter((model) => !model.loaded)
            .map((model) => ({
              ...model,
              action: provider === "ollama" ? "remove_model" : "open_lmstudio",
            })),
        };
      },
    },
    health() {
      return {
        status: latest?.warnings.length ? ("degraded" as const) : ("healthy" as const),
        message: latest?.warnings.join(", ") ?? "No reading yet",
      };
    },
  });
}
