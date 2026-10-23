// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { validateOutfitPack } from "../../../pet/assets/src/outfits";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import {
  RegistryError,
  RegistryService,
  type RegistryEntry,
  type RegistryVersions,
} from "@phoenix/registry";
import type { PermissionGateway } from "@phoenix/permissions";
import { installSkin } from "./fawkes-rebirth/skins";
import type { OutfitPack } from "../../../pet/assets/src/types";
import type { AppearanceRuntime } from "./appearance";
import type { RegistryApi } from "@phoenix/api";

/** Both paths are chosen by the Core host, never by the HTTP caller. */
export interface LocalRegistryConfig {
  trustedKeyFile: string;
  indexFile: string;
  artifactDirectory: string;
}

const MAX_KEY_BYTES = 16 * 1024;
const MAX_INDEX_BYTES = 1024 * 1024;

export async function localFile(path: string, maxBytes: number): Promise<Buffer> {
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
    private readonly permissions?: PermissionGateway,
    private readonly appearance?: AppearanceRuntime,
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
    if (!this.config?.trustedKeyFile || !this.config.indexFile || !this.config.artifactDirectory)
      return { configured: false as const, sandbox_status: "unavailable" as const, entries: [] };
    const { service, index } = await this.verified();
    return {
      configured: true as const,
      sandbox_status: "unavailable" as const,
      provenance: service.provenance(index),
      entries: index.entries.map((entry) => {
        if (entry.kind === "skin-pack")
          return {
            kind: "skin-pack" as const,
            id: entry.id,
            version: entry.version,
            name: entry.name,
            description: entry.description,
            license: entry.license,
            installable: true as const,
          };
        const capability = entry as RegistryEntry;
        return {
          kind: "capability" as const,
          id: capability.id,
          version: capability.version,
          name: capability.manifest.name,
          description: capability.manifest.description,
          permissions: capability.permissions,
          data_categories: capability.data_categories,
          license: capability.license,
          installable: false as const,
        };
      }),
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

  async installSkin(id: string, version: string): Promise<unknown> {
    if (!this.config?.artifactDirectory || !this.permissions || !this.appearance)
      throw new PhoenixError(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        "Local registry skin installation not configured",
      );
    const { service, index } = await this.verified();
    try {
      const preview = service.preview(index, id, version);
      if (!("kind" in preview) || preview.kind !== "skin-pack")
        throw new PhoenixError(
          ErrorCode.SECURITY_POLICY_BLOCKED,
          "Registry entry is not a data-only skin pack",
        );
      const entry = preview.entry;
      const action = await this.permissions.authorize({
        capabilityId: "registry-skins",
        command: "skin.install",
        permissions: [],
        sideEffect: "write",
        summary: `Install skin ${entry.id} ${entry.version} (${entry.license})`,
        details: {
          id: entry.id,
          version: entry.version,
          license: entry.license,
          signer: preview.provenance.signer_key_id,
          index_sha256: preview.provenance.index_sha256,
          artifact_sha256: entry.artifact.sha256,
        },
      });
      try {
        await installSkin(id, version, entry.license, {
          preview: async () => ({
            id: entry.id,
            version: entry.version,
            license: entry.license,
            artifact: entry.artifact,
            provenance: preview.provenance,
          }),
          fetch: async () =>
            service.readLocalSkinArtifact(index, id, version, this.config!.artifactDirectory),
          validate: (input) => validateOutfitPack(input) as OutfitPack,
          install: async (pack) => {
            this.appearance!.importPack(pack);
          },
        });
        this.permissions.recordOutcome(action, "succeeded", {
          id,
          version,
          license: entry.license,
          signer: preview.provenance.signer_key_id,
          index_sha256: preview.provenance.index_sha256,
          artifact_sha256: entry.artifact.sha256,
        });
        return this.appearance.get();
      } catch (error) {
        this.permissions.recordOutcome(action, "failed", {
          id,
          version,
          license: entry.license,
          signer: preview.provenance.signer_key_id,
          index_sha256: preview.provenance.index_sha256,
          artifact_sha256: entry.artifact.sha256,
        });
        throw error;
      }
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
