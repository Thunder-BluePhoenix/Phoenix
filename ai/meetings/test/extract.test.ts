// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { AiDisabledError } from "@phoenix/ai-models";
import { describe, expect, it } from "vitest";
import {
  CHUNK_CHARS,
  MAX_ITEMS_PER_MEETING,
  chunkText,
  extractWithAi,
  findQuote,
  groundTextOf,
  kageItems,
  normalise,
  proposedItems,
} from "../src";
import { PLANNING, reply, rig, scripted } from "./helpers";

const decision = (text: string, quote: string, extra: Record<string, unknown> = {}) => ({
  kind: "decision",
  text,
  quote,
  ...extra,
});

describe("normalise / findQuote", () => {
  const hay = (t: string) => normalise(t);

  it("matches ignoring case, whitespace runs, typographic quotes and zero-width characters", () => {
    const h = hay("We\u200B   DECIDED to ship\n\nthe release \u2014 it\u2019s final.");
    expect(findQuote(h, "decided to ship the release - it's final").found).toBe(true);
  });

  it("maps a match back to offsets in the original text", () => {
    const original = "Intro line.\nWe decided to  ship on Friday.\nBye.";
    const found = findQuote(hay(original), "we decided to ship on friday");
    expect(found.found).toBe(true);
    if (found.found)
      expect(original.slice(found.match.start, found.match.end)).toBe(
        "We decided to  ship on Friday",
      );
  });

  it("does not match a paraphrase, a reordering or a one-word quote", () => {
    const h = hay("We decided to ship on Friday");
    expect(findQuote(h, "we chose to ship on friday")).toEqual({ found: false, reason: "absent" });
    expect(findQuote(h, "friday on ship")).toMatchObject({ found: false });
    expect(findQuote(h, "friday")).toEqual({ found: false, reason: "unusable" });
    expect(findQuote(h, "")).toEqual({ found: false, reason: "unusable" });
  });

  it("rejects a quote that is the whole of a very large text", () => {
    const big = "word ".repeat(500);
    expect(findQuote(hay(big), big)).toEqual({ found: false, reason: "unusable" });
  });
});

describe("chunkText", () => {
  it("bounds the number and size of chunks and reports what was skipped", () => {
    const text = "line of text here\n".repeat(20_000);
    const { chunks, charsSkipped } = chunkText(text);
    expect(chunks.length).toBe(8);
    expect(chunks.every((c) => c.text.length <= CHUNK_CHARS)).toBe(true);
    expect(charsSkipped).toBeGreaterThan(0);
  });

  it("returns one chunk for a short text", () => {
    expect(chunkText("hello there").chunks).toEqual([{ text: "hello there" }]);
  });
});

describe("proposedItems (defensive parsing)", () => {
  it("reads a plain object, an array, fenced JSON and JSON surrounded by chatter", () => {
    const one = { kind: "decision", text: "a b", quote: "c d" };
    expect(proposedItems(JSON.stringify({ items: [one] }))).toEqual([one]);
    expect(proposedItems(JSON.stringify([one]))).toEqual([one]);
    expect(proposedItems("```json\n" + JSON.stringify({ items: [one] }) + "\n```")).toEqual([one]);
    expect(
      proposedItems("Sure! Here you go: " + JSON.stringify({ items: [one] }) + " Hope it helps"),
    ).toEqual([one]);
  });

  it("returns null for prose, broken JSON and objects without an items list", () => {
    expect(proposedItems("I cannot help with that")).toBeNull();
    expect(proposedItems('{"items": [{"kind": ')).toBeNull();
    expect(proposedItems('{"items": "none"}')).toBeNull();
    expect(proposedItems("")).toBeNull();
    expect(proposedItems("{".repeat(10_000))).toBeNull();
  });
});

