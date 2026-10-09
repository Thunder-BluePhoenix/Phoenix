// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Transcripts are sensitive. Through a REAL AiService (real router, real gate, real Ollama and
// Anthropic adapters) with a counting fake fetch: by default no cloud request is ever made, and
// even a user who opted in to cloud AI for sensitive data does not get extraction in the cloud.
import {
  AiService,
  createDefaultProviders,
  type AiSettings,
  type CloudSendRecord,
  type FetchLike,
} from "@phoenix/ai-models";
import { generateWith } from "@phoenix/ai-context";
import { describe, expect, it } from "vitest";
import { PLANNING, rig } from "./helpers";

interface Seen {
  url: string;
  body: string;
}

interface Env {
  ai: AiService;
  seen: Seen[];
  sends: CloudSendRecord[];
  cloud(): Seen[];
}

function service(settings: AiSettings, grant: boolean, ollamaUp: boolean): Env {
  const seen: Seen[] = [];
  const sends: CloudSendRecord[] = [];
  const fetchFn: FetchLike = (url, init) => {
    seen.push({ url, body: typeof init?.body === "string" ? init.body : "" });
    if (url.includes("api.anthropic.com")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: '{"items":[]}' }],
            model: "m",
            stop_reason: "end_turn",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    if (!ollamaUp) return Promise.reject(new TypeError("connection refused"));
    if (url.endsWith("/api/tags")) {
      return Promise.resolve(
        new Response(JSON.stringify({ models: [{ name: "llama3.2:latest", size: 1 }] })),
      );
    }
    if (url.endsWith("/api/version"))
      return Promise.resolve(new Response(JSON.stringify({ version: "0.1.0" })));
    return Promise.resolve(
      new Response(
        JSON.stringify({ message: { content: '{"items":[]}' }, done: true, done_reason: "stop" }),
      ),
    );
  };
  const ai = new AiService({
    registry: createDefaultProviders({
      fetch: fetchFn,
      anthropicKey: () => Promise.resolve(["key", "for", "tests"].join("-")),
    }),
    policy: { allowed: () => grant },
    settings: () => settings,
    sleep: () => Promise.resolve(),
    auditCloudSend: (record) => sends.push(record),
  });
  return { ai, seen, sends, cloud: () => seen.filter((s) => s.url.includes("anthropic")) };
}

async function extract(env: Env) {
  const r = rig();
  const id = r.meeting("1", { transcript: PLANNING });
  r.generate.fn = generateWith(env.ai);
  return { out: await r.service.extractWithAi(id), r, id };
}

describe("transcript extraction never reaches the cloud by default", () => {
  it("AI disabled: no network request at all, Kage's items still import", async () => {
    const env = service(
      { enabled: false, cloudOptIn: { public: false, internal: false, sensitive: false } },
      true,
      true,
    );
    const { out, r, id } = await extract(env);
    expect(out?.unavailable).toMatch(/turned off/);
    expect(env.seen).toEqual([]);
    expect(r.service.importKage(id)).toEqual({ imported: 0, duplicates: 0, removed: 0 });
  });

  it("AI on, default opt-ins, local Ollama down: the transcript goes nowhere", async () => {
    const env = service(
      { enabled: true, cloudOptIn: { public: false, internal: false, sensitive: false } },
      true,
      false,
    );
    const { out } = await extract(env);
    expect(out?.stored).toBe(0);
    expect(out?.unavailable).toMatch(/allowed to see|did not answer/);
    expect(env.cloud()).toEqual([]);
    expect(env.sends).toEqual([]);
    expect(env.seen.some((s) => s.body.includes("Phoenix release"))).toBe(false);
  });

  it("grant given and public/internal cloud opt-ins on, sensitive not: still no cloud request", async () => {
    const env = service(
      { enabled: true, cloudOptIn: { public: true, internal: true, sensitive: false } },
      true,
      false,
    );
    await extract(env);
    expect(env.cloud()).toEqual([]);
  });

  it("even with the sensitive cloud opt-in, extraction is not a permitted cloud purpose", async () => {
    const env = service(
      { enabled: true, cloudOptIn: { public: true, internal: true, sensitive: true } },
      true,
      false,
    );
    const { out } = await extract(env);
    expect(out?.unavailable).not.toBeNull();
    expect(env.cloud()).toEqual([]);
    expect(env.sends).toEqual([]);
  });

  it("with local Ollama up the transcript is sent to Ollama only, and the reply is processed", async () => {
    const env = service(
      { enabled: true, cloudOptIn: { public: false, internal: false, sensitive: false } },
      true,
      true,
    );
    const { out } = await extract(env);
    expect(out?.unavailable).toBeNull();
    expect(env.cloud()).toEqual([]);
    expect(env.seen.filter((s) => s.url.endsWith("/api/chat"))).toHaveLength(1);
    expect(
      env.seen.every(
        (s) => s.url.startsWith("http://127.0.0.1") || s.url.startsWith("http://localhost"),
      ),
    ).toBe(true);
  });
});
