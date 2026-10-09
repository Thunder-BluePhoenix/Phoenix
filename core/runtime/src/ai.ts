// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The AI layer inside Core (Phase 27 wiring, Phase 29 rules).
//
// Nothing here talks to a network at construction or startup: `createDefaultProviders` only builds
// objects, and `AiService` makes no call while `enabled` is false. Settings, the
// AI_external_processing grant and the API key are read on EVERY call, so a change applies to the
// next request and a revoked grant stops the next send.
import type { AiApi, AiStatusView } from "@phoenix/api";
import {
  AiService,
  createDefaultProviders,
  isPrivacyClass,
  NO_CLOUD_OPT_IN,
  PRIVACY_CLASSES,
  type AiSettings,
  type CloudOptIn,
  type CloudSendRecord,
  type FetchLike,
  type ProviderRegistry,
} from "@phoenix/ai-models";
import type { Logger } from "@phoenix/logging";
import type { PermissionGateway } from "@phoenix/permissions";
import type { SecretStore, SettingsStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";

/**
 * Owner id of the AI grant and the AI credentials. A capability id must match
 * `^[a-z][a-z0-9_-]{1,63}$`, so no capability can ever be called this: a capability cannot
 * enable itself into holding the user's external-AI consent.
 */
export const AI_OWNER = "core:ai";
export const ANTHROPIC_SECRET_REF = "phoenix.ai.anthropic_api_key";
const SETTINGS_KEY = "ai.settings";
/** Longest key accepted. Real keys are ~110 characters; this is the capability-secret bound. */
const MAX_SECRET_CHARS = 8192;

interface StoredAiSettings {
  enabled: boolean;
  preferred: string | null;
  cloud_opt_in: CloudOptIn;
}

const DEFAULTS: StoredAiSettings = {
  enabled: false,
  preferred: null,
  cloud_opt_in: NO_CLOUD_OPT_IN,
};

export interface AiRuntimeDeps {
  settings: SettingsStore;
  permissions: PermissionGateway;
  secrets?: SecretStore;
  logger: Logger;
  /** Network for both providers. Tests count calls through it. */
  fetch?: FetchLike;
  ollamaUrl?: string;
  anthropicUrl?: string;
}

const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);

export class AiRuntime implements AiApi {
  readonly service: AiService;
  private readonly registry: ProviderRegistry;

  constructor(private readonly d: AiRuntimeDeps) {
    this.registry = createDefaultProviders({
      ...(d.fetch ? { fetch: d.fetch } : {}),
      ...(d.ollamaUrl ? { ollamaUrl: d.ollamaUrl } : {}),
      ...(d.anthropicUrl ? { anthropicUrl: d.anthropicUrl } : {}),
      anthropicKey: async () => d.secrets?.get(ANTHROPIC_SECRET_REF),
    });
    this.service = new AiService({
      registry: this.registry,
      policy: { allowed: () => this.externalProcessingGranted() },
      settings: () => this.aiSettings(),
      auditCloudSend: (record) => this.auditCloudSend(record),
      logger: d.logger.child("ai"),
    });
  }

  /** Ids of the providers that can embed text. */
  embeddingProviders(): string[] {
    return this.registry
      .list()
      .filter((p) => p.capabilities.embed)
      .map((p) => p.id);
  }

  /** The stored settings, with anything malformed read as its safe default (off). */
  private stored(): StoredAiSettings {
    const raw = this.d.settings.get<Partial<StoredAiSettings> | null>(SETTINGS_KEY, null);
    const optIn: Partial<CloudOptIn> = raw?.cloud_opt_in ?? {};
    return {
      enabled: raw?.enabled === true,
      preferred: typeof raw?.preferred === "string" ? raw.preferred : null,
      cloud_opt_in: {
        public: optIn.public === true,
        internal: optIn.internal === true,
        sensitive: optIn.sensitive === true,
      },
    };
  }

  /** What AiService reads on every call. */
  aiSettings(): AiSettings {
    const s = this.stored();
    return {
      enabled: s.enabled,
      ...(s.preferred ? { preferred: s.preferred } : {}),
      cloudOptIn: s.cloud_opt_in,
    };
  }

  /** Live check of the AI_external_processing grant. */
  externalProcessingGranted(): boolean {
    return this.d.permissions.grants.has(AI_OWNER, "AI_external_processing");
  }

  /** Counts and names only: never the text that is being sent. */
  private auditCloudSend(record: CloudSendRecord): void {
    this.d.permissions.audit.record({
      actor: AI_OWNER,
      action: "ai.cloud_send",
      decision: "allowed",
      details: { ...record, privacy: "sensitive" },
    });
  }

  private audit(action: string, details: Record<string, unknown>): void {
    this.d.permissions.audit.record({ actor: "user", action, decision: "info", details });
  }

