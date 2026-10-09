// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 29 through the public HTTP API: browse, search, forget, delete, settings, ask, and the
// ingestion that fills memory (git events, meeting summaries, listed docs).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CapabilityModule } from "@phoenix/capability-manager";
import { MemorySecretStore } from "@phoenix/persistence";
import { ownerViewer, type RawCapture, type Viewer } from "@phoenix/ai-memory";
import { createEvent } from "@phoenix/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeNetwork, type FakeNetwork } from "./ai-network";
import { startCore, type TestCore } from "./helpers";

type Core = TestCore;

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

interface Item {
  id: string;
  text: string;
  domain: string;
  layer: string;
  sensitivity: string;
  kind: string;
  redacted: boolean;
  retention_days: number | null;
  expires_at: string | null;
}

/** Stands in for Kage: same id (the only meeting source memory reads), no network, no secrets. */
const fakeKage: CapabilityModule = {
  manifest: {
    id: "kage",
    name: "Kage (test double)",
    version: "0.0.1",
    description: "Test double for the meeting capability",
    license: "GPL-3.0-or-later",
    events: ["kage.*"],
    permissions: [],
    data_categories: [],
    commands: [],
  },
};

async function boot(runtime: { network?: FakeNetwork; viewer?: Viewer } = {}) {
  const network = runtime.network ?? fakeNetwork();
  const secrets = new MemorySecretStore();
  const core = await startCore(
    {},
    {
      capabilities: [fakeKage],
      secrets,
      runtime: {
        fetch: network.fetch,
        ...(runtime.viewer ? { memoryViewer: runtime.viewer } : {}),
      },
    },
  );
  cleanups.push(() => core.runtime.stop());
  return { ...core, network, secrets };
}

/** A temp dir holding markdown files; removed after the test. */
function docs(files: Record<string, string>): { dir: string; path: (name: string) => string } {
  const dir = mkdtempSync(join(tmpdir(), "phoenix-docs-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return { dir, path: (name) => join(dir, name) };
}

async function commit(core: Core, sha: string, message: string, repo = "phoenix") {
  core.runtime.bus.publish(
    createEvent({
      event_type: "git.commit.created",
      source: "git",
      severity: "info",
      payload: { repository: repo, sha, branch: "main", message },
    }),
  );
  await core.runtime.bus.drain();
}

const list = async (core: Core, query = "") =>
  (await core.api("GET", `/api/memory${query}`)).json as {
    items: Item[];
    total: number;
    counts: Record<string, number>;
    ai: { enabled: boolean };
  };

describe("memory is filled by Core", () => {
  it("remembers git commits from live events, and stops when capture_git is off", async () => {
    const core = await boot();
    await commit(core, "aaaaaaa1111111", "fix the database lock on startup");
    let page = await list(core);
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      domain: "git",
      layer: "episodic",
      sensitivity: "internal",
    });
    expect(page.items[0]!.text).toContain("fix the database lock on startup");

    const off = await core.api("POST", "/api/memory/settings", { capture_git: false });
    expect(off.json.capture_git).toBe(false);
    await commit(core, "bbbbbbb2222222", "second commit while capture is off");
    expect((await list(core)).total).toBe(1);

    await core.api("POST", "/api/memory/settings", { capture_git: true });
    await commit(core, "ccccccc3333333", "third commit after turning capture on");
    expect((await list(core)).total).toBe(2);
  });

  it("ignores a commit event that does not come from the git capability", async () => {
    const core = await boot();
    core.runtime.bus.publish(
      createEvent({
        event_type: "git.commit.created",
        source: "terminal",
        severity: "info",
        payload: { repository: "x", sha: "ddddddd4444444", message: "forged" },
      }),
    );
    await core.runtime.bus.drain();
    expect((await list(core)).total).toBe(0);
  });

  it("ingests the markdown files the user lists, on settings change, and drops them when unlisted", async () => {
    const core = await boot();
    const d = docs({ "plan.md": "# Plan\n\nWe decided to use SQLite for the memory index.\n" });
    const set = await core.api("POST", "/api/memory/settings", { doc_paths: [d.path("plan.md")] });
    expect(set.status).toBe(200);
    expect(set.json.doc_paths).toEqual([d.path("plan.md")]);
    const page = await list(core, "?domain=project");
    expect(page.total).toBeGreaterThan(0);
    expect(page.items[0]).toMatchObject({ layer: "project", domain: "project" });
    expect(core.runtime.memory.store.indexedCount()).toBe(core.runtime.memory.store.count());

    // Re-saving the same paths stores nothing new (content hash).
    const before = (await list(core)).total;
    await core.api("POST", "/api/memory/settings", { doc_paths: [d.path("plan.md")] });
    expect((await list(core)).total).toBe(before);

    await core.api("POST", "/api/memory/settings", { doc_paths: [] });
    expect((await list(core)).total).toBe(0);
    expect(core.runtime.memory.store.indexedCount()).toBe(0);
  });

  it("only remembers meeting summaries after the user allows it, and takes them out when they turn it off", async () => {
    const core = await boot();
    await core.runtime.capabilities.enable("kage");
    const meeting = core.runtime.meetings.upsert({
      capabilityId: "kage",
      externalId: "7",
      status: "ready",
      title: "Planning",
      startedAt: "2026-10-01T10:00:00Z",
    })!;
    const summary = {
      text: "We agreed to ship the memory browser.",
      decisions: ["Use FTS5 for search"],
      action_items: [],
    };
    core.runtime.meetings.setSummary(meeting.id, summary);
    expect((await list(core)).total).toBe(0); // default: not allowed

    const on = await core.api("POST", "/api/memory/settings", { allow_sensitive_meetings: true });
    expect(on.json.allow_sensitive_meetings).toBe(true);
    const page = await list(core, "?domain=meeting");
    expect(page.total).toBe(2);
    expect(page.items.every((i) => i.sensitivity === "sensitive")).toBe(true);

    // A summary that changes later is picked up by the sync hook without another settings call.
    core.runtime.meetings.setSummary(meeting.id, {
      ...summary,
      decisions: ["Use FTS5", "Ship it"],
    });
    await vi.waitFor(async () => expect((await list(core, "?domain=meeting")).total).toBe(3));

    await core.api("POST", "/api/memory/settings", { allow_sensitive_meetings: false });
    expect((await list(core, "?domain=meeting")).total).toBe(0);
    expect(core.runtime.memory.store.indexedCount()).toBe(0);
  });
});

