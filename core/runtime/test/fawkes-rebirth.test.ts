// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { validateOutfitPack } from "../../../pet/assets/src/outfits";
import type { OutfitPack } from "../../../pet/assets/src/types";
import {
  createCelebrationGate,
  type BuildOutcome,
  type PullRequestOutcome,
} from "../src/fawkes-rebirth/events";
import {
  installSkin,
  type SkinInstaller,
  type VerifiedSkinEntry,
} from "../src/fawkes-rebirth/skins";

const now = Date.UTC(2026, 9, 22);
const build = (sequence: number, result: BuildOutcome["result"], stream = "ci"): BuildOutcome => ({
  kind: "build",
  stream,
  sequence,
  result,
  at: now,
});
const pull = (
  sequence: number,
  item: string,
  result: PullRequestOutcome["result"],
): PullRequestOutcome => ({
  kind: "pull-request",
  stream: "repo",
  sequence,
  item,
  result,
  at: now,
});

describe("Fawkes celebration event gate", () => {
  it("only emits rebirth for a fresh verified failed-to-passed pipeline transition", () => {
    const gate = createCelebrationGate({ now: () => now });
    expect(gate.accept(build(1, "passed"))).toEqual([]);
    expect(gate.accept(build(2, "failed"))).toEqual([]);
    expect(gate.accept(build(3, "passed", "other"))).toEqual([]);
    expect(gate.accept(build(2, "passed"))).toEqual([]);
    expect(gate.accept(build(3, "passed"))).toEqual([{ kind: "rebirth", stream: "ci" }]);
    expect(gate.accept(build(4, "passed"))).toEqual([]);
    gate.reset();
    expect(gate.accept(build(5, "passed"))).toEqual([]);
  });
  it("does not mistake an unknown result or stale sequence for recovery", () => {
    const gate = createCelebrationGate({ now: () => now });
    gate.accept(build(1, "failed"));
    expect(gate.accept(build(2, "unknown"))).toEqual([]);
    expect(gate.accept(build(3, "passed"))).toEqual([]);
    expect(gate.accept(build(4, "failed"))).toEqual([]);
    expect(gate.accept(build(4, "passed"))).toEqual([]);
    expect(gate.accept({ ...build(5, "passed"), at: now + 120_000 })).toEqual([]);
    expect(gate.accept(build(5, "passed"))).toEqual([{ kind: "rebirth", stream: "ci" }]);
  });
  it("keeps milestones opt-in, once per week and once per three distinct merged PRs", () => {
    const gate = createCelebrationGate({ milestones: true, now: () => now + 14 * 86_400_000 });
    expect(gate.accept(build(1, "passed"))).toEqual([{ kind: "first-green-week", stream: "ci" }]);
    expect(gate.accept(build(2, "passed"))).toEqual([]);
    expect(gate.accept({ ...build(3, "passed"), at: now + 7 * 86_400_000 })).toEqual([
      { kind: "first-green-week", stream: "ci" },
    ]);
    expect(gate.accept(pull(1, "one", "merged"))).toEqual([]);
    expect(gate.accept(pull(2, "one", "merged"))).toEqual([]);
    expect(gate.accept(pull(3, "two", "merged"))).toEqual([]);
    expect(gate.accept(pull(4, "three", "merged"))).toEqual([
      { kind: "pr-streak", stream: "repo" },
    ]);
    expect(gate.accept(pull(5, "four", "closed"))).toEqual([]);
    expect(gate.accept(pull(6, "five", "merged"))).toEqual([]);
  });
});

describe("Fawkes celebration event gate: input boundaries", () => {
  it("ignores malformed streams, sequences and future timestamps", () => {
    const gate = createCelebrationGate({ now: () => now });
    gate.accept(build(1, "failed"));
    for (const bad of [
      build(2, "passed", ""),
      build(2, "passed", "has space"),
      build(2, "passed", "x".repeat(129)),
      build(-1, "passed"),
      build(1.5, "passed"),
      { ...build(2, "passed"), at: Number.NaN },
      { ...build(2, "passed"), at: -1 },
    ]) {
      expect(gate.accept(bad)).toEqual([]);
    }
    expect(gate.accept(build(2, "passed"))).toEqual([{ kind: "rebirth", stream: "ci" }]);
  });
  it("never celebrates milestones unless enabled, but still rebirths", () => {
    const gate = createCelebrationGate({ now: () => now });
    expect(gate.accept(build(1, "passed"))).toEqual([]);
    for (let i = 1; i <= 4; i++) expect(gate.accept(pull(i, `pr${i}`, "merged"))).toEqual([]);
    gate.accept(build(2, "failed"));
    expect(gate.accept(build(3, "passed"))).toEqual([{ kind: "rebirth", stream: "ci" }]);
  });
  it("resets the PR streak on a closed PR and rejects invalid PR ids", () => {
    const gate = createCelebrationGate({ milestones: true, now: () => now });
    gate.accept(pull(1, "a", "merged"));
    gate.accept(pull(2, "b", "merged"));
    gate.accept(pull(3, "c", "closed"));
    expect(gate.accept(pull(4, "d", "merged"))).toEqual([]);
    expect(gate.accept(pull(5, "bad id", "merged"))).toEqual([]);
    expect(gate.accept(pull(6, "e", "merged"))).toEqual([]);
    expect(gate.accept(pull(7, "f", "merged"))).toEqual([{ kind: "pr-streak", stream: "repo" }]);
  });
  it("bounds the tracked pipelines, evicting the oldest", () => {
    const gate = createCelebrationGate({ now: () => now });
    gate.accept(build(1, "failed", "first"));
    for (let i = 0; i < 128; i++) gate.accept(build(1, "passed", `s${i}`));
    expect(gate.accept(build(2, "passed", "first"))).toEqual([]);
  });
});

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const SVG = '<path d="M1 1 L8 8"/>';
const skinJson = (over: Record<string, unknown> = {}) =>
  new TextEncoder().encode(
    JSON.stringify({
      format: "phoenix-outfit",
      version: 1,
      id: "ember-test",
      name: "Ember Test",
      author: "Community",
      license: "CC-BY-4.0",
      layers: [{ slot: "head", svg: SVG }],
      ...over,
    }),
  );

