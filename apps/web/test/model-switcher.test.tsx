// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AnswerView } from "../src/components/AnswerView";
import { ModelSwitcher } from "../src/components/ModelSwitcher";
import type { AiProviderStatus, AiRoute, AiStatus, MemoryAnswer } from "../src/core/types";
import { aiStatus, mountWith, provider } from "./ai-fixtures";

afterEach(() => cleanup());

interface Settings {
  routing?: { chat?: { provider: string; model?: string } | null };
}

/** A Core whose routing.chat follows what the switcher POSTs, with an optional model list. */
function core(
  initial: AiStatus = aiStatus(),
  models: Record<string, () => Partial<AiProviderStatus>> = {},
) {
  let current = initial;
  return {
    "GET /api/ai/status": (_body: unknown, url: URL) => {
      const asked = url.searchParams.get("models");
      if (!asked) return current;
      const fn = models[asked];
      return {
        ...current,
        providers: current.providers.map((p) => (p.id === asked && fn ? { ...p, ...fn() } : p)),
      };
    },
    "POST /api/ai/settings": (body: unknown) => {
      const chat = (body as Settings).routing?.chat;
      if (chat !== undefined) {
        const route: AiRoute | null = chat
          ? { provider: chat.provider, model: chat.model ?? null }
          : null;
        current = { ...current, routing: { ...current.routing, chat: route } };
      }
      return current;
    },
  };
}

const button = () => screen.getByRole("button", { name: /^Model:/ });

