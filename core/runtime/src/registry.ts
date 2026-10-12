// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { RegistryError, RegistryService, type RegistryVersions } from "@phoenix/registry";
import type { RegistryApi } from "@phoenix/api";

/** Both paths are chosen by the Core host, never by the HTTP caller. */
export interface LocalRegistryConfig {
  trustedKeyFile: string;
  indexFile: string;
}

const MAX_KEY_BYTES = 16 * 1024;
const MAX_INDEX_BYTES = 1024 * 1024;

async function localFile(path: string, maxBytes: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size === 0 || stat.size > maxBytes)
      throw new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, "Invalid local registry file");
    return await file.readFile();
  } finally {
    await file.close();
  }
}

function registryError(error: unknown): never {
  if (error instanceof PhoenixError) throw error;
  if (error instanceof RegistryError) {
    if (error.code === "NOT_FOUND")
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, error.message);
    throw new PhoenixError(
      ErrorCode.SECURITY_POLICY_BLOCKED,
      `Registry verification failed: ${error.code}`,
    );
  }
  // Do not expose configured filesystem paths, PEM contents, or parser details to clients.
  throw new PhoenixError(
    ErrorCode.CAPABILITY_UNAVAILABLE,
    "Local registry key or index unavailable",
  );
}

/** Registry metadata only: no artifact download, module load, or third-party registration. */
export class LocalRegistryRuntime implements RegistryApi {
  constructor(
    private readonly config: LocalRegistryConfig | undefined,
    private readonly versions: RegistryVersions,
  ) {}

  private async verified() {
    if (!this.config?.trustedKeyFile || !this.config.indexFile)
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Local registry not configured");
    try {
      const raw = await localFile(this.config.trustedKeyFile, MAX_KEY_BYTES);
      const parsed: unknown = JSON.parse(raw.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new PhoenixError(
          ErrorCode.SECURITY_POLICY_BLOCKED,
          "Invalid local registry trust file",
        );
      const key = parsed as Record<string, unknown>;
      if (
        Object.keys(key).sort().join(",") !== "key_id,public_key" ||
        typeof key.key_id !== "string" ||
        typeof key.public_key !== "string"
      )
        throw new PhoenixError(
          ErrorCode.SECURITY_POLICY_BLOCKED,
          "Invalid local registry trust file",
        );
      const service = new RegistryService(new Map([[key.key_id, key.public_key]]), this.versions);
      const index = service.loadIndex(await localFile(this.config.indexFile, MAX_INDEX_BYTES));
      return { service, index };
    } catch (error) {
      return registryError(error);
    }
  }

  async browse() {
    if (!this.config?.trustedKeyFile || !this.config.indexFile)
      return { configured: false as const, sandbox_status: "unavailable" as const, entries: [] };
    const { index } = await this.verified();
    return {
      configured: true as const,
      sandbox_status: "unavailable" as const,
      entries: index.entries.map(
        ({ id, version, manifest, permissions, data_categories, license }) => ({
          id,
          version,
          name: manifest.name,
          description: manifest.description,
          permissions,
          data_categories,
          license,
          installable: false as const,
        }),
      ),
    };
  }

  async preview(id: string, version: string) {
    const { service, index } = await this.verified();
    try {
      return service.preview(index, id, version);
    } catch (error) {
      return registryError(error);
    }
  }

  install(): never {
    // Explicitly refuse even when no trust/index is configured. Never call registerExternal.
    throw new PhoenixError(
      ErrorCode.SECURITY_POLICY_BLOCKED,
      "Third-party executable installation requires an audited OS sandbox",
    );
  }
}
