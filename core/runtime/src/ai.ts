// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The AI layer inside Core (Phase 27 wiring, Phase 29 rules).
//
// Nothing here talks to a network at construction or startup: `createDefaultProviders` only builds
// objects, and `AiService` makes no call while `enabled` is false. Settings, the
// AI_external_processing grant and the API key are read on EVERY call, so a change applies to the
// next request and a revoked grant stops the next send.
import type {
  AiApi,
  AiEndpointView,
  AiProviderModelView,
  AiProviderView,
  AiRouteView,
  AiStatusView,
} from "@phoenix/api";
import {
  AiService,
  assertSafeBaseUrl,
  createDefaultProviders,
  createEndpointProvider,
  isModelId,
  isPrivacyClass,
  localityOfUrl,
  MAX_ENDPOINTS,
  ModelError,
  NO_CLOUD_OPT_IN,
  OPENAI_COMPATIBLE_PRESETS,
  PRIVACY_CLASSES,
  RESERVED_PROVIDER_IDS,
  ROUTABLE_CATEGORIES,
  type AiSettings,
  type CloudOptIn,
  type CloudSendRecord,
  type Endpoint,
  type FetchLike,
  type ModelInfo,
  type ModelProvider,
  type Price,
  type ProviderRegistry,
  type Route,
  type RoutableCategory,
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
/** Where a provider's key lives in the SecretStore. The Anthropic name predates the others and is kept. */
export const secretRef = (providerId: string) => `phoenix.ai.${providerId}_api_key`;
export const ANTHROPIC_SECRET_REF = secretRef("anthropic");
const SETTINGS_KEY = "ai.settings";
/** Longest key accepted. Real keys are ~110 characters; this is the capability-secret bound. */
const MAX_SECRET_CHARS = 8192;
/** Provider ids a user may create, and the only ids a secret route accepts. */
const PROVIDER_ID = /^[a-z][a-z0-9-]{1,23}$/;
const MAX_LABEL_CHARS = 40;
const MAX_URL_CHARS = 300;
const MAX_PRICES = 200;
/** A price above this is a typo, not a price (USD per million tokens). */
const MAX_PRICE = 1_000_000;
/** Control, bidi-override/isolate, direction-mark and zero-width characters: not allowed in any name shown to the user. */
const HIDDEN_CHARS =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/;
const BUILTIN_IDS: Record<string, true> = { ollama: true, anthropic: true, gemini: true };

type StoredRouting = Partial<Record<RoutableCategory, Route>>;

interface StoredAiSettings {
  enabled: boolean;
  preferred: string | null;
  cloud_opt_in: CloudOptIn;
  routing: StoredRouting;
  endpoints: Endpoint[];
  prices: Record<string, Price>;
}

const DEFAULTS: StoredAiSettings = {
  enabled: false,
  preferred: null,
  cloud_opt_in: NO_CLOUD_OPT_IN,
  routing: {},
  endpoints: [],
  prices: {},
};

export interface AiRuntimeDeps {
  settings: SettingsStore;
  permissions: PermissionGateway;
  secrets?: SecretStore;
  logger: Logger;
  /** Network for every provider. Tests count calls through it. */
  fetch?: FetchLike;
  ollamaUrl?: string;
  anthropicUrl?: string;
}

const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

function shownText(value: unknown, what: string, max: number): string {
  if (typeof value !== "string") throw invalid(`${what} must be a string`);
  const text = value.trim();
  if (text.length === 0 || text.length > max) {
    throw invalid(`${what} must be 1-${max} characters`);
  }
  if (HIDDEN_CHARS.test(text))
    throw invalid(`${what} must not contain hidden or control characters`);
  return text;
}

function parseRoute(value: unknown, category: string, known: (id: string) => boolean): Route {
  const o = asRecord(value, `"routing.${category}"`);
  for (const key of Object.keys(o)) {
    if (key !== "provider" && key !== "model")
      throw invalid(`Unknown field in "routing.${category}"`);
  }
  if (typeof o.provider !== "string" || !known(o.provider)) {
    throw invalid(`"routing.${category}.provider" must be the id of a known AI provider`);
  }
  if (o.model === undefined || o.model === null) return { provider: o.provider };
  if (typeof o.model !== "string" || !isModelId(o.model)) {
    throw invalid(`"routing.${category}.model" is not a valid model name`);
  }
  return { provider: o.provider, model: o.model };
}

export class AiRuntime implements AiApi {
  readonly service: AiService;
  private readonly registry: ProviderRegistry;
  /** The endpoints currently registered, to tell what changed. */
  private registered: Endpoint[] = [];

  constructor(private readonly d: AiRuntimeDeps) {
    this.registry = createDefaultProviders({
      ...(d.fetch ? { fetch: d.fetch } : {}),
      ...(d.ollamaUrl ? { ollamaUrl: d.ollamaUrl } : {}),
      ...(d.anthropicUrl ? { anthropicUrl: d.anthropicUrl } : {}),
      anthropicKey: () => this.keyFor("anthropic"),
      keyFor: (id) => this.keyFor(id),
    });
    this.syncEndpoints(this.stored().endpoints);
    this.service = new AiService({
      registry: this.registry,
      policy: { allowed: () => this.externalProcessingGranted() },
      settings: () => this.aiSettings(),
      auditCloudSend: (record) => this.auditCloudSend(record),
      logger: d.logger.child("ai"),
    });
  }

  /** The stored key of one provider, read for every request. Never cached, never logged. */
  private async keyFor(providerId: string): Promise<string | undefined> {
    return this.d.secrets?.get(secretRef(providerId));
  }

  /** Ids of the providers that can embed text. */
  embeddingProviders(): string[] {
    return this.registry
      .list()
      .filter((p) => p.capabilities.embed)
      .map((p) => p.id);
  }

  hasProvider(id: string): boolean {
    return PROVIDER_ID.test(id) && this.registry.get(id) !== undefined;
  }

  /** Makes the registry hold exactly the user's endpoints (skipping any stored one that is now unsafe). */
  private syncEndpoints(next: Endpoint[]): void {
    for (const old of this.registered) this.registry.unregister(old.id);
    this.registered = [];
    for (const endpoint of next) {
      try {
        this.registry.register(
          createEndpointProvider(endpoint, {
            keyFor: (id) => this.keyFor(id),
            fetch: this.d.fetch,
          }),
        );
        this.registered.push(endpoint);
      } catch {
        // An unsafe stored endpoint is simply not a provider; the settings view still lists it.
      }
    }
  }

  /** The stored settings, with anything malformed read as its safe default (off / empty). */
  private stored(): StoredAiSettings {
    const raw = this.d.settings.get<Partial<StoredAiSettings> | null>(SETTINGS_KEY, null);
    const optIn: Partial<CloudOptIn> = raw?.cloud_opt_in ?? {};
    const routing: StoredRouting = {};
    const rawRouting: Record<string, unknown> =
      raw?.routing && typeof raw.routing === "object" ? raw.routing : {};
    for (const category of ROUTABLE_CATEGORIES as readonly RoutableCategory[]) {
      const r = Object.hasOwn(rawRouting, category) ? rawRouting[category] : undefined;
      if (r && typeof r === "object") {
        const { provider, model } = r as Partial<Route>;
        if (typeof provider === "string" && PROVIDER_ID.test(provider)) {
          routing[category] =
            typeof model === "string" && isModelId(model) ? { provider, model } : { provider };
        }
      }
    }
    const endpoints: Endpoint[] = [];
    for (const e of Array.isArray(raw?.endpoints) ? raw.endpoints.slice(0, MAX_ENDPOINTS) : []) {
      if (
        e &&
        typeof e.id === "string" &&
        PROVIDER_ID.test(e.id) &&
        typeof e.label === "string" &&
        typeof e.base_url === "string"
      ) {
        endpoints.push({
          id: e.id,
          label: e.label,
          base_url: e.base_url,
          ...(typeof e.preset === "string" ? { preset: e.preset } : {}),
        });
      }
    }
    const prices: Record<string, Price> = {};
    const rawPrices: Record<string, unknown> =
      raw?.prices && typeof raw.prices === "object" ? raw.prices : {};
    for (const [key, p] of Object.entries(rawPrices)) {
      const price = p as Partial<Price> | null;
      if (
        price &&
        typeof price.input_per_mtok === "number" &&
        Number.isFinite(price.input_per_mtok) &&
        price.input_per_mtok >= 0 &&
        typeof price.output_per_mtok === "number" &&
        Number.isFinite(price.output_per_mtok) &&
        price.output_per_mtok >= 0
      ) {
        prices[key] = {
          input_per_mtok: price.input_per_mtok,
          output_per_mtok: price.output_per_mtok,
        };
      }
    }
    return {
      enabled: raw?.enabled === true,
      preferred: typeof raw?.preferred === "string" ? raw.preferred : null,
      cloud_opt_in: {
        public: optIn.public === true,
        internal: optIn.internal === true,
        sensitive: optIn.sensitive === true,
      },
      routing,
      endpoints,
      prices,
    };
  }

  /** What AiService reads on every call. */
  aiSettings(): AiSettings {
    const s = this.stored();
    return {
      enabled: s.enabled,
      ...(s.preferred ? { preferred: s.preferred } : {}),
      cloudOptIn: s.cloud_opt_in,
      routing: s.routing,
      prices: s.prices,
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

  private kindOf(id: string): AiProviderView["kind"] {
    if (BUILTIN_IDS[id]) return "builtin";
    return OPENAI_COMPATIBLE_PRESETS.some((p) => p.id === id) ? "preset" : "custom";
  }

  private baseUrlOf(id: string, endpoints: Endpoint[]): string | null {
    return (
      OPENAI_COMPATIBLE_PRESETS.find((p) => p.id === id)?.baseUrl ??
      endpoints.find((e) => e.id === id)?.base_url ??
      null
    );
  }

  /**
   * Models of one provider, on request. Listing sends only the key (no user data), but a cloud
   * provider is still not contacted unless the user has granted external processing.
   */
  private async listModels(
    provider: ModelProvider,
  ): Promise<{ models: AiProviderModelView[] | null; error: string | null }> {
    if (provider.locality === "cloud" && !this.externalProcessingGranted()) {
      return { models: null, error: "Allow external AI processing to list this provider's models" };
    }
    try {
      const found: ModelInfo[] = await provider.models();
      return {
        models: found.filter((m) => m.remote !== true).map((m) => ({ id: m.id, kind: m.kind })),
        error: null,
      };
    } catch (err) {
      return {
        models: null,
        error: err instanceof ModelError ? err.message : "Could not list the models",
      };
    }
  }

  async status(modelsOf?: string): Promise<AiStatusView> {
    const s = this.stored();
    const live = s.enabled ? await this.service.status() : undefined;
    const providers: AiProviderView[] = [];
    for (const p of this.registry.list()) {
      const status = live?.providers.find((l) => l.id === p.id);
      const keyPolicy = p.keyPolicy ?? "none";
      const keySet = keyPolicy !== "none" && ((await this.keyFor(p.id))?.trim() ?? "") !== "";
      const missingKey = keyPolicy === "required" && !keySet;
      const listed =
        modelsOf === p.id && s.enabled ? await this.listModels(p) : { models: null, error: null };
      providers.push({
        id: p.id,
        label: p.label,
        locality: p.locality,
        kind: this.kindOf(p.id),
        // Listing providers is not contacting them: nothing is probed while AI is off.
        available: s.enabled && !missingKey && status?.available === true,
        reason: !s.enabled
          ? "AI is off"
          : missingKey
            ? `No API key is set for ${p.label}`
            : status?.available === true
              ? null
              : (status?.detail ?? "not checked"),
        key_policy: keyPolicy,
        key_set: keySet,
        default_model: p.defaultModel ?? null,
        base_url: this.baseUrlOf(p.id, s.endpoints),
        models: listed.models,
        models_error: listed.error,
      });
    }
    const routing = { chat: null, summaries: null, cleanup: null } as AiStatusView["routing"];
    for (const category of ROUTABLE_CATEGORIES as readonly RoutableCategory[]) {
      const r = s.routing[category];
      routing[category] = r
        ? ({ provider: r.provider, model: r.model ?? null } satisfies AiRouteView)
        : null;
    }
    return {
      enabled: s.enabled,
      preferred: s.preferred,
      cloud_opt_in: { ...s.cloud_opt_in },
      external_processing_granted: this.externalProcessingGranted(),
      routing,
      endpoints: s.endpoints.map((e): AiEndpointView => ({
        id: e.id,
        label: e.label,
        base_url: e.base_url,
        preset: e.preset ?? null,
        locality: this.localityOf(e.base_url),
      })),
      prices: s.prices,
      providers,
    };
  }

  /** Derived from the URL. An unparsable stored URL is treated as cloud (the cautious reading). */
  private localityOf(baseUrl: string): "local" | "cloud" {
    try {
      return localityOfUrl(baseUrl);
    } catch {
      return "cloud";
    }
  }

  private parseEndpoints(value: unknown): Endpoint[] {
    if (!Array.isArray(value) || value.length > MAX_ENDPOINTS) {
      throw invalid(`"endpoints" must be a list of at most ${MAX_ENDPOINTS}`);
    }
    const seen: Record<string, true> = {};
    return value.map((raw): Endpoint => {
      const o = asRecord(raw, "An endpoint");
      for (const key of Object.keys(o)) {
        if (!["id", "label", "base_url", "preset"].includes(key)) {
          throw invalid("An endpoint has an unknown field");
        }
      }
      if (typeof o.id !== "string" || !PROVIDER_ID.test(o.id)) {
        throw invalid(
          "An endpoint id must be 2-24 characters: a-z, 0-9 and -, starting with a letter",
        );
      }
      if (RESERVED_PROVIDER_IDS.includes(o.id) || seen[o.id]) {
        throw invalid(`The endpoint id "${o.id}" is already used`);
      }
      seen[o.id] = true;
      const label = shownText(o.label, "An endpoint name", MAX_LABEL_CHARS);
      const baseUrl = shownText(o.base_url, "An endpoint base_url", MAX_URL_CHARS);
      let normalised: string;
      try {
        normalised = assertSafeBaseUrl(baseUrl, o.id, label);
      } catch (err) {
        throw invalid(err instanceof ModelError ? err.message : "The base_url is not valid");
      }
      let preset: string | undefined;
      if (o.preset !== undefined && o.preset !== null) {
        if (
          typeof o.preset !== "string" ||
          !OPENAI_COMPATIBLE_PRESETS.some((p) => p.id === o.preset)
        ) {
          throw invalid("An endpoint preset is not a known preset");
        }
        preset = o.preset;
      }
      return { id: o.id, label, base_url: normalised, ...(preset ? { preset } : {}) };
    });
  }

  private parsePrices(value: unknown, known: (id: string) => boolean): Record<string, Price> {
    const o = asRecord(value, '"prices"');
    const entries = Object.entries(o);
    if (entries.length > MAX_PRICES)
      throw invalid(`"prices" can hold at most ${MAX_PRICES} models`);
    const out: Record<string, Price> = {};
    for (const [key, raw] of entries) {
      const colon = key.indexOf(":");
      const providerId = colon < 0 ? "" : key.slice(0, colon);
      const model = colon < 0 ? "" : key.slice(colon + 1);
      if (!PROVIDER_ID.test(providerId) || !known(providerId) || !isModelId(model)) {
        throw invalid('A price key must be "<provider id>:<model>" for a known provider');
      }
      const p = asRecord(raw, "A price");
      for (const field of Object.keys(p)) {
        if (field !== "input_per_mtok" && field !== "output_per_mtok") {
          throw invalid("A price has an unknown field");
        }
      }
      const { input_per_mtok: input, output_per_mtok: output } = p;
      if (
        typeof input !== "number" ||
        typeof output !== "number" ||
        !Number.isFinite(input) ||
        !Number.isFinite(output) ||
        input < 0 ||
        output < 0 ||
        input > MAX_PRICE ||
        output > MAX_PRICE
      ) {
        throw invalid(`Prices must be numbers from 0 to ${MAX_PRICE} (USD per million tokens)`);
      }
      out[key] = { input_per_mtok: input, output_per_mtok: output };
    }
    return out;
  }

  async setSettings(input: unknown): Promise<AiStatusView> {
    const body = asRecord(input, "AI settings");
    const before = this.stored();
    const next = this.stored();
    // Endpoints first: routing, preferred and prices may refer to a provider created in this request.
    if (Object.hasOwn(body, "endpoints")) next.endpoints = this.parseEndpoints(body.endpoints);
    const customIds = next.endpoints.map((e) => e.id);
    const known = (id: string) =>
      PROVIDER_ID.test(id) && (RESERVED_PROVIDER_IDS.includes(id) || customIds.includes(id));
    for (const [key, value] of Object.entries(body)) {
      if (key === "enabled") {
        if (typeof value !== "boolean") throw invalid('"enabled" must be a boolean');
        next.enabled = value;
      } else if (key === "preferred") {
        if (value !== null && (typeof value !== "string" || !known(value))) {
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
      } else if (key === "routing") {
        // Per category: a route replaces that category, null clears it. Others are untouched.
        for (const [category, route] of Object.entries(asRecord(value, '"routing"'))) {
          if (
            !(ROUTABLE_CATEGORIES as readonly string[]).includes(category) ||
            category === "embeddings"
          ) {
            throw invalid(`Unknown routing category "${category.slice(0, 40)}"`);
          }
          const c = category as RoutableCategory;
          if (route === null) delete next.routing[c];
          else next.routing[c] = parseRoute(route, category, known);
        }
      } else if (key === "prices") {
        next.prices = this.parsePrices(value, known);
      } else if (key !== "endpoints") {
        throw invalid(`Unknown AI setting "${key.slice(0, 40)}"`);
      }
    }
    // A key belongs to a destination: an endpoint that is removed, or sent somewhere else, loses it.
    const changed = before.endpoints.filter((old) => {
      const now = next.endpoints.find((e) => e.id === old.id);
      return !now || now.base_url !== old.base_url;
    });
    this.d.settings.set(SETTINGS_KEY, next);
    this.syncEndpoints(next.endpoints);
    for (const old of changed) {
      await this.d.secrets?.delete(secretRef(old.id));
      this.service.forgetHealth(old.id);
    }
    this.audit("ai.settings.changed", {
      enabled: next.enabled,
      preferred: next.preferred,
      cloud_opt_in: next.cloud_opt_in,
      routing: next.routing,
      endpoints: next.endpoints.map((e) => ({
        id: e.id,
        locality: this.localityOf(e.base_url),
      })),
      priced_models: Object.keys(next.prices).length,
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

  private requireSecrets(providerId: string): SecretStore {
    if (!this.hasProvider(providerId)) {
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "AI provider not found");
    }
    if (!this.d.secrets) {
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "No secret storage is available");
    }
    return this.d.secrets;
  }

  async setSecret(providerId: string, value: string): Promise<void> {
    const secrets = this.requireSecrets(providerId);
    if (value.length === 0 || value.length > MAX_SECRET_CHARS || /[\r\n\0]/.test(value)) {
      throw invalid(`The key must be one line of 1-${MAX_SECRET_CHARS} characters`);
    }
    await secrets.set(secretRef(providerId), value);
    this.service.forgetHealth(providerId);
    this.audit("ai.secret.set", { provider: providerId });
  }

  async deleteSecret(providerId: string): Promise<void> {
    const secrets = this.requireSecrets(providerId);
    await secrets.delete(secretRef(providerId));
    this.service.forgetHealth(providerId);
    this.audit("ai.secret.deleted", { provider: providerId });
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
    // no cloud provider is ever planned for embeddings (the router refuses it). If one ever is, the
    // embedding sentence changes.
    const cloudEmbeds = this.registry
      .list()
      .some((p) => p.locality === "cloud" && p.capabilities.embed);
    const transcripts =
      " Meeting transcripts are only read by a model on this device: extracting decisions and action items is never sent to a cloud provider.";
    const embedding = cloudEmbeds
      ? " Searching by meaning may send public or internal memory text to a cloud provider that can embed text, if you opted in for that kind of data."
      : " Searching by meaning (if you turn it on) embeds memory text on this device only.";
    // Local servers the user chose (LM Studio, a loopback endpoint) also run on this device.
    const chosen = [s.preferred, ...Object.values(s.routing).map((r) => r.provider)];
    const otherLocal = [...new Set(chosen)]
      .map((id) => (id === null ? undefined : this.registry.get(id)))
      .filter(
        (p): p is ModelProvider => p !== undefined && p.locality === "local" && p.id !== "ollama",
      )
      .map((p) => p.label);
    const onDevice = `Ollama${otherLocal.length > 0 ? ` or ${otherLocal.join(", ")}` : ""}`;
    if (!this.externalProcessingGranted() || classes.length === 0) {
      return `AI is on and is processed on this device by ${onDevice}; nothing is sent to external AI providers.${transcripts}${embedding}`;
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
