// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ModelError } from "@phoenix/ai-models";
import { describe, expect, it } from "vitest";
import { AiEmbedder, EmbedderMismatchError, VectorIndexer, type IndexerOptions } from "../src";
import { aiRig, rig, toyVector, ToyEmbedder, type Rig } from "./helpers";

function indexer(r: Rig, embedder: IndexerOptions["embedder"], over: Partial<IndexerOptions> = {}) {
  return new VectorIndexer({
    vectors: r.vectors,
    embedder,
    sleep: () => Promise.resolve(),
    now: () => r.clock.now.getTime(),
    ...over,
  });
}

describe("VectorIndexer", () => {
  it("embeds only items that have no vector yet (incremental)", async () => {
    const r = rig();
    const embedder = new ToyEmbedder();
    for (let i = 0; i < 5; i++) r.add({ text: `item ${i} text`, dedupeKey: `k${i}` });
    const ix = indexer(r, embedder);
    expect(await ix.run()).toMatchObject({ embedded: 5, failed: 0, remaining: 0, degraded: [] });
    r.add({ text: "a new fact arrives", dedupeKey: "new" });
    embedder.seen.length = 0;
    expect(await ix.run()).toMatchObject({ embedded: 1, remaining: 0 });
    expect(embedder.seen.map((s) => s.text)).toEqual(["a new fact arrives"]);
    embedder.seen.length = 0;
    expect(await ix.run()).toMatchObject({ embedded: 0 });
    expect(embedder.seen).toEqual([]);
  });

  it("batches, and caps work per run so a huge backlog is resumed, not swallowed", async () => {
    const r = rig();
    const embedder = new ToyEmbedder();
    for (let i = 0; i < 10; i++) r.add({ text: `item ${i}`, dedupeKey: `k${i}` });
    const ix = indexer(r, embedder, { batchSize: 3, maxItemsPerRun: 7 });
    const first = await ix.run();
    expect(first).toMatchObject({ embedded: 7, remaining: 3, capped: true });
    const second = await ix.run();
    expect(second).toMatchObject({ embedded: 3, remaining: 0, capped: false });
    expect(r.vectors.count(embedder.modelKey)).toBe(10);
  });

  it("is resumable across instances: all state is in SQLite", async () => {
    const r = rig();
    const embedder = new ToyEmbedder();
    for (let i = 0; i < 4; i++) r.add({ text: `item ${i}`, dedupeKey: `k${i}` });
    await indexer(r, embedder, { maxItemsPerRun: 2 }).run();
    const resumed = await indexer(r, embedder).run();
    expect(resumed.embedded).toBe(2);
    expect(r.vectors.count(embedder.modelKey)).toBe(4);
  });

  it("paces provider calls with the injected sleeper", async () => {
    const r = rig();
    for (let i = 0; i < 3; i++) r.add({ text: `item ${i}`, dedupeKey: `k${i}` });
    const sleeps: number[] = [];
    let t = 0;
    await indexer(r, new ToyEmbedder(), {
      batchSize: 1,
      minIntervalMs: 100,
      now: () => t,
      sleep: (ms) => {
        sleeps.push(ms);
        t += ms;
        return Promise.resolve();
      },
    }).run();
    expect(sleeps).toEqual([100, 100]);
  });

  it("runs one embedding at a time: concurrent triggers share a run", async () => {
    const r = rig();
    const embedder = new ToyEmbedder();
    for (let i = 0; i < 4; i++) r.add({ text: `item ${i}`, dedupeKey: `k${i}` });
    const ix = indexer(r, embedder, { batchSize: 10 });
    const [a, b] = await Promise.all([ix.run(), ix.run()]);
    expect(a).toBe(b);
    expect(embedder.seen).toHaveLength(4);
  });

  it("each provider call carries one data class, the sensitivity of its items", async () => {
    const r = rig();
    const embedder = new ToyEmbedder();
    r.add({ text: "public-ish commit", dedupeKey: "a" });
    r.add({
      text: "meeting secret",
      dedupeKey: "m",
      contentType: "meeting_summary",
      source: "kage",
    });
    await indexer(r, embedder, { batchSize: 10 }).run();
    expect(embedder.seen).toEqual([
      { text: "public-ish commit", privacy: "internal" },
      { text: "meeting secret", privacy: "sensitive" },
    ]);
  });
});

