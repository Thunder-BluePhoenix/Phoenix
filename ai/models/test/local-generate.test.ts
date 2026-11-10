// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 95: `AiService.generateLocal` never lets a request reach anything but a vetted on-device
// provider. Fakes only: no real model or network.
import { describe, expect, it } from "vitest";
import {
  AiService,
  ModelError,
  NoLocalModelError,
  OllamaProvider,
  ProviderRegistry,
  createEndpointProvider,
  type AiSettings,
  type GenerateRequest,
  type ModelProvider,
} from "../src";
import { fakeFetch, fakeProvider, json, withTags } from "./helpers";

const WIDE_OPEN: AiSettings = {
  enabled: true,
  cloudOptIn: { public: true, internal: true, sensitive: true },
};
const PAGE_CANARY = "PAGE-TEXT-CANARY-7731";
const request: GenerateRequest = {
  privacy: "internal",
  purpose: "answer about browser page",
  messages: [{ role: "user", content: PAGE_CANARY }],
};

function service(providers: ModelProvider[], settings: Partial<AiSettings> = {}) {
  const registry = new ProviderRegistry();
  for (const p of providers) registry.register(p);
  return new AiService({
    registry,
    // Everything that could make a cloud send legal is granted: only the local-only path stops it.
    policy: { allowed: () => true },
    auditCloudSend: () => undefined,
    settings: () => ({ ...WIDE_OPEN, ...settings }),
    sleep: () => Promise.resolve(),
  });
}

describe("AiService.generateLocal", () => {
  it("answers from a vetted local provider", async () => {
    const local = fakeProvider({ id: "ollama", locality: "local" });
    const out = await service([local]).generateLocal(request);
    expect(out.result.text).toBe("from ollama");
    expect(out.provenance.locality).toBe("local");
    expect(local.calls.generate).toBe(1);
  });

  it("with only a cloud provider throws NoLocalModelError and the cloud provider sees nothing", async () => {
    const cloud = fakeProvider({ id: "claude", locality: "cloud" });
    const s = service([cloud], { preferred: "claude" });
    await expect(s.generateLocal(request)).rejects.toBeInstanceOf(NoLocalModelError);
    await expect(s.generateLocal(request, { provider: "claude" })).rejects.toBeInstanceOf(
      NoLocalModelError,
    );
    expect(cloud.calls).toEqual({ generate: 0, stream: 0, embed: 0, health: 0 });
  });

  it("makes no network call at all when the only provider is a cloud one (nothing serialized)", async () => {
    const net = fakeFetch(() => json({}));
    const registry = new ProviderRegistry();
    registry.register(
      createEndpointProvider(
        { id: "remote", label: "Remote", base_url: "https://api.example.com/v1" },
        { fetch: net.fetch, keyFor: () => Promise.resolve("k") },
      ),
    );
    const s = new AiService({
      registry,
      policy: { allowed: () => true },
      auditCloudSend: () => undefined,
      settings: () => ({ ...WIDE_OPEN, preferred: "remote" }),
    });
    await expect(s.generateLocal(request)).rejects.toBeInstanceOf(NoLocalModelError);
    expect(net.requests).toEqual([]);
  });

  it("an unvetted loopback server is not a local model", async () => {
    const loopback = fakeProvider({ id: "lmstudio", locality: "local", trustedLocal: false });
    await expect(service([loopback]).generateLocal(request)).rejects.toBeInstanceOf(
      NoLocalModelError,
    );
    expect(loopback.calls.generate).toBe(0);
  });

  it("ignores a cloud preference, a cloud route and the grants: only the local provider is called", async () => {
    const local = fakeProvider({ id: "ollama", locality: "local" });
    const cloud = fakeProvider({ id: "claude", locality: "cloud" });
    const s = service([cloud, local], {
      preferred: "claude",
      routing: { summaries: { provider: "claude" }, chat: { provider: "claude" } },
    });
    const out = await s.generateLocal(request);
    expect(out.provider).toBe("ollama");
    expect(cloud.calls).toEqual({ generate: 0, stream: 0, embed: 0, health: 0 });
  });

  it("a failing local model fails closed: it never falls back to the cloud", async () => {
    const local = fakeProvider({
      id: "ollama",
      locality: "local",
      generate: () => Promise.reject(new ModelError("network", "ollama", "down")),
    });
    const cloud = fakeProvider({ id: "claude", locality: "cloud" });
    await expect(service([local, cloud]).generateLocal(request)).rejects.toThrow();
    expect(cloud.calls.generate).toBe(0);
  });

  it("a provider that claims to be cloud is refused by the call-time check too (router bypassed)", async () => {
    // The service's last line of defence: even if a cloud provider were planned, it is not called.
    const cloud = fakeProvider({ id: "claude", locality: "cloud" });
    const s = service([cloud]);
    await expect(s.run({ kind: "generate", request, localProvider: "claude" })).rejects.toThrow();
    expect(cloud.calls.generate).toBe(0);
  });

  it("refuses without calling any provider while AI is off", async () => {
    const local = fakeProvider({ id: "ollama", locality: "local" });
    await expect(service([local], { enabled: false }).generateLocal(request)).rejects.toThrow(
      /disabled/,
    );
    expect(local.calls.generate).toBe(0);
  });

  it("real Ollama adapter with a fake fetch: every request goes to loopback", async () => {
    const net = fakeFetch(
      withTags((req) =>
        req.url.endsWith("/api/version")
          ? json({ version: "0.5.0" })
          : json({
              model: "llama3.2:latest",
              message: { role: "assistant", content: "ok" },
              done: true,
            }),
      ),
    );
    const s = service([new OllamaProvider({ fetch: net.fetch })]);
    const out = await s.generateLocal(request);
    expect(out.result.text).toBe("ok");
    expect(net.requests.length).toBeGreaterThan(0);
    for (const r of net.requests) {
      expect(["127.0.0.1", "localhost", "[::1]"]).toContain(new URL(r.url).hostname);
    }
  });
});
