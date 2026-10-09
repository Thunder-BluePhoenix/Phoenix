// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 33: GET /api/agent/tasks/:id/observation through a real PhoenixRuntime. The CI-failure agent
// runs against the local mock GitHub and a fake Ollama; the observation must carry ids, names,
// counts, hashes and numbers only, report the model that answered, and say "unknown" for token
// counts the model service did not report.
import { observationLeaks } from "@phoenix/ai-evaluation";
import type { FetchLike } from "@phoenix/ai-models";
import { createGithubCapability } from "@phoenix/capability-github";
import { MemorySecretStore } from "@phoenix/persistence";
import { afterEach, describe, expect, it, vi } from "vitest";
import { realRunData, REPO, RUN_ID } from "../../../ai/agents/test/rig";
import { FAKE_GITHUB_TOKEN } from "../../../protocol/testing/fake-secrets";
import { MOCK_TOKEN, startMockGithub } from "../../../capabilities/github/testing/mock-github";
import { fakeNetwork } from "./ai-network";
import { startCore, type TestCore } from "./helpers";
import { guardNetwork } from "./network-guard";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
  vi.restoreAllMocks();
});

const ANSWER = JSON.stringify({
  claims: [{ text: "The secret-scan job failed in the gitleaks step.", evidence: ["E2"] }],
  confidence: "high",
});

interface Observation {
  version: number;
  task_id: string;
  run_id: string;
  agent_id: string;
  outcome: string;
  model: {
    provider: string;
    model: string;
    locality: string;
    calls: number;
    input_tokens: number | string;
    output_tokens: number | string;
  } | null;
  prompt_version: string | null;
  context_version: string;
  sources: Record<string, number>;
  tool_calls: { tool: string; status: string; decision: string | null; audit_confirmed: boolean }[];
  permission_decisions: Record<string, number>;
  stages: { name: string; status: string; duration_ms: number }[];
  tokens: { input: number | string; output: number | string };
  cost_micro_usd: number | string;
  cloud_calls: number;
  ai_used: boolean;
  evidence_coverage: number | null;
  audit_ids: number[];
}