describe("failure tolerance", () => {
  it("a failing provider never loses items: they are recorded, retried later, and capture is untouched", async () => {
    const r = rig();
    const a = aiRig({}, r.clock);
    a.local.failEmbed = new ModelError("network", "local", "connection refused", {
      retryable: true,
    });
    const id = r.add({ text: "alpha beta", dedupeKey: "a" });
    r.add({ text: "gamma delta", dedupeKey: "b" });
    const ix = indexer(r, a.embedder, { backoffMs: () => 60_000 });
    const failed = await ix.run();
    expect(failed).toMatchObject({ embedded: 0, failed: 0, remaining: 2 });
    expect(failed.degraded.map((d) => d.reason)).toEqual(["provider_unavailable"]);
    // Both items are still live memories and still searchable by keywords.
    expect(r.store.count()).toBe(2);
    expect(r.store.get(id)!.text).toBe("alpha beta");
    // An outage is not the items' fault: nothing is recorded against them, so it can never park them.
    expect(r.vectors.failures(a.embedder.modelKey)).toEqual([]);

    // During the cooldown the provider is not contacted again.
    const calls = a.local.embedRequests.length;
    const during = await ix.run();
    expect(during).toMatchObject({ embedded: 0, remaining: 2 });
    expect(during.degraded[0]?.reason).toBe("provider_unavailable");
    expect(a.local.embedRequests.length).toBe(calls);

    // Provider recovers, cooldown passes: everything gets its vector.
    a.local.failEmbed = null;
    r.clock.now = new Date(r.clock.now.getTime() + 61_000);
    expect(await ix.run()).toMatchObject({ embedded: 2, failed: 0, remaining: 0 });
    expect(r.vectors.failures(a.embedder.modelKey)).toEqual([]);
  });

  it("a provider that is down costs one call per run, not one per item", async () => {
    const r = rig();
    const a = aiRig({}, r.clock);
    a.local.failEmbed = new ModelError("network", "local", "down");
    for (let i = 0; i < 20; i++) r.add({ text: `item ${i}`, dedupeKey: `k${i}` });
    await indexer(r, a.embedder, { batchSize: 20 }).run();
    // The first call fails; the router then knows the provider is offline, so the probe never leaves.
    expect(a.local.embedRequests).toHaveLength(1);
    expect(r.vectors.failures(a.embedder.modelKey)).toEqual([]);
  });

  it("one poisoned item does not block its batch-mates", async () => {
    const r = rig();
    const a = aiRig();
    a.local.vectorFor = (text) => {
      if (text.includes("poison")) throw new ModelError("protocol", "local", "bad item");
      return toyVector(text);
    };
    r.add({ text: "good one", dedupeKey: "a" });
    r.add({ text: "poison pill", dedupeKey: "b" });
    r.add({ text: "good two", dedupeKey: "c" });
    const report = await indexer(r, a.embedder, { batchSize: 10 }).run();
    expect(report).toMatchObject({ embedded: 2, failed: 1 });
    expect(r.vectors.failures(a.embedder.modelKey)).toHaveLength(1);
  });

  it("parks a poisoned item after maxAttempts and retryParked() lets it try again", async () => {
    const r = rig();
    const a = aiRig({}, r.clock);
    let poisoned = true;
    a.local.vectorFor = (text) => {
      if (poisoned && text.includes("poison")) throw new ModelError("protocol", "local", "bad");
      return toyVector(text);
    };
    r.add({ text: "poison pill", dedupeKey: "p" });
    r.add({ text: "healthy sibling", dedupeKey: "h" });
    const ix = indexer(r, a.embedder, { maxAttempts: 2, backoffMs: () => 0 });
    await ix.run();
    await ix.run();
    expect(r.vectors.failures(a.embedder.modelKey)[0]).toMatchObject({ attempts: 2 });
    const calls = a.local.embedRequests.length;
    expect(await ix.run()).toMatchObject({ embedded: 0, remaining: 1 }); // parked: not tried again
    expect(a.local.embedRequests.length).toBe(calls);
    expect(ix.retryParked()).toBe(1);
    poisoned = false;
    expect(await ix.run()).toMatchObject({ embedded: 1, remaining: 0 });
  });

  it("an item forgotten while its embedding was in flight gets no vector", async () => {
    const r = rig();
    const id = r.add({ text: "alpha", dedupeKey: "a" });
    const inner = new ToyEmbedder();
    const racing = {
      modelKey: inner.modelKey,
      embedDocuments: async (texts: readonly string[], privacy: "internal") => {
        r.store.forget(id);
        return inner.embedDocuments(texts, privacy);
      },
      embedQuery: (t: string) => inner.embedQuery(t),
    };
    const report = await indexer(r, racing).run();
    expect(report.embedded).toBe(0);
    expect(r.vectors.count(inner.modelKey)).toBe(0);
    expect(r.vectors.orphanCount()).toBe(0);
  });

  it("a router answer from a different model is discarded, not stored under the wrong key", async () => {
    const r = rig();
    const a = aiRig();
    a.local.model = "something-else";
    r.add({ text: "alpha", dedupeKey: "a" });
    const report = await indexer(r, a.embedder).run();
    expect(report.embedded).toBe(0);
    expect(r.vectors.count(a.embedder.modelKey)).toBe(0);
    expect(r.vectors.models()).toEqual([]);
    await expect(a.embedder.embedQuery("x", "internal")).rejects.toBeInstanceOf(
      EmbedderMismatchError,
    );
  });

  it("a model whose width changes is a failure, not a corrupt index", async () => {
    const r = rig();
    const a = aiRig();
    r.add({ text: "alpha", dedupeKey: "a" });
    const ix = indexer(r, a.embedder);
    await ix.run();
    a.local.vectorFor = () => [1, 2, 3];
    r.add({ text: "beta", dedupeKey: "b" });
    const report = await ix.run();
    expect(report).toMatchObject({ embedded: 0, failed: 1 });
    expect(r.vectors.count(a.embedder.modelKey)).toBe(1);
  });

  it("a bug (non-model error) is not swallowed", async () => {
    const r = rig();
    r.add({ text: "alpha", dedupeKey: "a" });
    const broken = {
      modelKey: "x/y",
      embedDocuments: () => Promise.reject(new TypeError("bug")),
      embedQuery: () => Promise.resolve([1]),
    };
    await expect(indexer(r, broken).run()).rejects.toThrow("bug");
  });
});