  async status(): Promise<AiStatusView> {
    const s = this.stored();
    const base = {
      enabled: s.enabled,
      preferred: s.preferred,
      cloud_opt_in: { ...s.cloud_opt_in },
      external_processing_granted: this.externalProcessingGranted(),
    };
    if (!s.enabled) {
      // Listing providers is not contacting them: nothing is probed while AI is off.
      return {
        ...base,
        providers: this.registry.list().map((p) => ({
          id: p.id,
          label: p.label,
          locality: p.locality,
          available: false,
          reason: "AI is off",
        })),
      };
    }
    const live = await this.service.status();
    return {
      ...base,
      providers: live.providers.map((p) => ({
        id: p.id,
        label: p.label,
        locality: p.locality,
        available: p.available === true,
        reason: p.available === true ? null : p.detail,
      })),
    };
  }

  async setSettings(input: unknown): Promise<AiStatusView> {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw invalid("AI settings must be an object");
    }
    const next = this.stored();
    for (const [key, value] of Object.entries(input)) {
      if (key === "enabled") {
        if (typeof value !== "boolean") throw invalid('"enabled" must be a boolean');
        next.enabled = value;
      } else if (key === "preferred") {
        if (value !== null && (typeof value !== "string" || !this.registry.get(value))) {
          throw invalid('"preferred" must be null or the id of a known AI provider');
        }
        next.preferred = value;
      } else if (key === "cloud_opt_in") {
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
          throw invalid('"cloud_opt_in" must be an object');
        }
        for (const [cls, on] of Object.entries(value)) {
          if (!isPrivacyClass(cls)) throw invalid(`Unknown data class "${cls.slice(0, 40)}"`);
          if (typeof on !== "boolean") throw invalid(`"cloud_opt_in.${cls}" must be a boolean`);
          next.cloud_opt_in[cls] = on;
        }
      } else {
        throw invalid(`Unknown AI setting "${key.slice(0, 40)}"`);
      }
    }
    const before = this.stored();
    this.d.settings.set(SETTINGS_KEY, next);
    this.audit("ai.settings.changed", {
      enabled: next.enabled,
      preferred: next.preferred,
      cloud_opt_in: next.cloud_opt_in,
    });
    // The sensitive opt-in is the one decision with real privacy weight: it gets its own entry.
    if (before.cloud_opt_in.sensitive !== next.cloud_opt_in.sensitive) {
      this.audit("ai.sensitive_opt_in.changed", { sensitive: next.cloud_opt_in.sensitive });
    }
    return this.status();
  }

  async setExternalProcessing(granted: boolean): Promise<AiStatusView> {
    if (granted) this.d.permissions.grant(AI_OWNER, ["AI_external_processing"], "user");
    else this.d.permissions.revoke(AI_OWNER, ["AI_external_processing"], "user");
    return this.status();
  }

  async setSecret(value: string): Promise<void> {
    if (!this.d.secrets) {
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "No secret storage is available");
    }
    if (value.length === 0 || value.length > MAX_SECRET_CHARS || /[\r\n\0]/.test(value)) {
      throw invalid(`The key must be one line of 1-${MAX_SECRET_CHARS} characters`);
    }
    await this.d.secrets.set(ANTHROPIC_SECRET_REF, value);
    this.audit("ai.secret.set", { name: "anthropic_api_key" });
  }

  async deleteSecret(): Promise<void> {
    if (!this.d.secrets) {
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "No secret storage is available");
    }
    await this.d.secrets.delete(ANTHROPIC_SECRET_REF);
    this.audit("ai.secret.deleted", { name: "anthropic_api_key" });
  }

  /**
   * One true sentence for the privacy inventory, derived from the settings and the grant as they
   * are right now.
   */
  describeExternalProcessing(): string {
    const s = this.stored();
    if (!s.enabled) return "AI is off; nothing is sent to AI providers.";
    const classes = PRIVACY_CLASSES.filter((c) => s.cloud_opt_in[c]);
    // True by construction: extraction uses a purpose the cloud gate refuses for sensitive data, and
    // no cloud provider offers embeddings today. If one ever does, the embedding sentence changes.
    const cloudEmbeds = this.registry
      .list()
      .some((p) => p.locality === "cloud" && p.capabilities.embed);
    const transcripts =
      " Meeting transcripts are only read by a model on this device: extracting decisions and action items is never sent to a cloud provider.";
    const embedding = cloudEmbeds
      ? " Searching by meaning may send public or internal memory text to a cloud provider that can embed text, if you opted in for that kind of data."
      : " Searching by meaning (if you turn it on) embeds memory text on this device only.";
    if (!this.externalProcessingGranted() || classes.length === 0) {
      return `AI is on and is processed on this device by Ollama; nothing is sent to external AI providers.${transcripts}${embedding}`;
    }
    const cloud = this.registry
      .list()
      .filter((p) => p.locality === "cloud")
      .map((p) => p.label)
      .join(", ");
    const sensitive = classes.includes("sensitive")
      ? " Sensitive memories (including meeting summaries) are sent only when you ask Fawkes a question, and each such send is written to the audit log."
      : "";
    return `AI is on. When Ollama is unavailable or you choose a cloud provider, ${classes.join(", ")} memories may be sent to ${cloud}.${sensitive}${transcripts}${embedding}`;
  }
}