describe("AI extraction and the grounding check", () => {
  const transcript = { text: PLANNING };

  it("keeps grounded items, with the verbatim quote and the speaker as evidence", async () => {
    const s = scripted(
      reply(
        decision(
          "Ship the Phoenix release on Friday",
          "We decided to ship the Phoenix release on Friday",
        ),
        {
          kind: "action_item",
          text: "Write the migration guide",
          quote: "Sam will write the migration guide by Thursday",
          owner: "Sam",
          due: "Thursday",
        },
      ),
    );
    const out = await extractWithAi(transcript, { generate: s.fn, nonce: () => "N" });
    expect(out.items).toHaveLength(2);
    expect(out.stats).toMatchObject({ proposed: 2, grounded: 2, ownersDropped: 0, duesDropped: 0 });
    const action = out.items.find((i) => i.kind === "action_item");
    expect(action).toMatchObject({
      owner: "Sam",
      due: "Thursday",
      extractedBy: "ai:ollama/llama3.2",
    });
    expect(action?.evidence).toMatchObject({
      source: "transcript",
      quote: "Sam will write the migration guide by Thursday",
    });
    // segments are only reported when the transcript has them
    expect(action?.evidence?.segmentStart).toBeUndefined();
  });

  it("reports segment indices when the transcript has segments", async () => {
    const segments = PLANNING.split("\n").map((text, i) => ({
      start_ms: i * 1000,
      end_ms: i * 1000 + 900,
      speaker: null,
      text,
    }));
    const s = scripted(
      reply({
        kind: "decision",
        text: "Drop Node 18",
        quote: "We also decided to drop support for Node 18",
      }),
    );
    const out = await extractWithAi({ text: PLANNING, segments }, { generate: s.fn });
    expect(out.items[0]?.evidence).toMatchObject({ segmentStart: 2, segmentEnd: 2 });
  });

  it("DROPS and counts hallucinated items: no quote, quote not in the transcript, paraphrase, unusable", async () => {
    const s = scripted(
      reply(
        decision("Hire two engineers", "We decided to hire two engineers in Berlin"),
        decision("No quote at all", ""),
        { kind: "decision", text: "Missing quote field" },
        decision("Short", "ship"),
        decision("Paraphrase", "the team chose to release on friday"),
        decision("Ship the release on Friday", "We decided to ship the Phoenix release on Friday"),
        { kind: "nonsense", text: "x y z", quote: "We decided to ship" },
        "just a string",
      ),
    );
    const out = await extractWithAi(transcript, { generate: s.fn });
    expect(out.items.map((i) => i.text)).toEqual(["Ship the release on Friday"]);
    expect(out.stats.proposed).toBe(8);
    expect(out.stats.grounded).toBe(1);
    expect(out.stats.dropped).toEqual({
      malformed: 2,
      no_quote: 2,
      quote_unusable: 1,
      quote_not_found: 2,
      text_not_supported: 0,
    });
  });

  it("drops an item whose text the quote does not support, even if the quote is real", async () => {
    const s = scripted(
      reply(
        decision(
          "Fire the entire marketing department",
          "We also decided to drop support for Node 18",
        ),
      ),
    );
    const out = await extractWithAi(transcript, { generate: s.fn });
    expect(out.items).toEqual([]);
    expect(out.stats.dropped.text_not_supported).toBe(1);
  });

  it("keeps an owner or date only when the quote or the speaker supports it", async () => {
    const segments = PLANNING.split("\n").map((line, i) => {
      const [speaker, ...rest] = line.split(": ");
      return { start_ms: i, end_ms: i + 1, speaker: speaker ?? null, text: rest.join(": ") };
    });
    const action = (over: Record<string, unknown>) => ({
      kind: "action_item",
      text: "Review the security notes",
      quote: "I will review the security notes before the release",
      ...over,
    });
    const s = scripted(
      reply(
        action({ owner: "Lee", due: "Monday" }),
        action({ text: "Review security notes again", owner: "Mallory" }),
      ),
    );
    const out = await extractWithAi({ text: PLANNING, segments }, { generate: s.fn });
    // Lee spoke the line, so the speaker supports the owner; "Monday" is not in the quote.
    expect(out.items[0]).toMatchObject({ owner: "Lee", due: null });
    expect(out.stats.duesDropped).toBe(1);
    expect(out.stats.ownersDropped).toBe(1);
    // Plain text: the "Lee:" line prefix is the speaker. Someone who did not speak it is dropped.
    const plain = await extractWithAi(
      { text: PLANNING },
      { generate: scripted(reply(action({ owner: "Lee" }), action({ owner: "Maya" }))).fn },
    );
    expect(plain.items[0]?.owner).toBe("Lee");
    const stranger = await extractWithAi(
      { text: PLANNING },
      { generate: scripted(reply(action({ owner: "Maya" }))).fn },
    );
    expect(stranger.items[0]?.owner).toBeNull();
    // A transcript with no speaker at all supports no owner that the quote does not name.
    const anonymous = await extractWithAi(
      { text: "I will review the security notes before the release" },
      { generate: scripted(reply(action({ owner: "Lee" }))).fn },
    );
    expect(anonymous.items[0]?.owner).toBeNull();
    // A date said in the quote is kept as said.
    const dated = await extractWithAi(
      { text: PLANNING },
      {
        generate: scripted(
          reply({
            kind: "action_item",
            text: "Write the migration guide",
            quote: "Sam will write the migration guide by Thursday",
            owner: "Sam",
            due: "Thursday",
          }),
        ).fn,
      },
    );
    expect(dated.items[0]).toMatchObject({ owner: "Sam", due: "Thursday" });
  });

  it("an owner on a decision is discarded (only action items have owners)", async () => {
    const s = scripted(
      reply(
        decision("Ship on Friday", "We decided to ship the Phoenix release on Friday", {
          owner: "Maya",
          due: "Friday",
        }),
      ),
    );
    const out = await extractWithAi(transcript, { generate: s.fn });
    expect(out.items[0]).toMatchObject({ owner: null, due: null });
  });

  it("strips fields outside the schema, including a status, and counts them", async () => {
    const s = scripted(
      reply({
        ...decision("Ship on Friday", "We decided to ship the Phoenix release on Friday"),
        status: "accepted",
        tool_call: { name: "git.push" },
        reviewed_by: "owner",
      }),
    );
    const out = await extractWithAi(transcript, { generate: s.fn });
    expect(Object.keys(out.items[0] ?? {}).sort()).toEqual(
      ["dedupeKey", "evidence", "extractedBy", "due", "kind", "owner", "text"].sort(),
    );
    expect(out.stats.ignoredFields).toBe(3);
  });

  it("de-duplicates near-duplicates and caps the items per meeting", async () => {
    const s = scripted(
      reply(
        decision(
          "Ship the Phoenix release on Friday",
          "We decided to ship the Phoenix release on Friday",
        ),
        decision(
          "Ship Phoenix release on Friday!",
          "We decided to ship the Phoenix release on Friday",
        ),
        decision(
          "Ship the Phoenix release on Friday",
          "We decided to ship the Phoenix release on Friday",
        ),
      ),
    );
    const out = await extractWithAi(transcript, { generate: s.fn });
    expect(out.items).toHaveLength(1);
    expect(out.stats.duplicates).toBe(2);
  });

  it("caps the items per meeting across chunks", async () => {
    const lines = Array.from(
      { length: 400 },
      (_, i) => `Speaker${i}: we decided to adopt tool${i} widget${i} today for project${i}`,
    );
    const many = scripted((req) => {
      const body = req.messages[1]?.content ?? "";
      const quoted = body.split("\n").filter((l) => l.includes("we decided to adopt"));
      return reply(
        ...quoted.slice(0, 25).map((l) => {
          const n = /tool(\d+)/.exec(l)?.[1] ?? "0";
          return decision(`Adopt tool${n} widget${n}`, l.split(": ")[1] ?? "");
        }),
      );
    });
    const big = await extractWithAi({ text: lines.join("\n") }, { generate: many.fn });
    expect(many.requests.length).toBeGreaterThan(2);
    expect(big.items).toHaveLength(MAX_ITEMS_PER_MEETING);
    expect(big.stats.capped).toBeGreaterThan(0);
  });

  it("does not re-add items the meeting already has", async () => {
    const s = scripted(
      reply(
        decision(
          "Ship the Phoenix release on Friday",
          "We decided to ship the Phoenix release on Friday",
        ),
      ),
    );
    const out = await extractWithAi(transcript, {
      generate: s.fn,
      known: [{ kind: "decision", text: "Ship the Phoenix release on Friday" }],
    });
    expect(out.items).toEqual([]);
    expect(out.stats.duplicates).toBe(1);
  });

  it("sends the transcript as sensitive, with a purpose cloud cannot be opted into, inside nonce markers", async () => {
    const s = scripted(reply());
    await extractWithAi(transcript, { generate: s.fn, nonce: () => "N0NCE" });
    const request = s.requests[0];
    expect(request).toMatchObject({ privacy: "sensitive", temperature: 0 });
    const user = request?.messages.find((m) => m.role === "user")?.content ?? "";
    expect(user).toContain("<<<TRANSCRIPT N0NCE>>>");
    expect(user.indexOf("<<<TRANSCRIPT N0NCE>>>")).toBeLessThan(user.indexOf("Maya:"));
    expect(user.indexOf("Maya:")).toBeLessThan(user.indexOf("<<<END-TRANSCRIPT N0NCE>>>"));
    expect(request?.messages[0]?.content).toMatch(/untrusted DATA/);
  });

  it("reports unavailability (AI off) without failing, and returns nothing", async () => {
    const out = await extractWithAi(transcript, {
      generate: () => Promise.reject(new AiDisabledError()),
    });
    expect(out.items).toEqual([]);
    expect(out.unavailable).toMatch(/turned off/);
  });

  it("survives an unreadable reply and a failing chunk", async () => {
    const out = await extractWithAi(transcript, { generate: scripted("I would rather not").fn });
    expect(out).toMatchObject({ items: [], stats: { unparseableChunks: 1 } });
    const failing = await extractWithAi(transcript, {
      generate: () => Promise.reject(new Error("boom")),
    });
    expect(failing.stats.failedChunks).toBe(1);
  });

  it("chunks a long transcript: one model call per chunk, quotes found in any chunk", async () => {
    const filler = "The team talked about unrelated things for a while.\n".repeat(400);
    const text = `${filler}We decided to adopt the new logging format.\n${filler}`;
    const s = scripted((req) =>
      (req.messages[1]?.content ?? "").includes("adopt the new logging format")
        ? reply(
            decision("Adopt the new logging format", "We decided to adopt the new logging format"),
          )
        : reply(),
    );
    const out = await extractWithAi({ text }, { generate: s.fn });
    expect(s.requests.length).toBeGreaterThan(1);
    expect(out.items).toHaveLength(1);
    expect(groundTextOf({ text }).text.length).toBeGreaterThan(CHUNK_CHARS);
  });
});

