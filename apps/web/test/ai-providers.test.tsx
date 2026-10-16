// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AiSettings } from "../src/components/MemorySettings";
import type { AiStatus } from "../src/core/types";
import { aiStatus, mountWith } from "./ai-fixtures";

afterEach(() => cleanup());

type Routes = Parameters<typeof mountWith>[1];

function setup(status: AiStatus = aiStatus(), extra: Routes = {}) {
  return mountWith(<AiSettings />, { "GET /api/ai/status": () => status, ...extra });
}

const providers = async () => within(await screen.findByRole("list", { name: "AI providers" }));
const row = async (label: string) => within((await providers()).getByText(label).closest("li")!);

describe("AI providers: list", () => {
  it("shows locality, availability and key state for every provider", async () => {
    setup(
      aiStatus({
        providers: [
          ...aiStatus().providers,
          {
            ...aiStatus().providers[0]!,
            id: "lmstudio",
            label: "LM Studio",
            available: false,
            reason: "Not running",
          },
        ],
      }),
    );
    expect((await screen.findByRole("heading", { name: "AI providers", level: 3 })).tagName).toBe(
      "H3",
    );
    const ollama = await row("Ollama (this device)");
    expect(ollama.getByText("On this device")).toBeTruthy();
    expect(ollama.getByText("Available")).toBeTruthy();
    expect(ollama.getByText("No key needed")).toBeTruthy();
    const openai = await row("OpenAI");
    expect(openai.getByText("Cloud (leaves this device)")).toBeTruthy();
    expect(openai.getByText("Key missing")).toBeTruthy();
    expect((await row("Anthropic Claude")).getByText("Key set")).toBeTruthy();
    expect((await row("LM Studio")).getByText("Not available: Not running")).toBeTruthy();
  });
});

