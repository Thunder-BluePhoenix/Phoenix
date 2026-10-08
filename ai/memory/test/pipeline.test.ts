// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  MemoryPipeline,
  buildMatchQuery,
  canView,
  captureStage,
  createDefaultPolicy,
  scopeMatches,
  type Viewer,
} from "../src";
import { capture, rig } from "./helpers";

const AWS = "AKIAABCDEFGHIJKLMNOP";
const GH = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

describe("classify", () => {
  it("assigns layer, domain and sensitivity by rule", () => {
    const r = rig();
    const commit = r.pipeline.capture(capture());
    const doc = r.pipeline.capture(capture({ dedupeKey: "d", contentType: "doc" }));
    const decision = r.pipeline.capture(
      capture({ dedupeKey: "m", contentType: "meeting_decision" }),
    );
    const transcript = r.pipeline.capture(capture({ dedupeKey: "t", contentType: "transcript" }));
    expect(commit).toMatchObject({
      item: { layer: "episodic", domain: "git", sensitivity: "internal" },
    });
    expect(doc).toMatchObject({
      item: { layer: "project", domain: "project", sensitivity: "internal" },
    });
    expect(decision).toMatchObject({ item: { domain: "meeting", sensitivity: "sensitive" } });
    expect(transcript).toMatchObject({ item: { domain: "meeting", sensitivity: "sensitive" } });
  });

  it("a source cannot lower the rule below public->internal for text that held a secret", () => {
    const r = rig();
    const out = r.pipeline.capture(capture({ sensitivity: "public", text: `deploy with ${AWS}` }));
    expect(out).toMatchObject({ status: "stored", item: { sensitivity: "internal" } });
  });

  it("redacts secret-shaped text before storage, in text and provenance, and counts it", () => {
    const r = rig();
    const out = r.pipeline.capture(
      capture({
        text: `Commit: use token ${GH} and key ${AWS} for deploy`,
        provenance: { note: `saw ${GH}` },
      }),
    );
    expect(out.status).toBe("stored");
    const stored = r.store.list({ limit: 5 })[0]!;
    expect(stored.text).toBe("Commit: use token [REDACTED] and key [REDACTED] for deploy");
    expect(JSON.stringify(stored.provenance)).not.toContain(GH);
    expect(stored.provenance).toMatchObject({ redacted: true });
    expect(r.store.search({ match: buildMatchQuery(GH.toLowerCase())!, limit: 5 })).toEqual([]);
    expect(r.pipeline.stats().redacted).toBe(1);
  });

  it("rejects private key material instead of storing a redacted stub", () => {
    const r = rig();
    const out = r.pipeline.capture(
      capture({
        text: "-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----",
      }),
    );
    expect(out).toEqual({ status: "rejected", reason: "contains_private_key" });
    expect(r.store.count()).toBe(0);
    expect(r.pipeline.stats().rejected).toEqual({ contains_private_key: 1 });
  });

  it("cuts oversized text and says so in provenance", () => {
    const r = rig();
    r.pipeline.capture(capture({ text: "word ".repeat(2000) }));
    const stored = r.store.list({ limit: 1 })[0]!;
    expect(stored.text.length).toBeLessThanOrEqual(4000);
    expect(stored.provenance).toMatchObject({ truncated: true });
  });
});

describe("capture validation", () => {
  it("rejects empty text, bad dates, missing keys and model-less interpretations", () => {
    const base = capture();
    expect(captureStage({ ...base, text: "  " })).toEqual({ ok: false, reason: "empty_text" });
    expect(captureStage({ ...base, observedAt: "not a date" })).toEqual({
      ok: false,
      reason: "invalid_observed_at",
    });
    expect(captureStage({ ...base, dedupeKey: "" })).toEqual({
      ok: false,
      reason: "missing_dedupe_key",
    });
    expect(captureStage({ ...base, kind: "interpretation" })).toEqual({
      ok: false,
      reason: "interpretation_without_model",
    });
    expect(
      captureStage({
        ...base,
        kind: "interpretation",
        provenance: { model: "llama3.2", provider: "ollama" },
      }),
    ).toMatchObject({ ok: true, value: { kind: "interpretation" } });
  });

  it("stores interpretations with lower default confidence and keeps kind", () => {
    const r = rig();
    r.pipeline.capture(
      capture({
        kind: "interpretation",
        provenance: { model: "llama3.2", provider: "ollama" },
      }),
    );
    expect(r.store.list({ limit: 1 })[0]).toMatchObject({
      kind: "interpretation",
      confidence: 0.5,
    });
  });
});

