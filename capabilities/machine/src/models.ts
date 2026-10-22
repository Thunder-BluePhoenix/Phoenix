// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { MachineReading } from "./probes";

export type Provider = "ollama" | "lmstudio";
export interface LocalModel {
  provider: Provider;
  name: string;
  sizeBytes: number;
  loaded: boolean;
}
export interface ModelClient {
  request(
    provider: Provider,
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: object,
  ): Promise<unknown>;
}
export class MachineError extends Error {
  constructor(
    readonly kind: "invalid" | "unavailable" | "insufficient" | "unsupported" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "MachineError";
  }
}
const endpoints: Record<Provider, string> = {
  ollama: "http://127.0.0.1:11434",
  lmstudio: "http://127.0.0.1:1234",
};
const MAX_RESPONSE_BYTES = 2_000_000;
const TOO_LARGE = "Model service response is too large";
/** Fails closed: a declared or streamed size over `limit` is rejected without buffering the rest. */
async function readCapped(response: Response, limit: number): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new MachineError("unavailable", TOO_LARGE);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new MachineError("unavailable", TOO_LARGE);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof MachineError) throw error;
    throw new MachineError("unavailable", "Local model service response could not be read");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
export function createLocalModelClient(fetcher: typeof fetch = fetch): ModelClient {
  return {
    async request(provider, method, path, body) {
      // URL is constructed from fixed loopback origins and fixed endpoint paths only.
      if (
        !Object.hasOwn(endpoints, provider) ||
        !/^\/(?:api\/(?:tags|ps|pull|delete|generate|v1\/models(?:\/download|\/load)?))$/.test(path)
      ) {
        throw new MachineError("invalid", "Unknown local model endpoint");
      }
      let response: Response;
      try {
        response = await fetcher(`${endpoints[provider]}${path}`, {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(120_000),
          headers: { "Content-Type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      } catch {
        throw new MachineError("unavailable", "Local model service is not reachable");
      }
      if (!response.ok)
        throw new MachineError("unavailable", `Local model service returned ${response.status}`);
      // Ollama's pull and generate are explicitly non-streaming; cap response size in bytes.
      const text = await readCapped(response, MAX_RESPONSE_BYTES);
      try {
        return text ? (JSON.parse(text) as unknown) : {};
      } catch {
        throw new MachineError("unavailable", "Invalid local model response");
      }
    },
  };
}
export function modelProvider(input: unknown): Provider {
  if (input === "ollama" || input === "lmstudio") return input;
  throw new MachineError("invalid", "Choose Ollama or LM Studio");
}
export function modelName(input: unknown): string {
  if (
    typeof input !== "string" ||
    input.length > 180 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/.test(input) ||
    input.includes("..") ||
    input.includes("//") ||
    input.startsWith("http")
  ) {
    throw new MachineError("invalid", "Invalid model identifier");
  }
  return input;
}
export function modelSize(input: unknown): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input <= 0 || input > 2 ** 50) {
    throw new MachineError("invalid", "A positive model size in bytes is required");
  }
  return input;
}
export function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined;
}
export function parseModelRequest(input: unknown): { provider: Provider; name: string } {
  return {
    provider: modelProvider(field(input, "provider")),
    name: modelName(field(input, "name")),
  };
}
export function checkFit(
  reading: MachineReading,
  sizeBytes: number,
): { fits: boolean; reason: "disk" | "memory" | "unknown" | null } {
  const size = modelSize(sizeBytes);
  const disk = reading.diskFreeBytes;
  const memory = reading.memoryFreeBytes;
  if (disk === null || memory === null) return { fits: false, reason: "unknown" };
  // Keep 2 GiB plus a quarter of the estimate free on disk; allow room for runtime overhead in RAM.
  if (disk < Math.ceil(size * 1.25) + 2 * 1024 ** 3) return { fits: false, reason: "disk" };
  if (memory < Math.ceil(size * 1.25)) return { fits: false, reason: "memory" };
  return { fits: true, reason: null };
}
export async function listModels(client: ModelClient, provider: Provider): Promise<LocalModel[]> {
  const raw = await client.request(
    provider,
    "GET",
    provider === "ollama" ? "/api/tags" : "/api/v1/models",
  );
  const entries = field(raw, "models");
  if (!Array.isArray(entries)) throw new MachineError("unavailable", "Invalid local model list");
  const active = provider === "ollama" ? await client.request(provider, "GET", "/api/ps") : null;
  const running = field(active, "models");
  const activeNames = new Set(
    Array.isArray(running) ? running.map((entry: unknown) => field(entry, "name")) : [],
  );
  return entries.flatMap((entry: unknown): LocalModel[] => {
    const name = field(entry, provider === "ollama" ? "name" : "key");
    const size = field(entry, provider === "ollama" ? "size" : "size_bytes");
    if (
      typeof name !== "string" ||
      typeof size !== "number" ||
      !Number.isSafeInteger(size) ||
      size < 0
    )
      return [];
    try {
      modelName(name);
    } catch {
      return [];
    }
    const loaded =
      provider === "ollama"
        ? activeNames.has(name)
        : Array.isArray(field(entry, "loaded_instances")) &&
          (field(entry, "loaded_instances") as unknown[]).length > 0;
    return [{ provider, name, sizeBytes: size, loaded }];
  });
}
export async function manageModel(
  client: ModelClient,
  action: "download" | "remove" | "run",
  provider: Provider,
  name: string,
): Promise<unknown> {
  if (action === "remove") {
    if (provider === "lmstudio")
      throw new MachineError(
        "unsupported",
        "LM Studio does not expose an API for deleting a downloaded model; remove it in LM Studio.",
      );
    const installed = await listModels(client, provider);
    if (!installed.some((model) => model.name === name))
      throw new MachineError("not_found", "Only an installed model may be removed");
    return client.request(provider, "DELETE", "/api/delete", { name });
  }
  if (action === "download")
    return client.request(
      provider,
      "POST",
      provider === "ollama" ? "/api/pull" : "/api/v1/models/download",
      provider === "ollama" ? { name, stream: false } : { model: name },
    );
  if (provider === "lmstudio") {
    const installed = await listModels(client, provider);
    if (!installed.some((model) => model.name === name))
      throw new MachineError("not_found", "Download the model before loading it");
    return client.request(provider, "POST", "/api/v1/models/load", { model: name });
  }
  const installed = await listModels(client, provider);
  if (!installed.some((model) => model.name === name))
    throw new MachineError("not_found", "Download the model before running it");
  return client.request(provider, "POST", "/api/generate", {
    model: name,
    prompt: "",
    stream: false,
    keep_alive: "5m",
  });
}