describe("ModelSwitcher", () => {
  it("shows Automatic when no chat route is set, and the model and provider otherwise", async () => {
    mountWith(<ModelSwitcher />, core());
    expect((await screen.findByRole("button", { name: /Automatic/ })).textContent).toBe(
      "Model: Automatic (on this device first)",
    );
    cleanup();
    mountWith(
      <ModelSwitcher />,
      core(
        aiStatus({
          routing: { chat: { provider: "ollama", model: null }, summaries: null, cleanup: null },
        }),
      ),
    );
    expect((await screen.findByRole("button", { name: /llama3\.2/ })).textContent).toBe(
      "Model: llama3.2 · Ollama (this device)",
    );
  });

  it("is a disabled loading button until the status arrives, and says when AI is off", async () => {
    mountWith(<ModelSwitcher />, core(aiStatus({ enabled: false })));
    expect(
      (screen.getByRole("button", { name: "Model: loading…" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(await screen.findByText("AI is off")).toBeTruthy();
  });

  it("renders nothing when the status cannot be read", async () => {
    const { api, container } = mountWith(<ModelSwitcher />);
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/ai/status")).toBe(true));
    await waitFor(() => expect(container.querySelector(".model-switcher")).toBeNull());
  });

  it("opens a keyboard-driven listbox and returns focus on Escape", async () => {
    mountWith(<ModelSwitcher />, core());
    const trigger = await screen.findByRole("button", { name: /Automatic/ });
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const list = screen.getByRole("listbox", { name: "Providers" });
    await waitFor(() => expect(document.activeElement).toBe(list));
    const options = within(list).getAllByRole("option");
    expect(options.map((o) => o.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
      "false",
    ]);
    expect(list.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(list.getAttribute("aria-activedescendant")).toBe(options[1]?.id);
    fireEvent.keyDown(list, { key: "End" });
    expect(list.getAttribute("aria-activedescendant")).toBe(options[3]?.id);
    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(list.getAttribute("aria-activedescendant")).toBe(options[2]?.id);
    fireEvent.keyDown(list, { key: "Home" });
    expect(list.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
    fireEvent.keyDown(list, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes when you click outside", async () => {
    mountWith(<ModelSwitcher />, core());
    fireEvent.click(await screen.findByRole("button", { name: /Automatic/ }));
    expect(screen.getByRole("listbox", { name: "Providers" })).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("labels where each provider runs and flags a missing key, which stays selectable", async () => {
    mountWith(<ModelSwitcher />, core());
    fireEvent.click(await screen.findByRole("button", { name: /Automatic/ }));
    const list = screen.getByRole("listbox", { name: "Providers" });
    const ollama = within(within(list).getByText("Ollama (this device)").closest("li")!);
    expect(ollama.getByText("On this device")).toBeTruthy();
    expect(ollama.queryByText("Key missing")).toBeNull();
    const openai = within(within(list).getByText("OpenAI").closest("li")!);
    expect(openai.getByText("Cloud (leaves this device)")).toBeTruthy();
    expect(openai.getByText("Key missing")).toBeTruthy();
    expect(openai.getByText(/Add the key in Settings, AI providers/)).toBeTruthy();
    const claude = within(within(list).getByText("Anthropic Claude").closest("li")!);
    expect(claude.queryByText("Key missing")).toBeNull();
  });

  it("chooses a provider by keyboard and posts exactly {routing:{chat:{provider}}}", async () => {
    const { api } = mountWith(<ModelSwitcher />, core());
    fireEvent.click(await screen.findByRole("button", { name: /Automatic/ }));
    const list = screen.getByRole("listbox", { name: "Providers" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    await waitFor(() =>
      expect(api.posts("/api/ai/settings")[0]?.body).toEqual({
        routing: { chat: { provider: "openai" } },
      }),
    );
    await waitFor(() => expect(button().textContent).toBe("Model: gpt-default · OpenAI"));
    expect(await screen.findByRole("listbox", { name: "Models" })).toBeTruthy();
  });

  it("chooses Automatic by clicking and posts {routing:{chat:null}}", async () => {
    const { api } = mountWith(
      <ModelSwitcher />,
      core(
        aiStatus({
          routing: { chat: { provider: "ollama", model: null }, summaries: null, cleanup: null },
        }),
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: /llama3\.2/ }));
    fireEvent.click(await screen.findByRole("option", { name: /Automatic/ }));
    await waitFor(() =>
      expect(api.posts("/api/ai/settings")[0]?.body).toEqual({ routing: { chat: null } }),
    );
    await waitFor(() =>
      expect(button().textContent).toBe("Model: Automatic (on this device first)"),
    );
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("loads the model list on demand with ?models= and posts the chosen model", async () => {
    const { api } = mountWith(
      <ModelSwitcher />,
      core(
        aiStatus({
          routing: { chat: { provider: "ollama", model: null }, summaries: null, cleanup: null },
        }),
        {
          ollama: () => ({
            models: [
              { id: "llama3.2", kind: "chat" },
              { id: "nomic-embed-text", kind: "embed" },
              { id: "qwen2.5", kind: "chat" },
            ],
          }),
        },
      ),
    );
    const trigger = await screen.findByRole("button", { name: /llama3\.2/ });
    // Nothing is listed until the popup is opened.
    expect(api.calls.some((c) => c.path.includes("models="))).toBe(false);
    fireEvent.click(trigger);
    const models = await screen.findByRole("listbox", { name: "Models" });
    expect(await within(models).findByRole("option", { name: "qwen2.5" })).toBeTruthy();
    expect(api.calls.some((c) => c.path === "/api/ai/status?models=ollama")).toBe(true);
    expect(within(models).queryByText("nomic-embed-text")).toBeNull();
    fireEvent.click(within(models).getByRole("option", { name: "qwen2.5" }));
    await waitFor(() =>
      expect(api.posts("/api/ai/settings")[0]?.body).toEqual({
        routing: { chat: { provider: "ollama", model: "qwen2.5" } },
      }),
    );
    await waitFor(() => expect(button().textContent).toBe("Model: qwen2.5 · Ollama (this device)"));
  });

  it("shows the provider's reason when it cannot list models, and keeps the default", async () => {
    mountWith(
      <ModelSwitcher />,
      core(
        aiStatus({
          routing: { chat: { provider: "ollama", model: null }, summaries: null, cleanup: null },
        }),
        {
          ollama: () => ({ models: null, models_error: "Connection refused" }),
        },
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: /llama3\.2/ }));
    expect(await screen.findByText(/Could not list models: Connection refused/)).toBeTruthy();
    const models = screen.getByRole("listbox", { name: "Models" });
    expect(within(models).getAllByRole("option")).toHaveLength(1);
    expect(within(models).getByText("Default (llama3.2)")).toBeTruthy();
  });

  it("shows a loading state while models load", async () => {
    const pending = Promise.withResolvers<unknown>();
    const routes = core(
      aiStatus({
        routing: { chat: { provider: "ollama", model: null }, summaries: null, cleanup: null },
      }),
    );
    const plain = routes["GET /api/ai/status"];
    mountWith(<ModelSwitcher />, {
      ...routes,
      "GET /api/ai/status": async (body: unknown, url: URL) => {
        if (url.searchParams.get("models")) await pending.promise;
        return plain(body, url);
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: /llama3\.2/ }));
    expect(await screen.findByText("Loading models…")).toBeTruthy();
    pending.resolve(null);
    await waitFor(() => expect(screen.queryByText("Loading models…")).toBeNull());
  });

  it("shows a failed save as an alert and keeps the old route", async () => {
    mountWith(<ModelSwitcher />, {
      ...core(),
      "POST /api/ai/settings": () =>
        new Response(JSON.stringify({ code: "VALIDATION_ERROR", message: "Unknown provider" }), {
          status: 400,
        }),
    });
    fireEvent.click(await screen.findByRole("button", { name: /Automatic/ }));
    fireEvent.click(await screen.findByRole("option", { name: /OpenAI/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("Unknown provider");
    expect(button().textContent).toBe("Model: Automatic (on this device first)");
  });

  it("uses a provider-free fallback label when the provider has no default model", async () => {
    mountWith(
      <ModelSwitcher />,
      core(
        aiStatus({
          routing: { chat: { provider: "custom", model: null }, summaries: null, cleanup: null },
          providers: [provider({ id: "custom", label: "My server", kind: "custom" })],
        }),
      ),
    );
    expect((await screen.findByRole("button", { name: /My server/ })).textContent).toBe(
      "Model: default model · My server",
    );
  });
});

const answer = (patch: Partial<MemoryAnswer> = {}): MemoryAnswer => ({
  facts: [],
  retrieved_evidence: [],
  stored_interpretations: [],
  interpretation_classification: "hypothesis",
  retrieval: { mode: "lexical" },
  interpretation: "The router change looks routine.",
  processed_by: "Ollama (this device) · llama3.2",
  ai_used: true,
  note: null,
  ...patch,
});

const attribution = (a: MemoryAnswer) => {
  mountWith(<AnswerView answer={a} />);
  return document.querySelector(".memory-attribution")?.textContent ?? null;
};

describe("AnswerView attribution", () => {
  it("says a local answer was free and on this device", () => {
    expect(
      attribution(
        answer({
          model: "llama3.2",
          provider: "ollama",
          provider_label: "Ollama (this device)",
          locality: "local",
          cost: null,
        }),
      ),
    ).toBe("Answered by llama3.2 via Ollama (this device) · on this device · free, on this device");
    expect(
      screen.getByText(/Generated hypothesis by Ollama \(this device\) · llama3\.2/),
    ).toBeTruthy();
  });

  it("gives a cloud answer's cost from the user's prices", () => {
    expect(
      attribution(
        answer({
          model: "gpt-x",
          provider: "openai",
          provider_label: "OpenAI",
          locality: "cloud",
          cost: { amount: 0.0123456789, currency: "USD", basis: "user-configured prices" },
        }),
      ),
    ).toBe(
      "Answered by gpt-x via OpenAI · in the cloud (leaves this device) · about $0.01 (from your prices)",
    );
  });

  it("formats costs: two decimals from one cent, up to six significant digits below", () => {
    expect(
      attribution(
        answer({
          model: "m",
          provider: "openai",
          locality: "cloud",
          cost: { amount: 1.5, currency: "USD", basis: "user-configured prices" },
        }),
      ),
    ).toBe(
      "Answered by m via openai · in the cloud (leaves this device) · about $1.50 (from your prices)",
    );
    cleanup();
    expect(
      attribution(
        answer({
          model: "m",
          provider: "openai",
          locality: "cloud",
          cost: { amount: 0.000012345678, currency: "USD", basis: "user-configured prices" },
        }),
      ),
    ).toBe(
      "Answered by m via openai · in the cloud (leaves this device) · about $0.0000123457 (from your prices)",
    );
  });

  it("says cost unknown for a cloud answer without prices", () => {
    expect(
      attribution(
        answer({
          model: "gpt-x",
          provider: "openai",
          provider_label: "OpenAI",
          locality: "cloud",
          cost: null,
        }),
      ),
    ).toBe("Answered by gpt-x via OpenAI · in the cloud (leaves this device) · cost unknown");
  });

  it.each([Infinity, NaN, -Infinity])(
    "shows cost unknown, never %s, when the amount is not a finite number",
    (amount) => {
      const text = attribution(
        answer({
          model: "gpt-x",
          provider: "openai",
          provider_label: "OpenAI",
          locality: "cloud",
          cost: { amount, currency: "USD", basis: "user-configured prices" },
        }),
      );
      expect(text).toBe(
        "Answered by gpt-x via OpenAI · in the cloud (leaves this device) · cost unknown",
      );
      cleanup();
    },
  );

  it("shows only processed_by for an older answer", () => {
    expect(attribution(answer())).toBeNull();
    expect(
      screen.getByText(/Generated hypothesis by Ollama \(this device\) · llama3\.2/),
    ).toBeTruthy();
  });
});
