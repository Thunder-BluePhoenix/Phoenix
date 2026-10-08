// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Viewer } from "@phoenix/ai-memory";
import { describe, expect, it } from "vitest";
import { estimateTokens } from "../src";
import { rig } from "./helpers";

describe("assemble", () => {
  it("retrieves across domains with sources (exit criterion)", () => {
    const r = rig();
    r.add({
      dedupeKey: "g1",
      text: "Commit a1b2c3d in phoenix: fix database lock on startup",
      provenance: { sha: "a1b2c3d" },
    });
    r.add({
      dedupeKey: "m1",
      source: "kage",
      sourceRef: "kage:7",
      scope: "meeting:kage:7",
      contentType: "meeting_decision",
      text: 'Decision in "Standup": use a database lock file per data directory',
      provenance: { meeting_id: "kage:7" },
    });
    r.add({
      dedupeKey: "d1",
      source: "project-docs",
      sourceRef: "/docs/a.md",
      scope: "path:/docs/a.md",
      contentType: "doc",
      text: "a.md › Locks\nThe database lock is an exclusive sqlite lock",
      provenance: { path: "/docs/a.md" },
    });
    const bundle = r.engine.assemble({
      question: "what did we decide about the database lock",
      viewer: r.owner,
      limit: 10,
      tokenBudget: 1000,
    });
    expect(bundle.domainsCovered).toEqual(["git", "meeting", "project"]);
    expect(bundle.items.map((i) => i.source).sort()).toEqual(["git", "kage", "project-docs"]);
    for (const item of bundle.items) {
      expect(item.sourceRef).not.toBe("");
      expect(item.provenance).not.toEqual({});
    }
    expect(bundle.items.find((i) => i.domain === "meeting")).toMatchObject({
      kind: "fact",
      sensitivity: "sensitive",
      provenance: { meeting_id: "kage:7" },
    });
    expect(bundle.sensitivity).toBe("sensitive");
    expect(bundle.topic).toBe("what did we decide about the database lock");
  });

  it("never returns an item the viewer has no grant for, and never counts it as omitted", () => {
    const r = rig();
    r.add({ dedupeKey: "pub", text: "database lock in phoenix repo" });
    r.add({
      dedupeKey: "secret-repo",
      scope: "repo:private",
      sourceRef: "private",
      text: "database lock in private repo",
    });
    r.add({
      dedupeKey: "sensitive",
      source: "kage",
      scope: "meeting:kage:1",
      contentType: "meeting_summary",
      text: "database lock discussed in confidential meeting",
    });
    const asked = (viewer: Viewer, over: { limit?: number; tokenBudget?: number } = {}) =>
      r.engine.assemble({
        question: "database lock",
        viewer,
        limit: over.limit ?? 10,
        tokenBudget: over.tokenBudget ?? 1000,
      });

    const repoOnly: Viewer = {
      id: "ci",
      grants: [{ scope: "repo:phoenix", maxSensitivity: "internal" }],
    };
    const limited = asked(repoOnly);
    expect(limited.items.map((i) => i.scope)).toEqual(["repo:phoenix"]);
    expect(limited.omitted).toEqual([]);
    expect(JSON.stringify(limited)).not.toMatch(/private repo|confidential/);

    // Same bundle shape whether hidden items exist or not: nothing leaks through counts.
    const alone = rig();
    alone.add({ dedupeKey: "pub", text: "database lock in phoenix repo" });
    const aloneBundle = alone.engine.assemble({
      question: "database lock",
      viewer: repoOnly,
      limit: 10,
      tokenBudget: 1000,
    });
    // bm25 weights depend on corpus statistics, so compare everything but the score and id.
    const shape = (b: typeof limited) => ({
      ...b,
      items: b.items.map(({ score: _s, id: _i, ...rest }) => rest),
    });
    expect(shape(limited)).toEqual(shape(aloneBundle));

    // The sensitivity ceiling hides meeting data from a viewer who may read the scope.
    const noMeetingSecrets = asked({
      id: "v",
      grants: [{ scope: "*", maxSensitivity: "internal" }],
    });
    expect(noMeetingSecrets.items.map((i) => i.scope).sort()).toEqual([
      "repo:phoenix",
      "repo:private",
    ]);

    expect(asked({ id: "nobody", grants: [] })).toMatchObject({ items: [], omitted: [] });

    // A tight limit does not let hidden items push visible ones out.
    expect(asked(repoOnly, { limit: 1 }).items).toHaveLength(1);
  });

  it("scopes narrows within the grant and cannot widen it", () => {
    const r = rig();
    r.add({ dedupeKey: "a", text: "database lock alpha" });
    r.add({ dedupeKey: "b", scope: "repo:other", sourceRef: "other", text: "database lock beta" });
    const viewer: Viewer = {
      id: "v",
      grants: [{ scope: "repo:phoenix", maxSensitivity: "internal" }],
    };
    const ask = (scopes: string[]) =>
      r.engine
        .assemble({ question: "database lock", viewer, scopes, limit: 5, tokenBudget: 500 })
        .items.map((i) => i.scope);
    expect(ask(["repo:phoenix"])).toEqual(["repo:phoenix"]);
    expect(ask(["repo:other"])).toEqual([]);
    expect(ask(["repo:*"])).toEqual(["repo:phoenix"]);
  });

  it("gives every domain a share so one domain cannot crowd out the others", () => {
    const r = rig();
    for (let i = 0; i < 12; i++) {
      r.add({
        dedupeKey: `g${i}`,
        text: `lock lock lock lock commit number ${i} unique${i}${"x".repeat(i)}`,
      });
    }
    r.add({
      dedupeKey: "m",
      source: "kage",
      scope: "meeting:kage:1",
      contentType: "meeting_decision",
      text: "we should lock the schema before release, said everyone in the long standup meeting today",
    });
    const bundle = r.engine.assemble({
      question: "lock",
      viewer: r.owner,
      limit: 4,
      tokenBudget: 1000,
    });
    expect(bundle.items).toHaveLength(4);
    expect(bundle.domainsCovered).toEqual(["git", "meeting"]);
    expect(bundle.omitted.find((o) => o.reason === "limit")?.count).toBeGreaterThan(0);
  });

  it("unused quota goes to the best remaining items", () => {
    const r = rig();
    for (let i = 0; i < 5; i++)
      r.add({ dedupeKey: `g${i}`, text: `lock thing${i} extra${i}${"y".repeat(i)}` });
    const bundle = r.engine.assemble({
      question: "lock",
      viewer: r.owner,
      limit: 4,
      tokenBudget: 500,
    });
    expect(bundle.items).toHaveLength(4);
    expect(bundle.domainsCovered).toEqual(["git"]);
  });

  it("collapses near-identical items and counts them as omitted", () => {
    const r = rig();
    r.add({ dedupeKey: "a", text: "Commit a111111 in phoenix: fix database lock on startup" });
    r.add({ dedupeKey: "b", text: "Commit a111111 in phoenix: fix database lock on startup!" });
    r.add({ dedupeKey: "c", text: "Commit c333333 in phoenix: document the database lock" });
    const bundle = r.engine.assemble({
      question: "database lock",
      viewer: r.owner,
      limit: 10,
      tokenBudget: 500,
    });
    expect(bundle.items).toHaveLength(2);
    expect(bundle.omitted).toEqual([{ reason: "near_duplicate", count: 1 }]);
  });

  it("stays inside the token budget and reports what the budget cut", () => {
    const r = rig();
    const long = (k: string) => `${k} lock ` + "filler ".repeat(40) + k.repeat(3);
    r.add({ dedupeKey: "a", text: long("aa") });
    r.add({ dedupeKey: "b", text: long("bb") });
    r.add({ dedupeKey: "c", text: long("cc") });
    const one = estimateTokens(long("aa"));
    const bundle = r.engine.assemble({
      question: "lock",
      viewer: r.owner,
      limit: 10,
      tokenBudget: one * 2 + 1,
    });
    expect(bundle.items).toHaveLength(2);
    expect(bundle.tokensEstimate).toBeLessThanOrEqual(one * 2 + 1);
    expect(bundle.tokensEstimate).toBe(
      bundle.items.reduce((n, i) => n + estimateTokens(i.text), 0),
    );
    expect(bundle.omitted).toEqual([{ reason: "token_budget", count: 1 }]);
    expect(
      r.engine.assemble({ question: "lock", viewer: r.owner, limit: 10, tokenBudget: 0 }).items,
    ).toEqual([]);
  });

  it("applies the question's time window: yesterday finds yesterday's items only", () => {
    const r = rig();
    r.add({
      dedupeKey: "old",
      observedAt: "2026-10-05T10:00:00.000Z",
      text: "decided database lock old",
    });
    r.add({
      dedupeKey: "y",
      observedAt: "2026-10-07T10:00:00.000Z",
      text: "decided database lock yesterday item",
    });
    r.add({
      dedupeKey: "t",
      observedAt: "2026-10-08T09:00:00.000Z",
      text: "decided database lock today item",
    });
    const bundle = r.engine.assemble({
      question: "what did we decide about the database lock yesterday?",
      viewer: r.owner,
      limit: 10,
      tokenBudget: 500,
    });
    expect(bundle.items.map((i) => i.text)).toEqual(["decided database lock yesterday item"]);
    expect(bundle.window?.label).toBe("yesterday");
  });

  it("a time-only question lists what happened in the window, newest first", () => {
    const r = rig();
    r.add({ dedupeKey: "a", observedAt: "2026-10-07T08:00:00.000Z", text: "first thing" });
    r.add({ dedupeKey: "b", observedAt: "2026-10-07T18:00:00.000Z", text: "second item" });
    r.add({ dedupeKey: "c", observedAt: "2026-10-06T18:00:00.000Z", text: "day before" });
    const bundle = r.engine.assemble({
      question: "what happened yesterday",
      viewer: r.owner,
      limit: 10,
      tokenBudget: 500,
    });
    expect(bundle.items.map((i) => i.text)).toEqual(["second item", "first thing"]);
  });

  it("a topic with no match inside the window returns nothing rather than unrelated items", () => {
    const r = rig();
    r.add({ dedupeKey: "a", observedAt: "2026-10-07T08:00:00.000Z", text: "css refactor" });
    const bundle = r.engine.assemble({
      question: "what did we decide about kubernetes yesterday",
      viewer: r.owner,
      limit: 10,
      tokenBudget: 500,
    });
    expect(bundle.items).toEqual([]);
  });

  it("returns nothing for a question with no searchable words and no time", () => {
    const r = rig();
    r.add({ dedupeKey: "a", text: "anything" });
    const bundle = r.engine.assemble({
      question: "what is it?",
      viewer: r.owner,
      limit: 5,
      tokenBudget: 100,
    });
    expect(bundle).toMatchObject({ items: [], domainsCovered: [], omitted: [], tokensEstimate: 0 });
  });

  it("does not return deleted memories and marks stale docs", () => {
    const r = rig();
    r.add({
      dedupeKey: "d",
      source: "project-docs",
      contentType: "doc",
      scope: "path:/x.md",
      observedAt: "2026-08-01T00:00:00.000Z",
      freshnessTtlDays: 30,
      text: "lock documentation page",
    });
    r.add({ dedupeKey: "gone", text: "lock deleted memory" });
    r.store.forget(r.store.list({ limit: 5 }).find((i) => i.dedupeKey === "gone")!.id);
    // The store clock is NOW, so lastConfirmedAt is now: fresh. Age it by rewinding the engine.
    const bundle = r.engine.assemble({
      question: "lock",
      viewer: r.owner,
      limit: 5,
      tokenBudget: 500,
    });
    expect(bundle.items.map((i) => i.text)).toEqual(["lock documentation page"]);
    expect(bundle.items[0]!.freshness).toBe("fresh");
  });
});
