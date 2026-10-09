// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { route, type RouterProvider, type RouterState, type RouteTask } from "../src";

const local = (over: Partial<RouterProvider> = {}): RouterProvider => ({
  id: "ollama",
  label: "Ollama",
  locality: "local",
  capabilities: { generate: true, stream: true, embed: true },
  costTier: 0,
  typicalLatencyMs: 2000,
  ...over,
});
const cloud = (over: Partial<RouterProvider> = {}): RouterProvider => ({
  id: "anthropic",
  label: "Anthropic",
  locality: "cloud",
  capabilities: { generate: true, stream: true, embed: false },
  costTier: 2,
  typicalLatencyMs: 1500,
  ...over,
});

function state(over: Partial<RouterState> = {}): RouterState {
  return {
    providers: [local(), cloud()],
    health: {},
    policy: { allowed: () => true },
    cloudOptIn: { public: true, internal: true, sensitive: false },
    ...over,
  };
}
const task = (over: Partial<RouteTask> = {}): RouteTask => ({
  kind: "generate",
  privacy: "public",
  ...over,
});

describe("route: privacy", () => {
  it("never routes sensitive data to a cloud provider, even when the user prefers it and everything is granted", () => {
    const plan = route(task({ privacy: "sensitive", preferred: "anthropic" }), state());
    expect(plan.order).toEqual(["ollama"]);
    const refused = plan.candidates.find((c) => c.providerId === "anthropic");
    expect(refused?.refusedBecause).toMatch(/sensitive/);
    expect(plan.notes.join(" ")).toMatch(/preferred provider anthropic was not used: sensitive/);
  });

  it("sensitive data reaches a cloud provider only with the grant, the sensitive opt-in AND an allowed purpose", () => {
    const optIn = { public: true, internal: true, sensitive: true };
    const ask = { privacy: "sensitive" as const, purpose: "answer a question from memory" };
    const allowed = route(task({ ...ask, preferred: "anthropic" }), state({ cloudOptIn: optIn }));
    expect(allowed.order[0]).toBe("anthropic");
    // Each condition on its own is enough to refuse.
    const noOptIn = route(task(ask), state());
    expect(noOptIn.order).toEqual(["ollama"]);
    expect(noOptIn.candidates.at(-1)?.refusedBecause).toMatch(/opt in/);
    const noGrant = route(
      task(ask),
      state({ cloudOptIn: optIn, policy: { allowed: () => false } }),
    );
    expect(noGrant.order).toEqual(["ollama"]);
    expect(noGrant.candidates.at(-1)?.refusedBecause).toMatch(/AI_external_processing/);
    const otherPurpose = route(
      task({ privacy: "sensitive", purpose: "summarise in the background" }),
      state({ cloudOptIn: optIn }),
    );
    expect(otherPurpose.order).toEqual(["ollama"]);
    expect(otherPurpose.candidates.at(-1)?.refusedBecause).toMatch(/purpose/);
    const noPurpose = route(task({ privacy: "sensitive" }), state({ cloudOptIn: optIn }));
    expect(noPurpose.order).toEqual(["ollama"]);
  });

  it("opting in to sensitive data does not opt in the other classes, and the reverse", () => {
    const ask = { privacy: "public" as const, purpose: "answer a question from memory" };
    const onlySensitive = state({
      cloudOptIn: { public: false, internal: false, sensitive: true },
    });
    expect(route(task(ask), onlySensitive).order).toEqual(["ollama"]);
    const everythingButSensitive = state();
    expect(route(task({ ...ask, privacy: "sensitive" }), everythingButSensitive).order).toEqual([
      "ollama",
    ]);
  });

  it("with only a cloud provider, sensitive data gets an empty plan", () => {
    const plan = route(task({ privacy: "sensitive" }), state({ providers: [cloud()] }));
    expect(plan.order).toEqual([]);
    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0]?.refusedBecause).toBeTruthy();
  });

  it("refuses cloud without the grant and says which condition is missing", () => {
    const plan = route(task(), state({ policy: { allowed: () => false } }));
    expect(plan.order).toEqual(["ollama"]);
    expect(plan.candidates.find((c) => c.providerId === "anthropic")?.refusedBecause).toMatch(
      /AI_external_processing/,
    );
  });

  it("refuses cloud for a class that is not opted in, but allows the opted-in class", () => {
    const s = state({ cloudOptIn: { public: true, internal: false, sensitive: false } });
    expect(route(task({ privacy: "internal" }), s).order).toEqual(["ollama"]);
    expect(route(task({ privacy: "internal" }), s).candidates.at(-1)?.refusedBecause).toMatch(
      /not enabled for internal/,
    );
    expect(route(task({ privacy: "public", preferred: "anthropic" }), s).order[0]).toBe(
      "anthropic",
    );
  });
});

