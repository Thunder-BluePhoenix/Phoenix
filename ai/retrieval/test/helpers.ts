// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  MemoryPipeline,
  MemoryStore,
  createDefaultPolicy,
  ownerViewer,
  tokenize,
  type RawCapture,
  type Viewer,
} from "@phoenix/ai-memory";
import {
  AiService,
  ProviderRegistry,
  processedByLabel,
  type AiSettings,
  type EmbedRequest,
  type EmbedResult,
  type GenerateRequest,
  type GenerateResult,
  type Locality,
  type CostTier,
  type ModelProvider,
  type ProviderCapabilities,
  type PrivacyClass,
} from "@phoenix/ai-models";
import { openDatabase, type Database } from "@phoenix/persistence";
import type { Clock } from "@phoenix/ai-context";
import { AiEmbedder, VectorStore, type Embedder } from "../src";

export const NOW = new Date("2026-10-08T12:00:00.000Z");
export const CLOCK: Clock = { now: () => NOW, timeZone: "UTC" };

export interface Rig {
  db: Database;
  store: MemoryStore;
  pipeline: MemoryPipeline;
  vectors: VectorStore;
  owner: Viewer;
  clock: { now: Date };
  add(over: Partial<RawCapture> & { text: string; dedupeKey: string }): string;
}

export function rig(): Rig {
  const clock = { now: new Date(NOW) };
  const db = openDatabase(":memory:");
  const store = new MemoryStore(db, { now: () => clock.now });
  const pipeline = new MemoryPipeline({
    store,
    owner: "me",
    policy: createDefaultPolicy({ isSourceEnabled: () => true, allowSensitive: () => true }),
  });
  return {
    db,
    store,
    pipeline,
    vectors: new VectorStore(db, { now: () => clock.now }),
    owner: ownerViewer("me"),
    clock,
    add(over) {
      const out = pipeline.capture({
        source: "git",
        sourceRef: "phoenix",
        scope: "repo:phoenix",
        contentType: "commit",
        observedAt: "2026-10-07T10:00:00.000Z",
        provenance: {},
        ...over,
      });
      if (out.status !== "stored") throw new Error(`fixture not stored: ${JSON.stringify(out)}`);
      return out.item.id;
    },
  };
}

/** Width of the toy vectors. Words hash into buckets, so shared words give similar vectors. */
export const TOY_DIM = 64;

/** A deterministic bag-of-words embedding: texts sharing words are close, nothing else is. */
export function toyVector(text: string): number[] {
  const v: number[] = Array.from({ length: TOY_DIM }, (): number => 0);
  for (const word of tokenize(text)) {
    let h = 2166136261;
    for (const ch of word) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0;
    v[h % TOY_DIM] = (v[h % TOY_DIM] ?? 0) + 1;
  }
  if (v.every((x) => x <= 0)) v[0] = 1;
  return v;
}

export interface FakeEmbedProvider extends Omit<ModelProvider, "capabilities" | "costTier"> {
  capabilities: ProviderCapabilities;
  costTier: CostTier;
  embedRequests: EmbedRequest[];
  generateRequests: GenerateRequest[];
  /** When set, embed() throws this for the next calls. */
  failEmbed: Error | null;
  /** Return a vector for each input; defaults to toyVector. */
  vectorFor: (text: string) => number[];
  generateReply: (req: GenerateRequest) => string;
  model: string;
}

/** A scriptable provider that records every request it receives. */
export function fakeProvider(id: string, locality: Locality): FakeEmbedProvider {
  const provider: FakeEmbedProvider = {
    id,
    label: id,
    locality,
    capabilities: { generate: true, stream: false, embed: true },
    costTier: locality === "local" ? 0 : 2,
    typicalLatencyMs: 10,
    embedRequests: [],
    generateRequests: [],
    failEmbed: null,
    vectorFor: toyVector,
    generateReply: () => "{}",
    model: "toy-embed",
    models: () => Promise.resolve([]),
    health: () => Promise.resolve({ available: true, detail: "ok" }),
    generate(req: GenerateRequest): Promise<GenerateResult> {
      provider.generateRequests.push(req);
      return Promise.resolve({
        text: provider.generateReply(req),
        provenance: {
          provider: id,
          model: "toy-chat",
          locality,
          processedBy: processedByLabel(id, "toy-chat", locality),
        },
      });
    },
    stream: () => {
      throw new Error("stream not used");
    },
    embed(req: EmbedRequest): Promise<EmbedResult> {
      provider.embedRequests.push(req);
      if (provider.failEmbed) return Promise.reject(provider.failEmbed);
      const embeddings = req.input.map((t) => provider.vectorFor(t));
      return Promise.resolve({
        embeddings,
        dimensions: embeddings[0]?.length ?? 0,
        provenance: {
          provider: id,
          model: provider.model,
          locality,
          processedBy: processedByLabel(id, provider.model, locality),
        },
      });
    },
  };
  return provider;
}

export interface AiRig {
  ai: AiService;
  settings: AiSettings;
  local: FakeEmbedProvider;
  cloud: FakeEmbedProvider;
  grant: { value: boolean };
  embedder: AiEmbedder;
}

export function aiRig(over: Partial<AiSettings> = {}, clock?: { now: Date }): AiRig {
  const local = fakeProvider("local", "local");
  const cloud = fakeProvider("cloud", "cloud");
  const registry = new ProviderRegistry();
  registry.register(local);
  registry.register(cloud);
  const grant = { value: true };
  const settings: AiSettings = {
    enabled: true,
    // No cloud opt-in unless a test asks for one: a failing local provider must stay a failure.
    cloudOptIn: { public: false, internal: false, sensitive: false },
    ...over,
  };
  const ai = new AiService({
    registry,
    policy: { allowed: () => grant.value },
    settings: () => settings,
    sleep: () => Promise.resolve(),
    now: clock ? () => clock.now.getTime() : undefined,
    retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
    auditCloudSend: () => {},
  });
  return {
    ai,
    settings,
    local,
    cloud,
    grant,
    embedder: new AiEmbedder(ai, { provider: "local", model: "toy-embed" }),
  };
}

/** Embeds with toyVector directly, no router. For tests of the vector/retrieval logic alone. */
export class ToyEmbedder implements Embedder {
  readonly modelKey = "toy/bow";
  queries: string[] = [];
  seen: { text: string; privacy: PrivacyClass }[] = [];
  embedDocuments(texts: readonly string[], privacy: PrivacyClass): Promise<number[][]> {
    for (const text of texts) this.seen.push({ text, privacy });
    return Promise.resolve(texts.map(toyVector));
  }
  embedQuery(text: string): Promise<number[]> {
    this.queries.push(text);
    return Promise.resolve(toyVector(text));
  }
}