describe("permission-check", () => {
  it("refuses sensitive data unless explicitly allowed, with a reason, and counts it", () => {
    const r = rig(createDefaultPolicy({ isSourceEnabled: () => true }));
    const out = r.pipeline.capture(
      capture({ source: "kage", dedupeKey: "k", contentType: "meeting_summary" }),
    );
    expect(out).toEqual({
      status: "refused",
      reason: 'sensitive meeting data from "kage" needs explicit permission',
    });
    r.pipeline.capture(
      capture({ source: "kage", dedupeKey: "k2", contentType: "meeting_summary" }),
    );
    expect(r.store.count()).toBe(0);
    expect(r.store.indexedCount()).toBe(0);
    expect(r.pipeline.stats().refused).toEqual({
      'sensitive meeting data from "kage" needs explicit permission': 2,
    });
  });

  it("allows internal data from enabled sources and refuses disabled sources", () => {
    const r = rig(createDefaultPolicy({ isSourceEnabled: (s) => s === "git" }));
    expect(r.pipeline.capture(capture()).status).toBe("stored");
    expect(r.pipeline.capture(capture({ source: "docker", dedupeKey: "x" }))).toEqual({
      status: "refused",
      reason: 'source "docker" is not enabled',
    });
  });

  it("the sensitive allow is per source and domain", () => {
    const r = rig(
      createDefaultPolicy({
        isSourceEnabled: () => true,
        allowSensitive: (source, domain) => source === "kage" && domain === "meeting",
      }),
    );
    expect(
      r.pipeline.capture(capture({ source: "kage", contentType: "meeting_summary" })).status,
    ).toBe("stored");
    expect(
      r.pipeline.capture(
        capture({ source: "other", dedupeKey: "o", contentType: "meeting_summary" }),
      ).status,
    ).toBe("refused");
  });

  it("a policy that throws is not swallowed into a store", () => {
    const store = rig().store;
    const pipeline = new MemoryPipeline({
      store,
      owner: "me",
      policy: {
        canStore: () => {
          throw new Error("policy broken");
        },
      },
    });
    expect(() => pipeline.capture(capture())).toThrow("policy broken");
    expect(store.count()).toBe(0);
  });
});

describe("idempotence", () => {
  it("ingesting the same source twice stores once", () => {
    const r = rig();
    expect(r.pipeline.capture(capture()).status).toBe("stored");
    expect(r.pipeline.capture(capture()).status).toBe("duplicate");
    expect(r.store.count()).toBe(1);
    expect(r.pipeline.stats()).toMatchObject({ stored: 1, duplicate: 1 });
  });
});

describe("viewer grants", () => {
  const item = { scope: "repo:phoenix", domain: "git" as const, sensitivity: "internal" as const };
  const viewer = (grants: Viewer["grants"]): Viewer => ({ id: "v", grants });

  it("matches scopes exactly or by prefix wildcard", () => {
    expect(scopeMatches("repo:phoenix", "repo:phoenix")).toBe(true);
    expect(scopeMatches("repo:phoenix", "repo:phoenix2")).toBe(false);
    expect(scopeMatches("repo:*", "repo:phoenix")).toBe(true);
    expect(scopeMatches("path:/a/b/*", "path:/a/bc/x")).toBe(false);
    expect(scopeMatches("*", "meeting:kage:1")).toBe(true);
  });

  it("requires scope, sensitivity ceiling and domain to all fit one grant", () => {
    expect(canView(viewer([]), item)).toBe(false);
    expect(canView(viewer([{ scope: "repo:*", maxSensitivity: "internal" }]), item)).toBe(true);
    expect(canView(viewer([{ scope: "repo:*", maxSensitivity: "public" }]), item)).toBe(false);
    expect(
      canView(
        viewer([{ scope: "repo:*", maxSensitivity: "sensitive", domains: ["meeting"] }]),
        item,
      ),
    ).toBe(false);
    // Two partial grants do not add up to a full one.
    expect(
      canView(
        viewer([
          { scope: "repo:*", maxSensitivity: "public" },
          { scope: "global", maxSensitivity: "sensitive" },
        ]),
        item,
      ),
    ).toBe(false);
  });
});
