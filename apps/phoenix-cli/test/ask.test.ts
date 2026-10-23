// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startFakeCore, type FakeCore } from "./fake-core";
import { makeHarness, type Harness } from "./harness";

let core: FakeCore;
let h: Harness;

const item = (id: string, text: string, classification: string) => ({
  id,
  text,
  domain: "work",
  source: "github",
  source_ref: `ref/${id}`,
  observed_at: "2026-10-22T10:00:00.000Z",
  sensitivity: "internal",
  classification,
  confidence: null,
  freshness: "fresh",
});

const answered = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  facts: [item("m1", "CI failed on main", "stored_fact")],
  retrieved_evidence: [item("m2", "Lint step exited 1", "retrieved_evidence")],
  stored_interpretations: [],
  interpretation: "The lint step failed.",
  interpretation_classification: "hypothesis",
  provider: "ollama",
  provider_label: "Ollama",
  model: "llama3",
  locality: "local",
  usage: null,
  cost: null,
  ai_used: true,
  note: null,
  ...overrides,
});

beforeEach(async () => {
  core = await startFakeCore();
  h = makeHarness(core.token, core.url);
});

afterEach(async () => {
  h.cleanup();
  await core.stop();
});

describe("phoenix ask", () => {
  it("posts the question to the memory route and labels the answer a hypothesis", async () => {
    core.memoryAnswer = answered();
    const r = await h.cli(["ask", "why", "did CI fail?"]);
    expect(r.code).toBe(0);
    expect(core.requests.at(-1)).toMatchObject({
      method: "POST",
      path: "/api/memory/ask",
      client: "phoenix-cli",
      body: { question: "why did CI fail?" },
    });
    expect(r.out).toContain("a hypothesis, not a stored fact");
    expect(r.out).toContain("The lint step failed.");
    expect(r.out).toContain("[fact] github: CI failed on main");
    expect(r.out).toContain("[evidence] github: Lint step exited 1");
    expect(r.out).toContain("Ollama / llama3 · local");
    expect(h.everything(r)).not.toContain(core.token);
  });

  it("fails with Core's reason, not facts, when no AI answer was produced", async () => {
    core.memoryAnswer = answered({
      ai_used: false,
      interpretation: null,
      interpretation_classification: null,
      note: "AI is turned off.",
    });
    const r = await h.cli(["ask", "why did CI fail?"]);
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toContain("AI is turned off.");
    expect(r.err).not.toContain("CI failed on main");
  });

  it("treats an AI flag with empty text as no answer", async () => {
    core.memoryAnswer = answered({ interpretation: "   " });
    const r = await h.cli(["ask", "q"]);
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
  });

  it("strips terminal control and bidi characters from model, evidence and note text", async () => {
    core.memoryAnswer = answered({
      interpretation: "ok\u001b]0;pwned\u0007\nline \u202Eevil",
      facts: [item("m1", "fact\u001b[2Jx", "stored_fact")],
      note: "n\u001b[31mote",
    });
    const r = await h.cli(["ask", "q"]);
    expect(r.code).toBe(0);
    // eslint-disable-next-line no-control-regex
    expect(r.out).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f\u202e]/);
    expect(r.out).toContain("line evil");
  });

  it("escapes unsafe characters in --json and labels the answer", async () => {
    core.memoryAnswer = answered({ interpretation: "a\u202Eb" });
    const r = await h.cli(["ask", "q", "--json"]);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("\u202e");
    const parsed = JSON.parse(r.out) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      classification: "hypothesis",
      answer: "a\\u202eb",
      provider: "Ollama",
      model: "llama3",
      locality: "local",
    });
  });

  it("rejects an empty or over-long question before contacting Core", async () => {
    const empty = await h.cli(["ask"]);
    expect(empty.code).toBe(2);
    const long = await h.cli(["ask", "x".repeat(501)]);
    expect(long.code).toBe(2);
    expect(core.requests).toHaveLength(0);
  });

  it("reports an unexpected Core answer as a failure", async () => {
    core.memoryAnswer = { hello: "world" };
    const r = await h.cli(["ask", "q"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("unexpected shape");
  });

  it("does not print Core's rejection reason with the token in it", async () => {
    core.failWith = {
      status: 400,
      body: { code: "INVALID_REQUEST", message: `bad ${core.token}` },
    };
    const r = await h.cli(["ask", "q"]);
    expect(r.code).toBe(1);
    expect(h.everything(r)).not.toContain(core.token);
  });
});