describe("privacy and AI-off behaviour", () => {
  it("with AI off nothing is embedded, no provider is called, and the reason is reported", async () => {
    const r = rig();
    const a = aiRig({ enabled: false });
    r.add({ text: "alpha", dedupeKey: "a" });
    const report = await indexer(r, a.embedder).run();
    expect(report).toMatchObject({ embedded: 0, failed: 0, remaining: 1 });
    expect(report.degraded[0]).toMatchObject({ reason: "ai_disabled" });
    expect(report.degraded[0]!.detail).toMatch(/AI is turned off/);
    expect(a.local.embedRequests).toEqual([]);
    expect(a.cloud.embedRequests).toEqual([]);
    expect(r.vectors.failures(a.embedder.modelKey)).toEqual([]);
  });

  it("sensitive text is never embedded by a cloud provider, even with every opt-in on", async () => {
    const r = rig();
    const a = aiRig({ cloudOptIn: { public: true, internal: true, sensitive: true } }); // sensitive opt-in on, grant on, audit sink present
    a.local.capabilities = { generate: true, stream: false, embed: false }; // only the cloud could embed
    const cloudEmbedder = new AiEmbedder(a.ai, { provider: "cloud", model: "toy-embed" });
    r.add({
      text: "meeting decided the secret plan",
      dedupeKey: "m",
      contentType: "meeting_summary",
      source: "kage",
    });
    const report = await indexer(r, cloudEmbedder).run();
    expect(report.degraded[0]?.reason).toBe("no_provider");
    expect(a.cloud.embedRequests).toEqual([]);
    expect(r.vectors.count(cloudEmbedder.modelKey)).toBe(0);
  });

  it("internal text may go to a cloud embedder only when the grant and opt-in allow", async () => {
    const r = rig();
    const a = aiRig();
    const cloudEmbedder = new AiEmbedder(a.ai, { provider: "cloud", model: "toy-embed" });
    r.add({ text: "plain commit", dedupeKey: "a" });
    a.local.capabilities = { generate: true, stream: false, embed: false };
    const report = await indexer(r, cloudEmbedder).run();
    expect(a.cloud.embedRequests).toEqual([]);
    expect(report.embedded).toBe(0);
    expect(report.degraded[0]?.reason).toBe("no_provider");
  });

  it("internal text does reach a cloud embedder once the grant and the opt-in allow it", async () => {
    const r = rig();
    const a = aiRig({ cloudOptIn: { public: true, internal: true, sensitive: true } });
    a.local.capabilities = { generate: true, stream: false, embed: false };
    const cloudEmbedder = new AiEmbedder(a.ai, { provider: "cloud", model: "toy-embed" });
    r.add({ text: "plain commit", dedupeKey: "a" });
    expect(await indexer(r, cloudEmbedder).run()).toMatchObject({ embedded: 1 });
    a.grant.value = false;
    r.add({ text: "another commit", dedupeKey: "b" });
    const denied = await indexer(r, cloudEmbedder).run();
    expect(denied.embedded).toBe(0);
    expect(a.cloud.embedRequests).toHaveLength(1);
  });

  it("a prefix is part of the vector space identity", () => {
    const a = aiRig();
    const plain = new AiEmbedder(a.ai, { provider: "local", model: "m" });
    const prefixed = new AiEmbedder(a.ai, {
      provider: "local",
      model: "m",
      documentPrefix: "search_document: ",
      queryPrefix: "search_query: ",
    });
    expect(plain.modelKey).not.toBe(prefixed.modelKey);
  });

  it("applies document and query prefixes to what the provider receives", async () => {
    const a = aiRig();
    const e = new AiEmbedder(a.ai, {
      provider: "local",
      model: "toy-embed",
      documentPrefix: "D: ",
      queryPrefix: "Q: ",
    });
    await e.embedDocuments(["one"], "internal");
    await e.embedQuery("two", "internal");
    expect(a.local.embedRequests.map((q) => q.input)).toEqual([["D: one"], ["Q: two"]]);
    expect(a.local.embedRequests.map((q) => q.purpose)).toEqual([
      "embed memory for retrieval",
      "embed a retrieval query",
    ]);
  });
});

describe("router fallback", () => {
  it("a failing local provider falls back to an allowed cloud one, whose answer is discarded as a different model", async () => {
    // Documents a limitation: AiService has no 'this provider only' option, so with a cloud opt-in
    // the text of an internal item is sent to the cloud after the local provider fails, and the
    // answer is then refused because it is from another model. Sensitive text never takes this path.
    const r = rig();
    const a = aiRig({ cloudOptIn: { public: true, internal: true, sensitive: true } }, r.clock);
    a.local.failEmbed = new ModelError("protocol", "local", "bad");
    r.add({ text: "plain commit", dedupeKey: "a" });
    r.add({
      text: "meeting plan",
      dedupeKey: "m",
      contentType: "meeting_summary",
      source: "kage",
      sourceRef: "m1",
      scope: "meeting:m1",
    });
    const report = await indexer(r, a.embedder).run();
    expect(report.embedded).toBe(0);
    expect(a.cloud.embedRequests.map((q) => q.privacy)).not.toContain("sensitive");
    expect(r.vectors.count(a.embedder.modelKey)).toBe(0);
  });
});
