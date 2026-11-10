// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 81, READ-ONLY checks of the model manager against a real loopback Ollama through a real
// in-process Core. Skipped unless PHOENIX_REAL_OLLAMA is set:
//   PHOENIX_REAL_OLLAMA=1 node_modules/.bin/vitest run core/runtime/test/real-ollama-models.test.ts
// Only GET requests are allowed: the recording fetch fails the test on any other method.
import { OllamaProvider } from "@phoenix/ai-models";
import { createLocalModelClient, createMachineCapability } from "@phoenix/capability-machine";
import { afterEach, describe, expect, it } from "vitest";
import { startCore, type TestCore } from "./helpers";

let core: TestCore | undefined;
afterEach(async () => {
  await core?.runtime.stop();
  core = undefined;
});

interface Seen {
  method: string;
  url: string;
}
function recordingFetch(seen: Seen[]): typeof fetch {
  return async (input, init) => {
    const method = init?.method ?? "GET";
    seen.push({ method, url: String(input) });
    if (method !== "GET") throw new Error(`read-only real test refused ${method} ${String(input)}`);
    return fetch(input, init);
  };
}
const show = (label: string, value: unknown) =>
  console.log(`RAW ${label} ${JSON.stringify(value)}`);

async function run(c: TestCore, command: string, input: unknown): Promise<any> {
  const op = await c.api("POST", `/api/capabilities/machine/commands/${command}`, { input });
  expect(op.status).toBe(202);
  for (let i = 0; i < 200; i++) {
    const polled = (await c.api("GET", `/api/operations/${op.json.id}`)).json;
    if (polled.status !== "pending" && polled.status !== "running") return polled;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("operation did not finish");
}

describe.skipIf(!process.env.PHOENIX_REAL_OLLAMA)(
  "Phase 81 model manager, read-only, against a real Ollama",
  { timeout: 120_000 },
  () => {
    it("lists the installed models and keeps remote (:cloud) models out of the local list", async () => {
      const machineSeen: Seen[] = [];
      const aiSeen: Seen[] = [];
      core = await startCore(
        {},
        {
          capabilities: [
            createMachineCapability({
              client: createLocalModelClient(recordingFetch(machineSeen)),
            }),
          ],
          runtime: { fetch: recordingFetch(aiSeen) as never },
        },
      );
      expect((await core.api("POST", "/api/capabilities/machine/enable", {})).status).toBe(200);

      const health = await run(core, "health_snapshot", {});
      show("health_snapshot", health);
      expect(health.status).toBe("succeeded");

      const listed = await run(core, "list_models", { provider: "ollama" });
      show("list_models", listed);
      expect(listed.status).toBe("succeeded");
      const byName = Object.fromEntries(
        (listed.result as { name: string; sizeBytes: number }[]).map((m) => [m.name, m]),
      );
      // `loaded` must agree with Ollama's own /api/ps (other processes may have a model loaded).
      const ps = (await (await fetch("http://127.0.0.1:11434/api/ps")).json()) as {
        models: { name: string }[];
      };
      const running = new Set(ps.models.map((m) => m.name));
      show("api_ps_direct", [...running]);
      for (const name of ["llama3.2:latest", "nomic-embed-text:latest"]) {
        expect(byName[name]).toMatchObject({ provider: "ollama", loaded: running.has(name) });
      }
      expect(byName["llama3.2:latest"]?.sizeBytes).toBe(2019393189);
      expect(byName["nomic-embed-text:latest"]?.sizeBytes).toBe(274302450);
      // The two `:cloud`-style entries run on ollama.com: they are not local models.
      expect(byName["kimi-k2.5:cloud"]).toBeUndefined();
      expect(byName["gpt-oss:120b-cloud"]).toBeUndefined();

      // Production wiring passes no trusted size catalog, so the fit check refuses (a read command).
      const fit = await run(core, "check_fit", { provider: "ollama", name: "llama3.2:latest" });
      show("check_fit", fit);
      expect(fit.status).toBe("failed");

      const cleanup = await run(core, "suggest_cleanup", { provider: "ollama" });
      show("suggest_cleanup", cleanup);
      expect(JSON.stringify(cleanup.result)).not.toMatch(/cloud/);

      // AI status path: provider health and the model list as the settings UI sees it.
      await core.api("POST", "/api/ai/settings", { enabled: true });
      const status = (await core.api("GET", "/api/ai/status?models=ollama")).json;
      const ollama = status.providers.find((p: { id: string }) => p.id === "ollama");
      show("ai_status_ollama", ollama);
      expect(ollama).toMatchObject({ locality: "local", available: true });
      expect(ollama.models.map((m: { id: string }) => m.id).sort()).toEqual([
        "llama3.2:latest",
        "nomic-embed-text:latest",
      ]);

      show("machine_requests", machineSeen);
      show("ai_requests", aiSeen);
      expect(machineSeen.length).toBeGreaterThan(0);
      expect([...machineSeen, ...aiSeen].every((r) => r.method === "GET")).toBe(true);
    });

    it("generateLocal refuses cloud-backed models by name, before any request is sent", async () => {
      const aiSeen: Seen[] = [];
      core = await startCore({}, { runtime: { fetch: recordingFetch(aiSeen) as never } });
      await core.api("POST", "/api/ai/settings", { enabled: true });
      const canary = "REAL-OLLAMA-CLOUD-CANARY-81";
      for (const model of ["kimi-k2.5:cloud", "gpt-oss:120b-cloud"]) {
        const err = await core.runtime.ai.service
          .generateLocal({
            privacy: "sensitive",
            purpose: "phase 81 read-only check",
            model,
            messages: [{ role: "user", content: canary }],
          })
          .then(
            () => undefined,
            (e: unknown) => e as Error,
          );
        show(`generateLocal ${model}`, String(err?.message ?? "no error"));
        expect(err).toBeDefined();
      }
      show("generateLocal_requests", aiSeen);
      expect(aiSeen.every((r) => r.method === "GET")).toBe(true);
      expect(JSON.stringify(aiSeen)).not.toContain(canary);
    });

    it("OllamaProvider flags the real cloud-backed entries as remote and refuses to generate/embed with them", async () => {
      const seen: Seen[] = [];
      const p = new OllamaProvider({ fetch: recordingFetch(seen) as never });
      const models = await p.models();
      show("OllamaProvider.models", models);
      const remote = Object.fromEntries(models.map((m) => [m.id, m.remote]));
      expect(remote).toEqual({
        "nomic-embed-text:latest": false,
        "llama3.2:latest": false,
        "kimi-k2.5:cloud": true,
        "gpt-oss:120b-cloud": true,
      });
      const req = { privacy: "sensitive" as const, purpose: "phase 81", messages: [] };
      for (const model of ["kimi-k2.5:cloud", "gpt-oss:120b-cloud"]) {
        await expect(p.generate({ ...req, model })).rejects.toMatchObject({ kind: "config" });
        await expect(
          p.embed({ privacy: "sensitive", purpose: "phase 81", input: ["x"], model }),
        ).rejects.toMatchObject({ kind: "config" });
      }
      show("OllamaProvider_requests", seen);
      expect(seen.every((r) => r.method === "GET")).toBe(true);
    });
  },
);
