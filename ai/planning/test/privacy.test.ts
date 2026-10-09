// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A plan is made from a SENSITIVE meeting. Through a REAL AiService (real router, real gate, real
// Ollama and Anthropic adapters) with a counting fake fetch: by default no cloud request is made,
// and even a user who opted in to cloud AI for sensitive data does not get plan generation in the
// cloud (the purpose is not in SENSITIVE_CLOUD_PURPOSES).
import {
  AiService,
  createDefaultProviders,
  type AiSettings,
  type CloudSendRecord,
  type FetchLike,
} from "@phoenix/ai-models";
import { describe, expect, it } from "vitest";
import { GITHUB, VENDOR_REPLY, me, planRig } from "./helpers";

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
            content: [{ type: "text", text: VENDOR_REPLY }],
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
        JSON.stringify({ message: { content: VENDOR_REPLY }, done: true, done_reason: "stop" }),
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

const OFF = { public: false, internal: false, sensitive: false };

async function plan(env: Env) {
  const r = planRig();
  r.ai.fn = async (request) => (await env.ai.run({ kind: "generate", request })).result;
  return { out: await r.plans.generate(r.decision.id, GITHUB, me), r };
}

describe("plan generation never reaches the cloud by default", () => {
  it("AI disabled: no network request at all; the plan is the labelled skeleton", async () => {
    const env = service({ enabled: false, cloudOptIn: OFF }, true, true);
    const { out } = await plan(env);
    expect(env.seen).toEqual([]);
    expect(out.plan.notAiGenerated).toBe(true);
    expect(out.unavailable).toMatch(/turned off/);
  });

  it("AI on, default opt-ins, local Ollama down: the meeting goes nowhere, skeleton plan", async () => {
    const env = service({ enabled: true, cloudOptIn: OFF }, true, false);
    const { out } = await plan(env);
    expect(env.cloud()).toEqual([]);
    expect(env.sends).toEqual([]);
    expect(out.plan.notAiGenerated).toBe(true);
    expect(env.seen.some((s) => s.body.includes("vendor approval"))).toBe(false);
  });

  it("grant + public/internal opt-ins but not sensitive: still no cloud request", async () => {
    const env = service(
      { enabled: true, cloudOptIn: { public: true, internal: true, sensitive: false } },
      true,
      false,
    );
    await plan(env);
    expect(env.cloud()).toEqual([]);
  });

  it("even with the sensitive opt-in, plan generation is not a permitted cloud purpose", async () => {
    const env = service(
      { enabled: true, cloudOptIn: { public: true, internal: true, sensitive: true } },
      true,
      false,
    );
    const { out } = await plan(env);
    expect(out.plan.notAiGenerated).toBe(true);
    expect(env.cloud()).toEqual([]);
    expect(env.sends).toEqual([]);
  });

  it("with local Ollama up the item goes to Ollama only, and the model's plan is used", async () => {
    const env = service({ enabled: true, cloudOptIn: OFF }, true, true);
    const { out } = await plan(env);
    expect(env.cloud()).toEqual([]);
    expect(env.seen.filter((s) => s.url.endsWith("/api/chat"))).toHaveLength(1);
    expect(out.plan.notAiGenerated).toBe(false);
    expect(out.plan.generatedBy).toBe("ai:ollama/llama3.2");
    expect(out.record.status).toBe("draft");
  });
});