describe("Kage import", () => {
  it("imports Kage's decisions, action items and topics as proposed items attributed to kage", () => {
    const r = rig();
    const id = r.meeting("1", {
      transcript: PLANNING,
      summary: {
        text: "Release planning",
        decisions: ["We decided to ship the Phoenix release on Friday", "  "],
        action_items: [
          "Review notes",
          { text: "Write the migration guide", owner: "Sam", due: "Thursday" },
          { task: "Update docs", assignee: "Ada" },
          { nope: 1 },
          42,
        ],
        topics: ["release", "node 18"],
      },
    });
    const report = r.service.importKage(id);
    expect(report).toEqual({ imported: 6, duplicates: 0, removed: 0 });
    const items = r.service.list(id);
    expect(items.every((i) => i.status === "proposed" && i.extractedBy === "kage")).toBe(true);
    const guide = items.find((i) => i.text === "Write the migration guide");
    expect(guide).toMatchObject({ owner: "Sam", due: "Thursday" });
    const shipped = items.find((i) => i.kind === "decision");
    // The Kage decision is found in the transcript, so the evidence is the transcript quote.
    expect(shipped?.evidence).toMatchObject({ source: "transcript" });
    expect(items.find((i) => i.text === "Review notes")?.evidence).toEqual({
      source: "summary",
      quote: "Review notes",
    });
  });

  it("is idempotent, keeps reviewed items, and drops unreviewed ones Kage no longer produces", () => {
    const r = rig();
    const id = r.meeting("1", {
      summary: { text: "s", decisions: ["Use SQLite", "Use Postgres"] },
    });
    r.service.importKage(id);
    expect(r.service.importKage(id)).toEqual({ imported: 0, duplicates: 2, removed: 0 });
    const sqlite = r.service.list(id).find((i) => i.text === "Use SQLite");
    r.service.accept(sqlite?.id ?? "", { id: "me" });
    r.meetings.setSummary(id, { text: "s2", decisions: ["Use Redis"] });
    expect(r.service.importKage(id)).toEqual({ imported: 1, duplicates: 0, removed: 1 });
    expect(r.service.list(id).map((i) => [i.text, i.status])).toEqual([
      ["Use SQLite", "accepted"],
      ["Use Redis", "proposed"],
    ]);
  });

  it("works without a summary, and skips hostile shapes", () => {
    const r = rig();
    expect(r.service.importKage(r.meeting("1"))).toEqual({
      imported: 0,
      duplicates: 0,
      removed: 0,
    });
    expect(
      kageItems(
        {
          text: "",
          decisions: [null, 5, {}, [], "ok decision text"] as unknown as string[],
          action_items: [null, [], { text: 5 }],
        },
        null,
      ).map((i) => i.text),
    ).toEqual(["ok decision text"]);
  });
});