function host(bytes: Uint8Array, entryOver: Partial<VerifiedSkinEntry> = {}) {
  const calls: string[] = [];
  const entry: VerifiedSkinEntry = {
    id: "ember-test",
    version: "1.0.0",
    license: "CC-BY-4.0",
    artifact: { sha256: sha(bytes), size: bytes.byteLength },
    provenance: {
      signature_status: "verified",
      signer_key_id: "key-1",
      index_sha256: "a".repeat(64),
    },
    ...entryOver,
  };
  const installer: SkinInstaller<OutfitPack> = {
    preview: async () => {
      calls.push("preview");
      return entry;
    },
    fetch: async () => {
      calls.push("fetch");
      return bytes;
    },
    validate: (input) => {
      calls.push("validate");
      return validateOutfitPack(input);
    },
    install: async () => {
      calls.push("install");
    },
  };
  return { installer, calls };
}

describe("Fawkes skin pack install", () => {
  it("installs a verified pack whose licence matches the consent", async () => {
    const h = host(skinJson());
    const pack = await installSkin("ember-test", "1.0.0", "CC-BY-4.0", h.installer);
    expect(pack.license).toBe("CC-BY-4.0");
    expect(h.calls).toEqual(["preview", "fetch", "validate", "install"]);
  });
  it.each([
    ["licence differs from consent", {}, "GPL-3.0-or-later"],
    [
      "signature not verified",
      {
        provenance: {
          signature_status: "unverified",
          signer_key_id: "k",
          index_sha256: "a".repeat(64),
        },
      },
      "CC-BY-4.0",
    ],
    [
      "missing signer",
      {
        provenance: {
          signature_status: "verified",
          signer_key_id: "",
          index_sha256: "a".repeat(64),
        },
      },
      "CC-BY-4.0",
    ],
    [
      "bad index digest",
      { provenance: { signature_status: "verified", signer_key_id: "k", index_sha256: "zz" } },
      "CC-BY-4.0",
    ],
    ["wrong version", { version: "2.0.0" }, "CC-BY-4.0"],
    ["oversized artifact", { artifact: { sha256: "b".repeat(64), size: 100_001 } }, "CC-BY-4.0"],
  ] as const)("rejects before fetching when %s", async (_name, over, consent) => {
    const h = host(skinJson(), over as unknown as Partial<VerifiedSkinEntry>);
    await expect(installSkin("ember-test", "1.0.0", consent, h.installer)).rejects.toThrow(
      /provenance or licence/,
    );
    expect(h.calls).toEqual(["preview"]);
  });
  it("rejects a tampered artifact and never installs", async () => {
    const good = skinJson();
    const h = host(good);
    const tampered = skinJson({ name: "Evil" });
    h.installer.fetch = async () => tampered;
    await expect(installSkin("ember-test", "1.0.0", "CC-BY-4.0", h.installer)).rejects.toThrow(
      /verification failed/,
    );
    expect(h.calls).not.toContain("install");
  });
  it("rejects non-JSON bytes, hostile markup and a pack that disagrees with its registry entry", async () => {
    const junk = new Uint8Array([0xff, 0xfe, 0x00]);
    await expect(
      installSkin("ember-test", "1.0.0", "CC-BY-4.0", host(junk).installer),
    ).rejects.toThrow(/UTF-8 JSON/);
    const hostile = skinJson({ layers: [{ slot: "head", svg: "<script>alert(1)</script>" }] });
    const h = host(hostile);
    await expect(installSkin("ember-test", "1.0.0", "CC-BY-4.0", h.installer)).rejects.toThrow();
    expect(h.calls).not.toContain("install");
    const lying = host(skinJson({ license: "MIT" }));
    await expect(installSkin("ember-test", "1.0.0", "CC-BY-4.0", lying.installer)).rejects.toThrow(
      /does not match/,
    );
    expect(lying.calls).not.toContain("install");
  });
});
