// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 37 through the public HTTP API: off by default and then Core is exactly what it was, the
// indexer, hybrid search and ask (a reworded question that keyword search misses), the viewer
// filter, the status route, and deletion removing vectors.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvent } from "@phoenix/protocol";
import { MemorySecretStore } from "@phoenix/persistence";
import type { Viewer } from "@phoenix/ai-memory";
import { afterEach, describe, expect, it, vi } from "vitest";
import { conceptVector, fakeNetwork, type FakeNetwork } from "./ai-network";
import { startCore, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

interface Core extends TestCore {
  network: FakeNetwork;
}

async function boot(network: FakeNetwork = fakeNetwork(), viewer?: Viewer): Promise<Core> {
  const core = await startCore(
    {},
    {
      secrets: new MemorySecretStore(),
      runtime: { fetch: network.fetch, ...(viewer ? { memoryViewer: viewer } : {}) },
    },
  );
  cleanups.push(() => core.runtime.stop());
  return { ...core, network };
}

async function commit(core: Core, sha: string, message: string) {
  core.runtime.bus.publish(
    createEvent({
      event_type: "git.commit.created",
      source: "git",
      severity: "info",
      payload: { repository: "phoenix", sha, branch: "main", message },
    }),
  );
  await core.runtime.bus.drain();
}

const embedRequests = (core: Core) =>
  core.network.requests.filter((r) => r.url.endsWith("/api/embed"));
const status = async (core: Core) => (await core.api("GET", "/api/retrieval/status")).json;

/** AI on, retrieval on, and the indexer run to completion. */
async function turnOn(core: Core) {
  await core.api("POST", "/api/ai/settings", { enabled: true });
  await core.api("POST", "/api/retrieval/settings", { enabled: true });
  await core.runtime.retrieval.settled();
  await core.runtime.retrieval.index();
}

const SHAS = ["a".repeat(40), "b".repeat(40), "c".repeat(40)];

describe("retrieval is off by default", () => {
  it("embeds nothing, calls no provider, and search and ask behave as before", async () => {
    const core = await boot();
    await commit(core, SHAS[0]!, "make the automobile quick");
    await core.runtime.memory.maintain();
    expect(core.network.requests).toEqual([]);
    expect((await core.api("GET", "/api/retrieval/settings")).json).toEqual({
      enabled: false,
      provider: "ollama",
      model: "nomic-embed-text",
      k: 20,
      vector_weight: 0.5,
      reranker: "feature",
    });
    expect(await status(core)).toMatchObject({
      enabled: false,
      active: false,
      inactive_reason: "retrieval_disabled",
      embedded: 0,
      total: 1,
    });
    const search = (await core.api("GET", "/api/memory/search?q=automobile")).json;
    expect(search.items).toHaveLength(1);
    expect(search.retrieval).toEqual({ mode: "lexical" });
    expect((await core.api("GET", "/api/memory/search?q=vehicle")).json.items).toEqual([]);
    const ask = (await core.api("POST", "/api/memory/ask", { question: "automobile" })).json;
    expect(ask.retrieval).toEqual({ mode: "lexical" });
    expect(core.network.requests).toEqual([]);
  });

  it("turning retrieval on while AI is off still embeds nothing and says why", async () => {
    const core = await boot();
    await commit(core, SHAS[0]!, "make the automobile quick");
    await core.api("POST", "/api/retrieval/settings", { enabled: true });
    await core.runtime.retrieval.settled();
    await core.runtime.memory.maintain();
    expect(core.network.requests).toEqual([]);
    expect(await status(core)).toMatchObject({
      enabled: true,
      active: false,
      inactive_reason: "ai_disabled",
      embedded: 0,
    });
    const search = (await core.api("GET", "/api/memory/search?q=vehicle")).json;
    expect(search.items).toEqual([]);
    expect(search.retrieval).toEqual({ mode: "lexical", vector_skipped_reason: "ai_disabled" });
  });
});

describe("hybrid retrieval", () => {
  it("embeds new memories, and finds a reworded question that keyword search misses", async () => {
    const core = await boot();
    await commit(core, SHAS[0]!, "make the automobile quick");
    await commit(core, SHAS[1]!, "update the lunch menu");
    const before = (await core.api("GET", "/api/memory/search?q=fast+vehicle")).json;
    expect(before.items).toEqual([]);

    await turnOn(core);
    expect(await status(core)).toMatchObject({
      enabled: true,
      active: true,
      inactive_reason: null,
      embedded: 2,
      total: 2,
      unembedded: 0,
      failures: 0,
      vector_space: "ollama/nomic-embed-text#prefixed",
    });
    expect((await status(core)).last_run).toMatchObject({ failed: 0, remaining: 0 });

    const hybrid = (await core.api("GET", "/api/memory/search?q=fast+vehicle")).json;
    expect(hybrid.retrieval).toEqual({ mode: "hybrid" });
    expect(hybrid.items[0].text).toContain("automobile");
    const ask = (await core.api("POST", "/api/memory/ask", { question: "fast vehicle" })).json;
    expect(ask.retrieval).toEqual({ mode: "hybrid" });
    expect(ask.facts[0].text).toContain("automobile");
    // Exact keywords still win through the keyword half.
    const exact = (await core.api("GET", "/api/memory/search?q=lunch")).json;
    expect(exact.items[0].text).toContain("lunch");
    expect(core.network.cloud()).toEqual([]);
    // The query was embedded as sensitive, so it can only have gone to the local model.
    expect(embedRequests(core).some((r) => r.body.includes("search_query: fast vehicle"))).toBe(
      true,
    );
  });

  it("memories captured later are embedded by the next maintenance run, incrementally", async () => {
    const core = await boot();
    await commit(core, SHAS[0]!, "make the automobile quick");
    await turnOn(core);
    const calls = embedRequests(core).length;
    await core.runtime.memory.maintain();
    expect(embedRequests(core).length).toBe(calls); // nothing new, nothing sent
    await commit(core, SHAS[1]!, "repair the mutex");
    await core.runtime.memory.maintain();
    expect(embedRequests(core).length).toBe(calls + 1);
    expect((await status(core)).embedded).toBe(2);
    expect((await core.api("GET", "/api/memory/search?q=deadlock")).json.items[0].text).toContain(
      "mutex",
    );
  });

  it("falls back to keywords, and says why, when the embedding model stops answering", async () => {
    let broken = false;
    const core = await boot(
      fakeNetwork({
        embed: (text) => {
          if (broken) throw new TypeError("fetch failed");
          return conceptVector(text);
        },
      }),
    );
    await commit(core, SHAS[0]!, "make the automobile quick");
    await turnOn(core);
    broken = true;
    const search = await core.api("GET", "/api/memory/search?q=automobile");
    expect(search.status).toBe(200);
    expect(search.json.items).toHaveLength(1);
    expect(search.json.retrieval.mode).toBe("lexical");
    expect(search.json.retrieval.vector_skipped_reason).toBe("provider_unavailable");
    const ask = await core.api("POST", "/api/memory/ask", { question: "automobile" });
    expect(ask.json.facts).toHaveLength(1);
    expect(ask.json.retrieval.mode).toBe("lexical");
  });

  it("settings are validated, persisted and audited", async () => {
    const core = await boot();
    for (const bad of [
      { enabled: "yes" },
      { provider: "anthropic" },
      { provider: "__proto__" },
      { model: "has space" },
      { model: "x".repeat(101) },
      { k: 0 },
      { k: 1.5 },
      { k: 201 },
      { vector_weight: -1 },
      { vector_weight: 6 },
      { reranker: "model" },
      { nope: true },
    ]) {
      expect(
        (await core.api("POST", "/api/retrieval/settings", bad)).status,
        JSON.stringify(bad),
      ).toBe(400);
    }
    expect((await core.api("POST", "/api/retrieval/settings", [])).status).toBe(400);
    const ok = await core.api("POST", "/api/retrieval/settings", {
      k: 30,
      vector_weight: 1,
      reranker: "none",
    });
    expect(ok.json).toMatchObject({ enabled: false, k: 30, vector_weight: 1, reranker: "none" });
    expect((await core.api("GET", "/api/retrieval/settings")).json.k).toBe(30);
    const audit = (await core.api("GET", "/api/audit?limit=50")).json.entries as {
      action: string;
    }[];
    expect(audit.some((e) => e.action === "retrieval.settings.changed")).toBe(true);
    for (const [method, path] of [
      ["GET", "/api/retrieval/settings"],
      ["POST", "/api/retrieval/settings"],
      ["GET", "/api/retrieval/status"],
    ] as const) {
      const res = await core.api(method, path, method === "POST" ? {} : undefined, {
        authorization: "",
      });
      expect(res.status).toBe(401);
    }
  });

  it("changing the embedding model starts a new vector space and never mixes the old one in", async () => {
    const core = await boot();
    await commit(core, SHAS[0]!, "make the automobile quick");
    await turnOn(core);
    expect((await status(core)).embedded).toBe(1);
    await core.api("POST", "/api/retrieval/settings", { model: "other-embed" });
    await core.runtime.retrieval.settled();
    const after = await status(core);
    expect(after.vector_space).toBe("ollama/other-embed");
    expect(after.other_models).toEqual([{ model: "ollama/nomic-embed-text#prefixed", vectors: 1 }]);
    // Re-embedded in the new space; the old vectors stay apart and are never searched.
    expect(after.embedded).toBe(1);
    expect(core.runtime.retrieval.vectors.models()).toHaveLength(2);
  });
});

describe("deletion removes vectors", () => {
  const vectorCount = (core: Core) =>
    core.runtime.retrieval.vectors.models().reduce((n, m) => n + m.count, 0);

  it("forgetting one memory, deleting all, and expiring remove their vectors", async () => {
    const core = await boot();
    await commit(core, SHAS[0]!, "make the automobile quick");
    await commit(core, SHAS[1]!, "repair the mutex");
    await commit(core, SHAS[2]!, "update the lunch menu");
    await turnOn(core);
    expect(vectorCount(core)).toBe(3);
    const items = (await core.api("GET", "/api/memory")).json.items as {
      id: string;
      text: string;
    }[];
    const mutex = items.find((i) => i.text.includes("mutex"))!;
    await core.api("POST", `/api/memory/${mutex.id}/forget`, {});
    expect(vectorCount(core)).toBe(2);
    const afterForget = (await core.api("GET", "/api/memory/search?q=deadlock")).json.items;
    expect(JSON.stringify(afterForget)).not.toContain("mutex");
    await core.api("POST", "/api/memory/delete", { confirm: true });
    expect(vectorCount(core)).toBe(0);
    expect(await status(core)).toMatchObject({ embedded: 0, total: 0 });
  });

  it("a memory forgotten while its embedding is in flight is not brought back", async () => {
    const core = await boot(fakeNetwork({ embed: () => [1, 0, 0, 0] }));
    await commit(core, SHAS[0]!, "make the automobile quick");
    await core.api("POST", "/api/ai/settings", { enabled: true });
    const id = ((await core.api("GET", "/api/memory")).json.items as { id: string }[])[0]!.id;
    await core.api("POST", `/api/memory/${id}/forget`, {});
    await core.api("POST", "/api/retrieval/settings", { enabled: true });
    await core.runtime.retrieval.settled();
    expect(vectorCount(core)).toBe(0);
  });
});

describe("the viewer filter", () => {
  it("a narrower viewer never gets a memory outside its grants, in hybrid mode either", async () => {
    const guest: Viewer = {
      id: "guest",
      grants: [{ scope: "repo:open", maxSensitivity: "internal" }],
    };
    const core = await boot(fakeNetwork(), guest);
    core.runtime.bus.publish(
      createEvent({
        event_type: "git.commit.created",
        source: "git",
        severity: "info",
        payload: { repository: "open", sha: SHAS[0]!, message: "tune the datastore" },
      }),
    );
    core.runtime.bus.publish(
      createEvent({
        event_type: "git.commit.created",
        source: "git",
        severity: "info",
        payload: {
          repository: "secret",
          sha: SHAS[1]!,
          message: "rotate the datastore passphrase",
        },
      }),
    );
    await core.runtime.bus.drain();
    await turnOn(core);
    const search = (await core.api("GET", "/api/memory/search?q=storage")).json;
    expect(search.retrieval.mode).toBe("hybrid");
    expect(search.items.map((i: { text: string }) => i.text).join("\n")).not.toContain(
      "passphrase",
    );
    const ask = (await core.api("POST", "/api/memory/ask", { question: "storage" })).json;
    expect(JSON.stringify(ask)).not.toContain("passphrase");
    expect(
      core.network.requests
        .filter((r) => r.url.endsWith("/api/chat"))
        .some((r) => r.body.includes("passphrase")),
    ).toBe(false);
  });
});

describe("indexing project docs", () => {
  it("embeds doc chunks after a docs sync", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-docs-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, "plan.md"), "# Plan\n\nThe datastore is SQLite.\n");
    const core = await boot();
    await core.api("POST", "/api/memory/settings", { doc_paths: [join(dir, "plan.md")] });
    await turnOn(core);
    await vi.waitFor(async () => expect((await status(core)).embedded).toBeGreaterThan(0));
    expect((await status(core)).unembedded).toBe(0);
  });
});