const T = "2026-10-07T10:00:00.000Z";
const gitCapture = (
  over: Partial<RawCapture> & { dedupeKey: string; text: string },
): RawCapture => ({
  source: "git",
  sourceRef: "phoenix",
  scope: "repo:phoenix",
  contentType: "commit",
  observedAt: T,
  provenance: {},
  ...over,
});
/** A sensitive memory (meeting summaries are sensitive). Needs allow_sensitive_meetings. */
const meetingCapture = (id: string, text: string): RawCapture =>
  gitCapture({
    dedupeKey: `meeting:${id}:summary`,
    sourceRef: id,
    scope: `meeting:${id}`,
    contentType: "meeting_summary",
    text,
  });

async function seed(core: Core, captures: RawCapture[]) {
  await core.api("POST", "/api/memory/settings", { allow_sensitive_meetings: true });
  for (const c of captures) {
    const outcome = core.runtime.memory.pipeline.capture(c);
    expect(outcome.status, c.dedupeKey).toBe("stored");
  }
}

describe("memory routes: contract", () => {
  it("lists a page with totals, per-domain counts and the AI flag, newest first", async () => {
    const core = await boot();
    await seed(core, [
      gitCapture({
        dedupeKey: "g1",
        text: "alpha database change",
        observedAt: "2026-10-01T00:00:00.000Z",
      }),
      gitCapture({
        dedupeKey: "g2",
        text: "beta database change",
        observedAt: "2026-10-03T00:00:00.000Z",
      }),
      meetingCapture("m1", "gamma meeting about the database"),
    ]);
    const all = await list(core);
    expect(all.total).toBe(3);
    expect(all.counts).toEqual({ git: 2, meeting: 1 });
    expect(all.ai).toEqual({ enabled: false });
    expect(all.items.map((i) => i.text)).toEqual([
      expect.stringContaining("gamma"),
      expect.stringContaining("beta"),
      expect.stringContaining("alpha"),
    ]);
    const git = await list(core, "?domain=git&limit=1&offset=1");
    expect(git.total).toBe(2);
    expect(git.counts).toEqual({ git: 2, meeting: 1 }); // chips keep their counts while filtered
    expect(git.items).toHaveLength(1);
    expect(git.items[0]!.text).toContain("alpha");
    expect((await list(core, "?layer=episodic")).total).toBe(3);
    expect((await list(core, "?include=live")).total).toBe(3);
  });

  it("returns only the documented fields: no provenance, no dedupe key", async () => {
    const core = await boot();
    await seed(core, [
      gitCapture({
        dedupeKey: "SECRET-DEDUPE-KEY",
        text: "x memory",
        provenance: { note: "PROVENANCE-INTERNAL" },
      }),
    ]);
    const raw = JSON.stringify((await core.api("GET", "/api/memory")).json);
    expect(raw).not.toContain("SECRET-DEDUPE-KEY");
    expect(raw).not.toContain("PROVENANCE-INTERNAL");
    const [item] = (await list(core)).items;
    expect(Object.keys(item!).sort()).toEqual(
      [
        "confidence",
        "domain",
        "expires_at",
        "id",
        "kind",
        "layer",
        "observed_at",
        "redacted",
        "retention_days",
        "scope",
        "sensitivity",
        "source",
        "source_ref",
        "text",
      ].sort(),
    );
  });

  it("caps the text of a listed memory at 2000 characters", async () => {
    const core = await boot();
    await seed(core, [gitCapture({ dedupeKey: "long", text: `long ${"word ".repeat(700)}` })]);
    const [item] = (await list(core)).items;
    expect(item!.text.length).toBe(2000);
    expect(item!.text.endsWith("…")).toBe(true);
  });

  it("marks a memory whose secret-shaped text was removed", async () => {
    const core = await boot();
    await seed(core, [
      gitCapture({
        dedupeKey: "tok",
        text: "rotated token ghp_abcdefghijklmnopqrstuvwxyz0123456789 today",
      }),
    ]);
    const [item] = (await list(core)).items;
    expect(item!.redacted).toBe(true);
    expect(item!.text).not.toContain("ghp_");
  });

  it("searches with scores, filters by domain and never treats the query as FTS syntax", async () => {
    const core = await boot();
    await seed(core, [
      gitCapture({ dedupeKey: "g1", text: "database lock held during migration" }),
      gitCapture({ dedupeKey: "g2", text: "unrelated styling change" }),
      meetingCapture("m1", "database retention discussed"),
    ]);
    const hits = (await core.api("GET", "/api/memory/search?q=database")).json.items as (Item & {
      score: number;
    })[];
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => typeof h.score === "number")).toBe(true);
    const meetingOnly = (await core.api("GET", "/api/memory/search?q=database&domain=meeting")).json
      .items;
    expect(meetingOnly).toHaveLength(1);
    for (const q of ['"', "NEAR(", "a OR", "*", "database AND", "x:y", "' OR 1=1 --"]) {
      const r = await core.api("GET", `/api/memory/search?q=${encodeURIComponent(q)}`);
      expect(r.status, q).toBe(200);
    }
  });

  it("forget purges the memory from list and search, audits counts only, and a repeat is 404", async () => {
    const core = await boot();
    await seed(core, [gitCapture({ dedupeKey: "g1", text: "remove me ZEBRA-TEXT please" })]);
    const [item] = (await list(core)).items;
    expect((await core.api("POST", `/api/memory/${item!.id}/forget`, {})).json).toEqual({
      forgotten: true,
    });
    expect((await list(core)).total).toBe(0);
    expect((await core.api("GET", "/api/memory/search?q=zebra")).json.items).toEqual([]);
    expect(core.runtime.memory.store.indexedCount()).toBe(0);
    expect((await core.api("POST", `/api/memory/${item!.id}/forget`, {})).status).toBe(404);
    const audit = (await core.api("GET", "/api/audit")).json.entries as {
      action: string;
      details: unknown;
    }[];
    const entry = audit.find((e) => e.action === "memory.forgotten");
    expect(entry?.details).toEqual({ count: 1 });
    expect(JSON.stringify(audit)).not.toContain("ZEBRA-TEXT");
  });

  it("delete needs confirm:true, can be limited to a domain, removes index rows and audits counts", async () => {
    const core = await boot();
    await seed(core, [
      gitCapture({ dedupeKey: "g1", text: "one git thing" }),
      gitCapture({ dedupeKey: "g2", text: "two git thing" }),
      meetingCapture("m1", "a meeting thing QUOKKA-TEXT"),
    ]);
    for (const body of [
      {},
      { confirm: false },
      { confirm: "true" },
      { confirm: 1 },
      { domain: "git" },
    ]) {
      const r = await core.api("POST", "/api/memory/delete", body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect((await list(core)).total).toBe(3);
    expect(
      (await core.api("POST", "/api/memory/delete", { domain: "meeting", confirm: true })).json,
    ).toEqual({ deleted: 1 });
    expect((await list(core)).counts).toEqual({ git: 2 });
    expect((await core.api("GET", "/api/memory/search?q=quokka")).json.items).toEqual([]);
    expect((await core.api("POST", "/api/memory/delete", { confirm: true })).json).toEqual({
      deleted: 2,
    });
    expect((await list(core)).total).toBe(0);
    expect(core.runtime.memory.store.indexedCount()).toBe(0);
    const audit = (await core.api("GET", "/api/audit")).json.entries as {
      action: string;
      details: Record<string, unknown>;
    }[];
    const deleted = audit.filter((e) => e.action === "memory.deleted").map((e) => e.details);
    expect(deleted).toEqual([
      { count: 2, all: true },
      { count: 1, domain: "meeting" },
    ]);
    expect(JSON.stringify(audit)).not.toContain("QUOKKA-TEXT");
  });

  it("privacy delete-all for memory goes through the same index-clearing delete", async () => {
    const core = await boot();
    await seed(core, [gitCapture({ dedupeKey: "g1", text: "private thing OKAPI-TEXT" })]);
    const inv = (await core.api("GET", "/api/privacy")).json;
    expect(inv.data.find((d: { id: string }) => d.id === "memory")).toMatchObject({ count: 1 });
    const r = await core.api("POST", "/api/privacy/delete", { data: "memory", confirm: true });
    expect(r.json).toEqual({ deleted: 1 });
    expect(core.runtime.memory.store.indexedCount()).toBe(0);
    expect((await core.api("GET", "/api/memory/search?q=okapi")).json.items).toEqual([]);
    expect((await core.api("POST", "/api/privacy/retention", { memory: 7 })).status).toBe(400);
  });

  it("a deleted memory is not captured again when its source repeats it", async () => {
    const core = await boot();
    await commit(core, "eeeeeee5555555", "remember this once");
    const [item] = (await list(core)).items;
    await core.api("POST", `/api/memory/${item!.id}/forget`, {});
    await commit(core, "eeeeeee5555555", "remember this once");
    expect((await list(core)).total).toBe(0);
    // The same holds for docs: forget a chunk, re-ingest the unchanged file.
    const d = docs({ "a.md": "# A\n\nA fact about LEMUR in the docs.\n" });
    await core.api("POST", "/api/memory/settings", { doc_paths: [d.path("a.md")] });
    const doc = (await list(core, "?domain=project")).items[0]!;
    await core.api("POST", `/api/memory/${doc.id}/forget`, {});
    await core.runtime.memory.syncDocs();
    writeFileSync(d.path("a.md"), "# A\n\nA fact about LEMUR in the docs.\n\n");
    await core.runtime.memory.syncDocs();
    expect((await list(core, "?domain=project")).total).toBe(0);
  });

  it("expires memories by layer retention, applied to what is stored and enforced by expire()", async () => {
    const core = await boot();
    await commit(core, "fffffff6666666", "an episodic memory");
    expect((await list(core)).items[0]!.retention_days).toBeNull();
    const set = await core.api("POST", "/api/memory/settings", {
      retention_days: { episodic: 30 },
    });
    expect(set.json.retention_days).toEqual({
      working: 1,
      episodic: 30,
      project: null,
      preference: null,
    });
    const [item] = (await list(core)).items;
    expect(item!.retention_days).toBe(30);
    expect(Date.parse(item!.expires_at!) - Date.now()).toBeGreaterThan(29 * 86_400_000);
    // New captures use the new retention too.
    await commit(core, "ggggggg7777777", "a second episodic memory");
    expect((await list(core)).items.every((i) => i.retention_days === 30)).toBe(true);
    // Past its expiry an item disappears from the list and the sweep tombstones it.
    core.runtime.memory.store.setLayerRetention("episodic", 1);
    core.runtime.settings.set("memory.settings", {
      ...core.runtime.memory.settings(),
      retention_days: { working: 1, episodic: 1, project: null, preference: null },
    });
    const later = new Date(Date.now() + 2 * 86_400_000);
    vi.useFakeTimers({ toFake: ["Date"], now: later });
    try {
      expect((await list(core)).total).toBe(0);
      expect(core.runtime.memory.expire()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
    expect(core.runtime.memory.store.indexedCount()).toBe(0);
    const audit = (await core.api("GET", "/api/audit")).json.entries as {
      action: string;
      details: unknown;
    }[];
    expect(audit.find((e) => e.action === "memory.expired")?.details).toEqual({ count: 2 });
  });

  it("round-trips settings and validates them", async () => {
    const core = await boot();
    const initial = (await core.api("GET", "/api/memory/settings")).json;
    expect(initial).toEqual({
      retention_days: { working: 1, episodic: null, project: null, preference: null },
      allow_sensitive_meetings: false,
      doc_paths: [],
      capture_git: true,
    });
    const d = docs({ "n.md": "# N\n\nnotes\n" });
    const next = await core.api("POST", "/api/memory/settings", {
      retention_days: { project: 90, working: null },
      allow_sensitive_meetings: true,
      doc_paths: [d.path("n.md")],
      capture_git: false,
    });
    expect(next.json).toEqual({
      retention_days: { working: null, episodic: null, project: 90, preference: null },
      allow_sensitive_meetings: true,
      doc_paths: [d.path("n.md")],
      capture_git: false,
    });
    expect((await core.api("GET", "/api/memory/settings")).json).toEqual(next.json);
    const audit = (await core.api("GET", "/api/audit")).json.entries as { action: string }[];
    expect(audit.some((e) => e.action === "memory.settings.changed")).toBe(true);
  });
});

describe("memory routes: hostile input", () => {
  const bad: [string, string, unknown][] = [
    ["GET", "/api/memory?limit=0", undefined],
    ["GET", "/api/memory?limit=-1", undefined],
    ["GET", "/api/memory?limit=201", undefined],
    ["GET", "/api/memory?limit=99999999999999999999", undefined],
    ["GET", "/api/memory?limit=1.5", undefined],
    ["GET", "/api/memory?limit=abc", undefined],
    ["GET", "/api/memory?offset=-5", undefined],
    ["GET", "/api/memory?offset=1e9", undefined],
    ["GET", "/api/memory?offset=1000001", undefined],
    ["GET", "/api/memory?domain=__proto__", undefined],
    ["GET", "/api/memory?domain=constructor", undefined],
    ["GET", "/api/memory?domain=git%27%20OR%201=1", undefined],
    [`GET`, `/api/memory?domain=${"x".repeat(5000)}`, undefined],
    ["GET", "/api/memory?layer=nope", undefined],
    ["GET", "/api/memory?include=all", undefined],
    ["GET", "/api/memory/search", undefined],
    ["GET", "/api/memory/search?q=", undefined],
    ["GET", "/api/memory/search?q=%20%20", undefined],
    ["GET", `/api/memory/search?q=${"a".repeat(501)}`, undefined],
    ["GET", "/api/memory/search?q=x&limit=0", undefined],
    ["GET", "/api/memory/search?q=x&limit=101", undefined],
    ["GET", "/api/memory/search?q=x&domain=__proto__", undefined],
    ["POST", "/api/memory/ask", {}],
    ["POST", "/api/memory/ask", { question: 5 }],
    ["POST", "/api/memory/ask", { question: ["a"] }],
    ["POST", "/api/memory/ask", { question: { toString: "x" } }],
    ["POST", "/api/memory/ask", { question: "" }],
    ["POST", "/api/memory/ask", { question: "q".repeat(501) }],
    ["POST", "/api/memory/ask", []],
    ["POST", "/api/memory/ask", "[]"],
    ["POST", "/api/memory/delete", { confirm: true, domain: 5 }],
    ["POST", "/api/memory/delete", { confirm: true, domain: "__proto__" }],
    ["POST", "/api/memory/delete", { confirm: true, domain: "nope" }],
    ["POST", "/api/memory/delete", []],
    ["POST", "/api/memory/settings", []],
    ["POST", "/api/memory/settings", { __proto__: 1, evil: true }],
    ["POST", "/api/memory/settings", JSON.parse('{"__proto__":{"capture_git":false}}')],
    ["POST", "/api/memory/settings", { unknown: 1 }],
    ["POST", "/api/memory/settings", { capture_git: "yes" }],
    ["POST", "/api/memory/settings", { allow_sensitive_meetings: 1 }],
    ["POST", "/api/memory/settings", { retention_days: 5 }],
    ["POST", "/api/memory/settings", { retention_days: { episodic: 0 } }],
    ["POST", "/api/memory/settings", { retention_days: { episodic: 3651 } }],
    ["POST", "/api/memory/settings", { retention_days: { episodic: 1.5 } }],
    ["POST", "/api/memory/settings", { retention_days: { episodic: "7" } }],
    ["POST", "/api/memory/settings", { retention_days: { __proto__: 1, nope: 7 } }],
    ["POST", "/api/memory/settings", { retention_days: { toString: 7 } }],
    ["POST", "/api/memory/settings", { doc_paths: "/a.md" }],
    ["POST", "/api/memory/settings", { doc_paths: [5] }],
    ["POST", "/api/memory/settings", { doc_paths: ["relative.md"] }],
    ["POST", "/api/memory/settings", { doc_paths: ["/etc/passwd"] }],
    ["POST", "/api/memory/settings", { doc_paths: ["/tmp/a.md\u0000.txt"] }],
    ["POST", "/api/memory/settings", { doc_paths: [`/${"d/".repeat(600)}a.md`] }],
    [
      "POST",
      "/api/memory/settings",
      { doc_paths: Array.from({ length: 51 }, (_, i) => `/tmp/${i}.md`) },
    ],
    ["POST", "/api/ai/settings", []],
    ["POST", "/api/ai/settings", { enabled: "yes" }],
    ["POST", "/api/ai/settings", { preferred: 5 }],
    ["POST", "/api/ai/settings", { preferred: "not-a-provider" }],
    ["POST", "/api/ai/settings", { preferred: "__proto__" }],
    ["POST", "/api/ai/settings", { cloud_opt_in: "all" }],
    ["POST", "/api/ai/settings", { cloud_opt_in: { secret: true } }],
    ["POST", "/api/ai/settings", { cloud_opt_in: { sensitive: "true" } }],
    ["POST", "/api/ai/settings", { cloud_opt_in: { __proto__: 1, sensitive: 1 } }],
    ["POST", "/api/ai/settings", { unknown: true }],
    ["POST", "/api/ai/external-processing", {}],
    ["POST", "/api/ai/external-processing", { granted: "true" }],
    ["POST", "/api/ai/external-processing", { granted: 1 }],
    ["POST", "/api/ai/secret", {}],
    ["POST", "/api/ai/secret", { value: 5 }],
    ["POST", "/api/ai/secret", { value: "" }],
    ["POST", "/api/ai/secret", { value: "a".repeat(8193) }],
    ["POST", "/api/ai/secret", { value: "two\nlines" }],
  ];

  it.each(bad)("%s %s %j is a 400 and changes nothing", async (method, path, body) => {
    const core = await boot();
    await seed(core, [gitCapture({ dedupeKey: "keep", text: "keep me" })]);
    const before = JSON.stringify([
      (await core.api("GET", "/api/memory/settings")).json,
      (await core.api("GET", "/api/ai/status")).json,
      (await list(core)).total,
    ]);
    const r = await core.api(method, path, body);
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("INVALID_REQUEST");
    const after = JSON.stringify([
      (await core.api("GET", "/api/memory/settings")).json,
      (await core.api("GET", "/api/ai/status")).json,
      (await list(core)).total,
    ]);
    expect(after).toBe(before);
    expect(({} as Record<string, unknown>).capture_git).toBeUndefined(); // prototype untouched
  });

  it("unknown ids are 404 (also for a path that looks like another route)", async () => {
    const core = await boot();
    for (const id of ["nope", "__proto__", "mem_x%2Fy", "a".repeat(300)]) {
      expect((await core.api("POST", `/api/memory/${id}/forget`, {})).status, id).toBe(404);
    }
    expect((await core.api("POST", "/api/memory/%zz/forget", {})).status).toBe(400);
  });

  it("every route needs the session token", async () => {
    const core = await boot();
    const routes: [string, string, unknown?][] = [
      ["GET", "/api/memory"],
      ["GET", "/api/memory/search?q=x"],
      ["GET", "/api/memory/settings"],
      ["POST", "/api/memory/settings", {}],
      ["POST", "/api/memory/ask", { question: "x" }],
      ["POST", "/api/memory/delete", { confirm: true }],
      ["POST", "/api/memory/mem_1/forget", {}],
      ["GET", "/api/ai/status"],
      ["POST", "/api/ai/settings", {}],
      ["POST", "/api/ai/external-processing", { granted: true }],
      ["POST", "/api/ai/secret", { value: "x" }],
      ["DELETE", "/api/ai/secret"],
    ];
    for (const [method, path, body] of routes) {
      for (const authorization of ["", "Bearer wrong"]) {
        const r = await core.api(method, path, body, { authorization });
        expect(r.status, `${method} ${path}`).toBe(401);
      }
    }
    expect((await core.api("GET", "/api/ai/status")).json.enabled).toBe(false);
  });
});

describe("AI settings", () => {
  it("is OFF in a fresh runtime and makes no network call at all", async () => {
    const core = await boot();
    const status = (await core.api("GET", "/api/ai/status")).json;
    expect(status).toMatchObject({
      enabled: false,
      preferred: null,
      cloud_opt_in: { public: false, internal: false, sensitive: false },
      external_processing_granted: false,
    });
    expect(status.providers.map((p: { id: string }) => p.id)).toEqual(["anthropic", "ollama"]);
    await list(core);
    await core.api("GET", "/api/privacy");
    await core.api("POST", "/api/memory/ask", { question: "what happened" });
    expect(core.network.requests).toEqual([]);
  });

  it("builds a runtime with the REAL global fetch and still does not touch the network when idle", async () => {
    const real = vi.spyOn(globalThis, "fetch");
    const core = await startCore({}, { secrets: new MemorySecretStore() });
    cleanups.push(() => core.runtime.stop());
    await core.api("GET", "/api/ai/status");
    await core.api("POST", "/api/memory/ask", { question: "anything" });
    const outbound = real.mock.calls
      .map(([input]) => String(input))
      .filter((u) => !u.startsWith(core.base));
    real.mockRestore();
    expect(outbound).toEqual([]);
  });

  it("settings round-trip and are read on every call: turning AI off applies to the very next ask", async () => {
    const core = await boot();
    await seed(core, [gitCapture({ dedupeKey: "g1", text: "database lock decision" })]);
    const on = await core.api("POST", "/api/ai/settings", { enabled: true });
    expect(on.json.enabled).toBe(true);
    expect(on.json.providers.find((p: { id: string }) => p.id === "ollama")).toMatchObject({
      locality: "local",
      available: true,
      reason: null,
    });
    expect((await list(core)).ai).toEqual({ enabled: true });
    const a = await core.api("POST", "/api/memory/ask", { question: "database lock decision" });
    expect(a.json).toMatchObject({ ai_used: true, interpretation: "local interpretation" });
    expect(a.json.processed_by).toBe("Ollama (this device) · llama3.2 · on this device");
    const chats = core.network.chats().length;
    await core.api("POST", "/api/ai/settings", { enabled: false });
    const b = await core.api("POST", "/api/memory/ask", { question: "database lock decision" });
    expect(b.json).toMatchObject({ ai_used: false, interpretation: null, processed_by: null });
    expect(b.json.facts).toHaveLength(1);
    expect(core.network.chats()).toHaveLength(chats);
    expect(b.json.note).toMatch(/AI is turned off/);
  });

  it("ask returns facts with sources and never lists a model's text as a fact", async () => {
    const core = await boot();
    await seed(core, [
      gitCapture({ dedupeKey: "g1", text: "database lock decision", sourceRef: "phoenix" }),
    ]);
    await core.api("POST", "/api/ai/settings", { enabled: true });
    const a = (await core.api("POST", "/api/memory/ask", { question: "database lock decision" }))
      .json;
    expect(a.facts).toEqual([
      expect.objectContaining({
        text: expect.stringContaining("database lock decision"),
        domain: "git",
        source: "git",
        source_ref: "phoenix",
        sensitivity: "internal",
      }),
    ]);
    expect(a.facts.map((f: { text: string }) => f.text)).not.toContain(a.interpretation);
    expect(Object.keys(a.facts[0]).sort()).toEqual(
      ["domain", "id", "observed_at", "sensitivity", "source", "source_ref", "text"].sort(),
    );
  });

  it("the preferred provider is validated against the registered ones", async () => {
    const core = await boot();
    expect(
      (await core.api("POST", "/api/ai/settings", { preferred: "ollama" })).json.preferred,
    ).toBe("ollama");
    expect(
      (await core.api("POST", "/api/ai/settings", { preferred: null })).json.preferred,
    ).toBeNull();
  });

  it("the external-processing grant is a real permission grant, audited like other grants", async () => {
    const core = await boot();
    expect(
      (await core.api("POST", "/api/ai/external-processing", { granted: true })).json
        .external_processing_granted,
    ).toBe(true);
    const grants = (await core.api("GET", "/api/permissions")).json.grants as {
      capabilityId: string;
      permission: string;
    }[];
    expect(grants).toContainEqual(
      expect.objectContaining({ capabilityId: "core:ai", permission: "AI_external_processing" }),
    );
    expect(core.runtime.ai.externalProcessingGranted()).toBe(true);
    expect(
      (await core.api("POST", "/api/ai/external-processing", { granted: false })).json
        .external_processing_granted,
    ).toBe(false);
    expect(core.runtime.ai.externalProcessingGranted()).toBe(false);
    const audit = (await core.api("GET", "/api/audit")).json.entries as {
      action: string;
      capabilityId?: string;
    }[];
    expect(
      audit
        .filter((e) => e.capabilityId === "core:ai")
        .map((e) => e.action)
        .sort(),
    ).toEqual(["permission.granted", "permission.revoked"]);
  });

  it("the API key is write-only: stored in the secret store, never returned, logged or audited", async () => {
    const core = await boot();
    const KEY = "sk-ant-api03-WRITEONLYCANARY0123456789abcdefWRITEONLYCANARY";
    expect((await core.api("POST", "/api/ai/secret", { value: KEY })).json).toEqual({
      anthropic_key_set: true,
    });
    expect(await core.secrets.get("phoenix.ai.anthropic_api_key")).toBe(KEY);
    for (const path of [
      "/api/ai/status",
      "/api/audit",
      "/api/privacy",
      "/api/capabilities",
      "/api/diagnostics",
      "/api/permissions",
    ]) {
      expect(JSON.stringify((await core.api("GET", path)).json), path).not.toContain(
        "WRITEONLYCANARY",
      );
    }
    expect((await core.api("DELETE", "/api/ai/secret")).json).toEqual({ anthropic_key_set: false });
    expect(await core.secrets.get("phoenix.ai.anthropic_api_key")).toBeUndefined();
    const audit = (await core.api("GET", "/api/audit")).json.entries as { action: string }[];
    expect(audit.map((e) => e.action)).toEqual(
      expect.arrayContaining(["ai.secret.set", "ai.secret.deleted"]),
    );
  });

  it("the privacy sentence tracks the AI settings", async () => {
    const core = await boot();
    const sentence = async () => (await core.api("GET", "/api/privacy")).json.external_ai as string;
    expect(await sentence()).toBe("AI is off; nothing is sent to AI providers.");
    await core.api("POST", "/api/ai/settings", { enabled: true });
    expect(await sentence()).toMatch(/processed on this device by Ollama/);
    expect(await sentence()).not.toMatch(/Anthropic/);
    await core.api("POST", "/api/ai/settings", { cloud_opt_in: { public: true, internal: true } });
    expect(await sentence()).not.toMatch(/Anthropic/); // opt-in without the grant sends nothing
    await core.api("POST", "/api/ai/external-processing", { granted: true });
    expect(await sentence()).toMatch(
      /public, internal memories may be sent to Anthropic \(cloud\)/,
    );
    expect(await sentence()).not.toMatch(/Sensitive/);
    await core.api("POST", "/api/ai/settings", { cloud_opt_in: { sensitive: true } });
    expect(await sentence()).toMatch(
      /public, internal, sensitive memories may be sent to Anthropic/,
    );
    expect(await sentence()).toMatch(/Sensitive memories .* only when you ask Fawkes a question/);
    await core.api("POST", "/api/ai/settings", { enabled: false });
    expect(await sentence()).toBe("AI is off; nothing is sent to AI providers.");
  });
});

describe("sensitive memory and external AI (Phase 29 rule)", () => {
  const SENSITIVE_TEXT = "Board decided on the acquisition LEAKCANARY-SENSITIVE";
  const question = "what did the board decide about the acquisition";

  /** Cloud allowed for public/internal, Ollama down so only the cloud could answer. */
  async function cloudOnly(optIn: Record<string, boolean>, granted = true) {
    const core = await boot({ network: fakeNetwork({ ollama: "down" }) });
    await seed(core, [meetingCapture("m1", SENSITIVE_TEXT)]);
    await core.secrets.set("phoenix.ai.anthropic_api_key", "sk-ant-test-key-0123456789");
    await core.api("POST", "/api/ai/settings", {
      enabled: true,
      cloud_opt_in: { public: true, internal: true, ...optIn },
    });
    if (granted) await core.api("POST", "/api/ai/external-processing", { granted: true });
    return core;
  }

  it("with default settings a sensitive item cannot reach a cloud provider: zero cloud requests", async () => {
    const core = await boot({ network: fakeNetwork({ ollama: "down" }) });
    await seed(core, [meetingCapture("m1", SENSITIVE_TEXT)]);
    await core.secrets.set("phoenix.ai.anthropic_api_key", "sk-ant-test-key-0123456789");
    const a = (await core.api("POST", "/api/memory/ask", { question })).json;
    expect(a.facts[0].sensitivity).toBe("sensitive");
    expect(a.ai_used).toBe(false);
    expect(core.network.requests).toEqual([]);
  });

  it("AI on + grant + public/internal opt-in is still not enough for sensitive data", async () => {
    const core = await cloudOnly({});
    const a = (await core.api("POST", "/api/memory/ask", { question })).json;
    expect(a.ai_used).toBe(false);
    expect(a.facts).toHaveLength(1);
    expect(core.network.cloud().filter((r) => r.url.includes("/v1/messages"))).toEqual([]);
    expect(core.network.requests.some((r) => r.body.includes("LEAKCANARY"))).toBe(false);
    const audit = (await core.api("GET", "/api/audit")).json.entries as { action: string }[];
    expect(audit.some((e) => e.action === "ai.cloud_send")).toBe(false);
  });

  it("the sensitive opt-in without the AI_external_processing grant sends nothing", async () => {
    const core = await cloudOnly({ sensitive: true }, false);
    const a = (await core.api("POST", "/api/memory/ask", { question })).json;
    expect(a.ai_used).toBe(false);
    expect(core.network.cloud().filter((r) => r.url.includes("/v1/messages"))).toEqual([]);
  });

  it("with grant AND the explicit sensitive opt-in it goes to the cloud, labelled, and the send is audited without its text", async () => {
    const core = await cloudOnly({ sensitive: true });
    const a = (await core.api("POST", "/api/memory/ask", { question })).json;
    expect(a).toMatchObject({ ai_used: true, interpretation: "cloud interpretation" });
    expect(a.processed_by).toMatch(/Anthropic.*cloud$/);
    expect(core.network.cloud().filter((r) => r.url.includes("/v1/messages"))).toHaveLength(1);
    const audit = (await core.api("GET", "/api/audit")).json.entries as {
      action: string;
      details: Record<string, unknown>;
    }[];
    const sends = audit.filter((e) => e.action === "ai.cloud_send");
    expect(sends).toHaveLength(1);
    expect(sends[0]!.details).toMatchObject({
      provider: "anthropic",
      kind: "generate",
      purpose: "answer a question from memory",
      attempt: 1,
      privacy: "sensitive",
    });
    expect(typeof sends[0]!.details.characters).toBe("number");
    expect(JSON.stringify(audit)).not.toContain("LEAKCANARY");
    // Opting in and out is its own audit entry.
    expect(audit.some((e) => e.action === "ai.sensitive_opt_in.changed")).toBe(true);
  });

  it("revoking the grant or the opt-in stops the next send immediately", async () => {
    const core = await cloudOnly({ sensitive: true });
    expect((await core.api("POST", "/api/memory/ask", { question })).json.ai_used).toBe(true);
    await core.api("POST", "/api/ai/external-processing", { granted: false });
    expect((await core.api("POST", "/api/memory/ask", { question })).json.ai_used).toBe(false);
    await core.api("POST", "/api/ai/external-processing", { granted: true });
    expect((await core.api("POST", "/api/memory/ask", { question })).json.ai_used).toBe(true);
    await core.api("POST", "/api/ai/settings", { cloud_opt_in: { sensitive: false } });
    expect((await core.api("POST", "/api/memory/ask", { question })).json.ai_used).toBe(false);
    expect(core.network.cloud().filter((r) => r.url.includes("/v1/messages"))).toHaveLength(2);
  });

  it("with every opt-in and Ollama up, sensitive data still goes to the on-device model unless the user prefers the cloud", async () => {
    const core = await boot();
    await seed(core, [meetingCapture("m1", SENSITIVE_TEXT)]);
    await core.secrets.set("phoenix.ai.anthropic_api_key", "sk-ant-test-key-0123456789");
    await core.api("POST", "/api/ai/settings", {
      enabled: true,
      cloud_opt_in: { public: true, internal: true, sensitive: true },
    });
    await core.api("POST", "/api/ai/external-processing", { granted: true });
    const local = (await core.api("POST", "/api/memory/ask", { question })).json;
    expect(local.processed_by).toMatch(/on this device$/);
    expect(core.network.cloud().filter((r) => r.url.includes("/v1/messages"))).toEqual([]);
    // The user's explicit choice of the cloud provider is honoured, and every such send is audited.
    await core.api("POST", "/api/ai/settings", { preferred: "anthropic" });
    const cloud = (await core.api("POST", "/api/memory/ask", { question })).json;
    expect(cloud.processed_by).toMatch(/cloud$/);
    const audit = (await core.api("GET", "/api/audit")).json.entries as { action: string }[];
    expect(audit.filter((e) => e.action === "ai.cloud_send")).toHaveLength(1);
  });
});

describe("permission-scoped retrieval", () => {
  /** May see git commits of repo:phoenix at internal level, nothing else. */
  const narrow: Viewer = {
    id: "limited",
    grants: [{ scope: "repo:phoenix", maxSensitivity: "internal", domains: ["git"] }],
  };

  async function seeded(viewer: Viewer) {
    const core = await boot({ viewer });
    await seed(core, [
      gitCapture({ dedupeKey: "v1", text: "visible budget change", scope: "repo:phoenix" }),
      gitCapture({
        dedupeKey: "h1",
        text: "hidden budget change in another repo",
        scope: "repo:secret",
        sourceRef: "secret",
      }),
      meetingCapture("m1", "hidden budget meeting HIDDEN-MEETING"),
      gitCapture({
        dedupeKey: "d1",
        text: "hidden doc about the budget",
        scope: "path:/tmp/x.md",
        contentType: "doc",
        sourceRef: "/tmp/x.md",
      }),
    ]);
    return core;
  }

  it("browse: a viewer without access never sees an item, and total/counts do not reveal it", async () => {
    const core = await seeded(narrow);
    const page = await list(core);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.text).toContain("visible budget change");
    expect(page.total).toBe(1);
    expect(page.counts).toEqual({ git: 1 });
    expect((await list(core, "?domain=meeting")).total).toBe(0);
    expect((await list(core, "?domain=meeting")).counts).toEqual({ git: 1 });
    expect((await list(core, "?layer=project")).total).toBe(0);
    // The owner can see everything in the same store.
    expect(core.runtime.memory.store.count()).toBe(4);
    const inv = (await core.api("GET", "/api/privacy")).json;
    expect(inv.data.find((d: { id: string }) => d.id === "memory").count).toBe(1);
  });

  it("search: hidden items are not returned and do not use result slots", async () => {
    const core = await seeded(narrow);
    const hits = (await core.api("GET", "/api/memory/search?q=budget&limit=1")).json
      .items as Item[];
    expect(hits).toHaveLength(1);
    expect(hits[0]!.text).toContain("visible");
    expect(
      JSON.stringify((await core.api("GET", "/api/memory/search?q=HIDDEN-MEETING")).json),
    ).not.toContain("HIDDEN");
    expect(
      (await core.api("GET", "/api/memory/search?q=budget&domain=meeting")).json.items,
    ).toEqual([]);
  });

  it("ask: hidden items are neither answered from nor counted as omitted", async () => {
    const core = await seeded(narrow);
    await core.api("POST", "/api/ai/settings", { enabled: true });
    const a = (
      await core.api("POST", "/api/memory/ask", { question: "what changed about the budget" })
    ).json;
    expect(a.facts).toHaveLength(1);
    expect(a.facts[0].text).toContain("visible budget change");
    const sent = core.network
      .chats()
      .map((r) => r.body)
      .join("\n");
    expect(sent).not.toContain("HIDDEN");
    expect(sent).not.toContain("another repo");
    expect(JSON.stringify(a)).not.toMatch(/omitted|hidden/i);
  });

  it("forget and delete cannot touch what the viewer cannot see; the item is indistinguishable from a missing one", async () => {
    const core = await seeded(narrow);
    const hidden = core.runtime.memory.store
      .list({ limit: 10 })
      .find((i) => i.scope === "repo:secret")!;
    const r = await core.api("POST", `/api/memory/${hidden.id}/forget`, {});
    const missing = await core.api("POST", "/api/memory/mem_doesnotexist/forget", {});
    expect([r.status, r.json]).toEqual([missing.status, missing.json]);
    expect(core.runtime.memory.store.get(hidden.id)!.deletedAt).toBeNull();
    expect((await core.api("POST", "/api/memory/delete", { confirm: true })).json).toEqual({
      deleted: 1,
    });
    expect(core.runtime.memory.store.count()).toBe(3);
    expect(core.runtime.memory.store.get(hidden.id)!.text).toContain("hidden budget change");
  });

  it("a viewer capped at internal never sees sensitive items; the owner viewer does", async () => {
    const internalOnly: Viewer = { id: "i", grants: [{ scope: "*", maxSensitivity: "internal" }] };
    const core = await boot({ viewer: internalOnly });
    await seed(core, [
      meetingCapture("m1", "sensitive only"),
      gitCapture({ dedupeKey: "g", text: "internal one" }),
    ]);
    expect((await list(core)).total).toBe(1);
    const owner = await boot({ viewer: ownerViewer("owner") });
    await seed(owner, [
      meetingCapture("m1", "sensitive only"),
      gitCapture({ dedupeKey: "g", text: "internal one" }),
    ]);
    expect((await list(owner)).total).toBe(2);
  });

  it("deleting a memory removes it from list, search and ask", async () => {
    const core = await boot();
    await seed(core, [gitCapture({ dedupeKey: "g1", text: "narwhal migration plan" })]);
    await core.api("POST", "/api/ai/settings", { enabled: true });
    const [item] = (await list(core)).items;
    expect(
      (await core.api("POST", "/api/memory/ask", { question: "narwhal migration plan" })).json
        .facts,
    ).toHaveLength(1);
    await core.api("POST", `/api/memory/${item!.id}/forget`, {});
    expect((await list(core)).total).toBe(0);
    expect((await core.api("GET", "/api/memory/search?q=narwhal")).json.items).toEqual([]);
    const after = (
      await core.api("POST", "/api/memory/ask", { question: "narwhal migration plan" })
    ).json;
    expect(after.facts).toEqual([]);
    expect(after.interpretation).toBeNull();
  });
});