async function runCiTask(options: { ai: boolean; usage?: { prompt: number; eval: number } }) {
  const guard = guardNetwork();
  const gh = await startMockGithub();
  realRunData(gh);
  const net = fakeNetwork();
  // A fake Ollama chat that answers with the diagnosis and, when asked, reports token usage.
  const fetchFn: FetchLike = async (url, init) => {
    if (!url.endsWith("/api/chat")) return net.fetch(url, init);
    net.requests.push({ url, method: init?.method ?? "POST", body: String(init?.body ?? "") });
    return new Response(
      JSON.stringify({
        message: { role: "assistant", content: ANSWER },
        done: true,
        ...(options.usage
          ? { prompt_eval_count: options.usage.prompt, eval_count: options.usage.eval }
          : {}),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const core: TestCore = await startCore(
    {},
    {
      capabilities: [
        createGithubCapability({ sleep: () => Promise.withResolvers<void>().promise }),
      ],
      secrets: new MemorySecretStore(),
      runtime: { fetch: fetchFn },
    },
  );
  cleanups.push(async () => {
    await core.runtime.stop();
    await gh.close();
    guard.release();
  });
  await core.api("POST", "/api/capabilities/github/config", {
    config: { repositories: [], api_url: gh.url },
  });
  await core.api("POST", "/api/capabilities/github/secrets/token", { value: MOCK_TOKEN });
  expect((await core.api("POST", "/api/capabilities/github/enable", {})).status).toBe(200);
  await core.api("POST", "/api/agent/settings", { enabled: true });
  if (options.ai) await core.api("POST", "/api/ai/settings", { enabled: true });
  const created = await core.api("POST", "/api/agent/tasks", {
    kind: "ci_failure",
    input: { repository: REPO, run_id: RUN_ID },
  });
  expect(created.status).toBe(202);
  const id: string = created.json.task.id;
  // The github read tools ask the user once; the simulated user says yes.
  core.runtime.bus.subscribe("test.user", "security.confirmation.requested", () => {
    for (const c of core.runtime.permissions.pendingConfirmations()) {
      core.runtime.permissions.resolveConfirmation(c.id, true);
    }
  });
  await core.runtime.agents.orchestrator.settled(id);
  return { core, id, net };
}

const observation = async (core: TestCore, id: string) => {
  const res = await core.api("GET", `/api/agent/tasks/${id}/observation`);
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  const body: Observation = res.json;
  return body;
};

describe("GET /api/agent/tasks/:id/observation", () => {
  it("reports the model that answered and the tokens the service reported", async () => {
    const { core, id, net } = await runCiTask({ ai: true, usage: { prompt: 321, eval: 45 } });
    const o = await observation(core, id);
    expect(o).toMatchObject({
      version: 1,
      task_id: id,
      agent_id: "ci-failure",
      outcome: "COMPLETED",
      ai_used: true,
      cloud_calls: 0,
      cost_micro_usd: 0,
      model: {
        provider: "ollama",
        model: "llama3.2",
        locality: "local",
        calls: 1,
        input_tokens: 321,
        output_tokens: 45,
      },
      tokens: { input: 321, output: 45 },
    });
    expect(o.run_id).toMatch(/^run_/);
    expect(o.context_version).toMatch(/^[0-9a-f]{64}$/);
    expect(o.stages.length).toBeGreaterThan(3);
    expect(o.stages.map((s) => s.name)).toContain("execute");
    expect(o.tool_calls.map((t) => t.tool)).toContain("github.ci.failure_details");
    expect(o.tool_calls.every((t) => t.audit_confirmed)).toBe(true);
    expect(Object.values(o.permission_decisions).reduce((a, b) => a + b, 0)).toBe(
      o.tool_calls.filter((t) => t.decision !== null).length,
    );
    expect(o.sources.model).toBe(1);
    expect(o.evidence_coverage).toBe(1);
    expect(o.audit_ids.length).toBeGreaterThan(0);
    // The local model was the only provider contacted.
    expect(net.cloud()).toEqual([]);
  });

  it("says 'unknown' for tokens the model service did not report, not a number", async () => {
    const { core, id } = await runCiTask({ ai: true });
    const o = await observation(core, id);
    expect(o.model).toMatchObject({
      provider: "ollama",
      calls: 1,
      input_tokens: "unknown",
      output_tokens: "unknown",
    });
    expect(o.tokens).toEqual({ input: "unknown", output: "unknown" });
    // A local model is still free; unknown tokens do not make its cost unknown.
    expect(o.cost_micro_usd).toBe(0);
  });

  it("with AI off there is no model, no tokens and no model call", async () => {
    const { core, id, net } = await runCiTask({ ai: false });
    const o = await observation(core, id);
    expect(o).toMatchObject({ model: null, ai_used: false, cloud_calls: 0 });
    expect(o.tokens).toEqual({ input: 0, output: 0 });
    expect(net.chats()).toEqual([]);
  });

  it("holds ids, names, counts, hashes and numbers only: never evidence, model or tool text", async () => {
    const { core, id } = await runCiTask({ ai: true, usage: { prompt: 5, eval: 6 } });
    const detail = (await core.api("GET", `/api/agent/tasks/${id}`)).json;
    const o = await observation(core, id);
    const text = JSON.stringify(o);
    // Text the run really held, from the task detail: none of it may be in the observation.
    const held: string[] = [
      detail.summary,
      ...detail.evidence.map((e: { excerpt: string }) => e.excerpt),
      ...detail.proposals.map((p: { text: string }) => p.text),
      ...detail.diagnosis.claims.map((c: { text: string }) => c.text),
    ].filter((t: unknown) => typeof t === "string" && t.length > 20);
    expect(held.length).toBeGreaterThan(3);
    for (const piece of held) expect(text).not.toContain(piece.slice(0, 40));
    expect(text).not.toContain("gitleaks");
    expect(observationLeaks(o, ["gitleaks", "secret-scan", FAKE_GITHUB_TOKEN])).toEqual([]);
  });

  it("is 404 for an unknown task, needs the session token, and is read-only", async () => {
    const { core, id } = await runCiTask({ ai: false });
    expect((await core.api("GET", "/api/agent/tasks/task_nope/observation")).status).toBe(404);
    expect((await core.api("GET", `/api/agent/tasks/${"x".repeat(300)}/observation`)).status).toBe(
      404,
    );
    const noToken = await fetch(`${core.base}/api/agent/tasks/${id}/observation`);
    expect(noToken.status).toBe(401);
    const post = await core.api("POST", `/api/agent/tasks/${id}/observation`, {});
    expect(post.status).toBe(405);
  });
});
