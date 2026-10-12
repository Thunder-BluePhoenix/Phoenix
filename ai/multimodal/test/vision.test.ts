// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { LocalOllamaVision } from "../src";
import { routeMultimodal } from "@phoenix/ai-models";

const png = () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);

describe("local vision routing", () => {
  it("blocks even preferred cloud vision for sensitive frames", () => {
    const plan = routeMultimodal(
      "vision-understanding",
      [
        { id: "cloud", locality: "cloud", available: true, roles: ["vision-understanding"] },
        { id: "local", locality: "local", available: true, roles: ["vision-understanding"] },
      ],
      "cloud",
    );
    expect(plan.order).toEqual(["local"]);
    expect(plan.privacy).toBe("sensitive");
    expect(plan.refused).toEqual([
      { providerId: "cloud", reason: "captured inputs cannot be sent to cloud providers" },
    ]);
  });
  it("fails closed without an installed vision model and sends no frame", async () => {
    const requests: string[] = [];
    const adapter = new LocalOllamaVision("llama3.2", {
      fetch: async (url) => {
        requests.push(url);
        if (url.endsWith("/api/tags"))
          return new Response(JSON.stringify({ models: [{ name: "llama3.2" }] }));
        return new Response(JSON.stringify({ capabilities: ["completion"] }));
      },
    });
    const frame = png();
    await expect(adapter.describe(frame, "What is visible?")).rejects.toThrow(
      /does not support local vision/,
    );
    expect(frame).toEqual(new Uint8Array(9));
    expect(requests).toEqual([
      "http://127.0.0.1:11434/api/tags",
      "http://127.0.0.1:11434/api/show",
    ]);
    expect(() => new LocalOllamaVision("vision:cloud")).toThrow(/local vision/);
    expect(() => new LocalOllamaVision("vision", { baseUrl: "https://example.com" })).toThrow();
  });
  it("uses only loopback multimodal chat with installed vision model", async () => {
    const sent: string[] = [];
    const adapter = new LocalOllamaVision("llava", {
      fetch: async (url, init) => {
        sent.push(url);
        if (url.endsWith("/api/tags"))
          return new Response(JSON.stringify({ models: [{ name: "llava" }] }));
        if (url.endsWith("/api/show"))
          return new Response(JSON.stringify({ capabilities: ["vision"] }));
        const body = JSON.parse(String(init?.body));
        expect(body.messages[0].images).toHaveLength(1);
        return new Response(JSON.stringify({ message: { content: "A window." } }));
      },
    });
    const image = png();
    expect(await adapter.describe(image, "Describe it")).toMatchObject({
      description: "A window.",
      locality: "local",
    });
    expect(image).toEqual(new Uint8Array(9));
    expect(sent.at(-1)).toBe("http://127.0.0.1:11434/api/chat");
  });
  it("never follows a redirect with a sensitive frame", async () => {
    const calls: string[] = [];
    const adapter = new LocalOllamaVision("llava", {
      fetch: async (url, init) => {
        calls.push(url);
        expect(init?.redirect).toBe("error");
        if (url.endsWith("/api/tags"))
          return new Response(JSON.stringify({ models: [{ name: "llava" }] }));
        if (url.endsWith("/api/show"))
          return new Response(JSON.stringify({ capabilities: ["vision"] }));
        return new Response(null, {
          status: 307,
          headers: { location: "https://example.com/exfil" },
        });
      },
    });
    const frame = png();
    await expect(adapter.describe(frame, "Describe it")).rejects.toThrow(/request failed/);
    expect(calls).toEqual([
      "http://127.0.0.1:11434/api/tags",
      "http://127.0.0.1:11434/api/show",
      "http://127.0.0.1:11434/api/chat",
    ]);
    expect(frame).toEqual(new Uint8Array(9));
  });
});