describe("AI providers: keys", () => {
  it("saves a key to the per-provider route, clears the input and never shows it again", async () => {
    const { api } = setup();
    const secret = ["not", "a", "real", "key", "9"].join("-");
    fireEvent.click(await (await row("OpenAI")).findByRole("button", { name: "Set key" }));
    const input = (await screen.findByLabelText("OpenAI API key")) as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.autocomplete).toBe("off");
    expect(input.maxLength).toBe(8192);
    expect(
      (screen.getByRole("button", { name: "Save OpenAI key" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(input, { target: { value: secret } });
    fireEvent.click(screen.getByRole("button", { name: "Save OpenAI key" }));
    await waitFor(() =>
      expect(api.posts("/api/ai/providers/openai/secret")[0]?.body).toEqual({ value: secret }),
    );
    expect(await screen.findByText(/Key set\. It is stored in your OS keychain/)).toBeTruthy();
    expect(input.value).toBe("");
    expect(document.body.innerHTML).not.toContain(secret);
    expect(JSON.stringify(api.calls.filter((c) => c.method === "GET"))).not.toContain(secret);
    expect(api.calls.some((c) => c.path === "/api/ai/secret")).toBe(false);
  });

  it("offers Replace key when a key is set, and no key button when none is needed", async () => {
    setup();
    expect(
      (await row("Anthropic Claude")).getByRole("button", { name: "Replace key" }),
    ).toBeTruthy();
    expect((await row("Ollama (this device)")).queryByRole("button", { name: /key/i })).toBeNull();
  });

  it("removes a key with DELETE on the per-provider route", async () => {
    const { api } = setup(aiStatus(), { "DELETE /api/ai/providers/anthropic/secret": () => ({}) });
    fireEvent.click(
      await (await row("Anthropic Claude")).findByRole("button", { name: "Replace key" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Remove Anthropic Claude key" }));
    await waitFor(() =>
      expect(
        api.calls.some(
          (c) => c.method === "DELETE" && c.path === "/api/ai/providers/anthropic/secret",
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("Key removed from your keychain.")).toBeTruthy();
    expect(api.calls.some((c) => c.path === "/api/ai/secret")).toBe(false);
  });

  it("shows a failed key save as an alert", async () => {
    setup(aiStatus(), {
      "POST /api/ai/providers/openai/secret": () =>
        new Response(
          JSON.stringify({ code: "VALIDATION_ERROR", message: "Key must be one line" }),
          {
            status: 400,
          },
        ),
    });
    fireEvent.click(await (await row("OpenAI")).findByRole("button", { name: "Set key" }));
    fireEvent.change(await screen.findByLabelText("OpenAI API key"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Save OpenAI key" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Key must be one line");
  });
});

const endpoint = (id: string, over: Partial<AiStatus["endpoints"][number]> = {}) => ({
  id,
  label: `Server ${id}`,
  base_url: "https://api.example.org/v1",
  preset: null,
  locality: "cloud" as const,
  ...over,
});

describe("AI providers: custom endpoints", () => {
  const fill = async (id: string, name: string, url: string) => {
    fireEvent.change(await screen.findByLabelText("Id"), { target: { value: id } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } });
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: url } });
  };

  it("adds an endpoint by posting the whole list", async () => {
    const { api } = setup(aiStatus({ endpoints: [endpoint("first")] }));
    await fill("second", "My server", "https://llm.example.org/v1");
    expect(screen.getByText("This address is in the cloud (leaves this device).")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Preset (optional)"), { target: { value: "openai" } });
    fireEvent.click(screen.getByRole("button", { name: "Add endpoint" }));
    await waitFor(() =>
      expect(api.posts("/api/ai/settings")[0]?.body).toEqual({
        endpoints: [
          { id: "first", label: "Server first", base_url: "https://api.example.org/v1" },
          {
            id: "second",
            label: "My server",
            base_url: "https://llm.example.org/v1",
            preset: "openai",
          },
        ],
      }),
    );
  });

  it("derives on this device for a loopback address", async () => {
    setup();
    await fill("home", "Home box", "http://127.0.0.1:8080/v1");
    expect(screen.getByText("This address is on this device.")).toBeTruthy();
  });

  it("rejects plain http to a non-loopback host locally and sends nothing", async () => {
    const { api } = setup();
    await fill("remote", "Remote", "http://llm.example.org/v1");
    expect(
      screen.getAllByText("Use https; plain http is only allowed for this computer.").length,
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Add endpoint" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Use https; plain http is only allowed for this computer.",
    );
    expect(api.posts("/api/ai/settings")).toHaveLength(0);
  });

  it("rejects a bad id locally", async () => {
    const { api } = setup();
    await fill("Bad Id", "Remote", "https://llm.example.org/v1");
    fireEvent.click(screen.getByRole("button", { name: "Add endpoint" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/lowercase letters/);
    expect(api.posts("/api/ai/settings")).toHaveLength(0);
  });

  it("removes an endpoint by posting the rest of the list", async () => {
    const { api } = setup(aiStatus({ endpoints: [endpoint("first"), endpoint("second")] }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove endpoint Server first" }));
    await waitFor(() =>
      expect(api.posts("/api/ai/settings")[0]?.body).toEqual({
        endpoints: [
          { id: "second", label: "Server second", base_url: "https://api.example.org/v1" },
        ],
      }),
    );
  });

  it("stops offering the form at eight endpoints", async () => {
    setup(aiStatus({ endpoints: Array.from({ length: 8 }, (_, i) => endpoint(`srv-${i}`)) }));
    await screen.findByRole("list", { name: "Custom endpoints" });
    expect(screen.queryByRole("button", { name: "Add endpoint" })).toBeNull();
  });
});

describe("AI providers: routing", () => {
  it("posts a provider and model for one category", async () => {
    const { api } = setup();
    fireEvent.change(await screen.findByLabelText("Summaries provider"), {
      target: { value: "openai" },
    });
    fireEvent.change(screen.getByLabelText("Summaries model (optional)"), {
      target: { value: " gpt-big " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save summaries route" }));
    await waitFor(() =>
      expect(api.posts("/api/ai/settings")[0]?.body).toEqual({
        routing: { summaries: { provider: "openai", model: "gpt-big" } },
      }),
    );
  });

  it("omits the model when empty, and null clears the category", async () => {
    const { api } = setup(
      aiStatus({
        routing: {
          chat: null,
          summaries: null,
          cleanup: { provider: "ollama", model: "llama3.2" },
        },
      }),
    );
    fireEvent.change(await screen.findByLabelText("Chat provider"), {
      target: { value: "anthropic" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save chat route" }));
    await waitFor(() =>
      expect(api.posts("/api/ai/settings")[0]?.body).toEqual({
        routing: { chat: { provider: "anthropic" } },
      }),
    );
    expect((screen.getByLabelText("Cleanup provider") as HTMLSelectElement).value).toBe("ollama");
    fireEvent.change(screen.getByLabelText("Cleanup provider"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save cleanup route" }));
    await waitFor(() =>
      expect(api.posts("/api/ai/settings")[1]?.body).toEqual({ routing: { cleanup: null } }),
    );
  });

  it("explains that a cloud route still needs the permission and the opt-in", async () => {
    setup();
    expect(
      await screen.findByText(
        /A cloud route still needs the permission to send data to external AI/,
      ),
    ).toBeTruthy();
  });
});

describe("AI providers: prices", () => {
  const fillRow = (n: number, key: string, input: string, output: string) => {
    fireEvent.change(screen.getByLabelText(`Model key, row ${n}`), { target: { value: key } });
    fireEvent.change(screen.getByLabelText(`Input $ per 1M tokens, row ${n}`), {
      target: { value: input },
    });
    fireEvent.change(screen.getByLabelText(`Output $ per 1M tokens, row ${n}`), {
      target: { value: output },
    });
  };

  it("says Phoenix has no built-in prices", async () => {
    setup();
    expect(
      await screen.findByText(
        "Phoenix has no built-in prices. Costs are shown only from the numbers you enter.",
      ),
    ).toBeTruthy();
  });

  it("posts the full price map, including rows already saved", async () => {
    const { api } = setup(
      aiStatus({ prices: { "openai:gpt-a": { input_per_mtok: 1, output_per_mtok: 2 } } }),
    );
    expect(((await screen.findByLabelText("Model key, row 1")) as HTMLInputElement).value).toBe(
      "openai:gpt-a",
    );
    fireEvent.click(screen.getByRole("button", { name: "Add price" }));
    fillRow(2, "anthropic:claude-x", "3.5", "0");
    fireEvent.click(screen.getByRole("button", { name: "Save prices" }));
    await waitFor(() =>
      expect(api.posts("/api/ai/settings")[0]?.body).toEqual({
        prices: {
          "openai:gpt-a": { input_per_mtok: 1, output_per_mtok: 2 },
          "anthropic:claude-x": { input_per_mtok: 3.5, output_per_mtok: 0 },
        },
      }),
    );
  });

  it("removes a row and posts the remaining map", async () => {
    const { api } = setup(
      aiStatus({
        prices: {
          "openai:a": { input_per_mtok: 1, output_per_mtok: 2 },
          "openai:b": { input_per_mtok: 3, output_per_mtok: 4 },
        },
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Remove price row 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Save prices" }));
    await waitFor(() =>
      expect(api.posts("/api/ai/settings")[0]?.body).toEqual({
        prices: { "openai:b": { input_per_mtok: 3, output_per_mtok: 4 } },
      }),
    );
  });

  it.each([
    ["a negative number", "-1", "2"],
    ["text", "abc", "2"],
    ["an empty price", "", "2"],
  ])("rejects %s locally", async (_name, input, output) => {
    const { api } = setup();
    await screen.findByRole("button", { name: "Add price" });
    fireEvent.click(screen.getByRole("button", { name: "Add price" }));
    fillRow(1, "openai:gpt-a", input, output);
    fireEvent.click(screen.getByRole("button", { name: "Save prices" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /must be numbers that are zero or more/,
    );
    expect(api.posts("/api/ai/settings")).toHaveLength(0);
  });

  it("rejects a model key without a provider", async () => {
    const { api } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Add price" }));
    fillRow(1, "gpt-a", "1", "2");
    fireEvent.click(screen.getByRole("button", { name: "Save prices" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/provider:model/);
    expect(api.posts("/api/ai/settings")).toHaveLength(0);
  });
});