describe("route: availability and capability", () => {
  it("skips a provider known to be offline and records why", () => {
    const plan = route(task({ preferred: "anthropic" }), state({ health: { anthropic: false } }));
    expect(plan.order).toEqual(["ollama"]);
    expect(plan.candidates.find((c) => c.providerId === "anthropic")?.refusedBecause).toMatch(
      /unavailable/,
    );
  });

  it("an offline local provider leaves an allowed cloud one as the only choice", () => {
    const plan = route(task(), state({ health: { ollama: false } }));
    expect(plan.order).toEqual(["anthropic"]);
  });

  it("refuses a provider that cannot do the task (embeddings on Anthropic)", () => {
    const plan = route(task({ kind: "embed" }), state());
    expect(plan.order).toEqual(["ollama"]);
    expect(plan.candidates.find((c) => c.providerId === "anthropic")?.refusedBecause).toBe(
      "does not support embed",
    );
  });

  it("known-available providers come before ones that have not been checked", () => {
    const plan = route(task(), state({ health: { anthropic: true } }));
    expect(plan.order).toEqual(["anthropic", "ollama"]);
  });
});

describe("route: user choice, cost and latency", () => {
  it("the preferred provider wins among allowed ones", () => {
    expect(route(task({ preferred: "anthropic" }), state()).order).toEqual(["anthropic", "ollama"]);
    expect(route(task({ preferred: "ollama" }), state()).order).toEqual(["ollama", "anthropic"]);
  });

  it("orders by cost tier, then latency, then id, when nothing is preferred", () => {
    const providers = [
      cloud({ id: "c-slow", costTier: 1, typicalLatencyMs: 900 }),
      cloud({ id: "c-fast", costTier: 1, typicalLatencyMs: 300 }),
      cloud({ id: "c-cheap", costTier: 0, typicalLatencyMs: 5000 }),
      cloud({ id: "a-tie", costTier: 1, typicalLatencyMs: 300 }),
    ];
    const plan = route(task(), state({ providers }));
    expect(plan.order).toEqual(["c-cheap", "a-tie", "c-fast", "c-slow"]);
  });

  it("a latency budget moves over-budget providers behind those within it, even if cheaper", () => {
    const plan = route(
      task({ latencyBudgetMs: 1800 }),
      state({ providers: [local({ typicalLatencyMs: 4000 }), cloud({ typicalLatencyMs: 1500 })] }),
    );
    expect(plan.order).toEqual(["anthropic", "ollama"]);
    const ollama = plan.candidates.find((c) => c.providerId === "ollama");
    expect(ollama?.reasons.join(" ")).toMatch(/over the 1800 ms budget/);
  });

  it("maxCostTier is a hard cap", () => {
    const plan = route(task({ maxCostTier: 1 }), state());
    expect(plan.order).toEqual(["ollama"]);
    expect(plan.candidates.find((c) => c.providerId === "anthropic")?.refusedBecause).toMatch(
      /cost tier 2 is above the allowed 1/,
    );
  });

  it("an unknown preferred id is noted and ignored", () => {
    const plan = route(task({ preferred: "nope" }), state());
    expect(plan.order).toEqual(["ollama", "anthropic"]);
    expect(plan.notes).toEqual(["preferred provider nope is not registered"]);
  });
});

describe("route: explainability and determinism", () => {
  it("every candidate has a reason: reasons if allowed, refusedBecause if refused", () => {
    const plan = route(
      task({ kind: "embed", privacy: "internal" }),
      state({
        providers: [
          local(),
          cloud(),
          cloud({ id: "z-cloud", capabilities: { generate: true, stream: true, embed: true } }),
        ],
        cloudOptIn: { public: false, internal: false, sensitive: false },
      }),
    );
    expect(plan.candidates).toHaveLength(3);
    for (const c of plan.candidates) {
      if (c.refusedBecause === undefined) expect(c.reasons.length).toBeGreaterThan(0);
      else expect(c.refusedBecause.length).toBeGreaterThan(0);
    }
  });

  it("does not depend on the order providers were registered", () => {
    const a = route(task(), state({ providers: [local(), cloud()] }));
    const b = route(task(), state({ providers: [cloud(), local()] }));
    expect(b).toEqual(a);
  });

  it("reads the grant at routing time", () => {
    let granted = true;
    const s = state({ policy: { allowed: () => granted } });
    expect(route(task(), s).order).toContain("anthropic");
    granted = false;
    expect(route(task(), s).order).not.toContain("anthropic");
  });
});
