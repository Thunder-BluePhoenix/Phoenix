// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import type { AiProviderStatus, AiStatus } from "../src/core/types";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

export function provider(
  over: Partial<AiProviderStatus> & Pick<AiProviderStatus, "id" | "label">,
): AiProviderStatus {
  return {
    locality: "local",
    kind: "builtin",
    available: true,
    reason: null,
    key_policy: "none",
    key_set: false,
    default_model: null,
    base_url: null,
    models: null,
    models_error: null,
    ...over,
  };
}

export function aiStatus(over: Partial<AiStatus> = {}): AiStatus {
  return {
    enabled: true,
    preferred: null,
    cloud_opt_in: { public: false, internal: false, sensitive: false },
    external_processing_granted: false,
    routing: { chat: null, summaries: null, cleanup: null },
    endpoints: [],
    prices: {},
    providers: [
      provider({ id: "ollama", label: "Ollama (this device)", default_model: "llama3.2" }),
      provider({
        id: "openai",
        label: "OpenAI",
        locality: "cloud",
        kind: "preset",
        key_policy: "required",
        key_set: false,
        default_model: "gpt-default",
      }),
      provider({
        id: "anthropic",
        label: "Anthropic Claude",
        locality: "cloud",
        key_policy: "required",
        key_set: true,
        default_model: "claude-default",
      }),
    ],
    ...over,
  };
}

/** Renders `ui` inside a CoreProvider whose client talks to a fake Core. */
export function mountWith(ui: ReactNode, routes: Parameters<typeof fakeApi>[0] = {}) {
  FakeWebSocket.reset();
  const api = fakeApi(routes);
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  const view = render(<CoreProvider client={client}>{ui}</CoreProvider>);
  act(() => FakeWebSocket.last.open());
  return { api, ...view };
}
