// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { act, render } from "@testing-library/react";
import { expect } from "vitest";
import { App } from "../src/App";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import type { CapabilityView } from "../src/core/types";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

/** Mounts the whole app at `hash` against a fake Core. */
export function openAt(hash: string, routes: Parameters<typeof fakeApi>[0] = {}) {
  window.location.hash = hash;
  const api = fakeApi(routes);
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  const view = render(
    <CoreProvider client={client}>
      <App />
    </CoreProvider>,
  );
  const ws = FakeWebSocket.last;
  act(() => ws.open());
  return { api, ws, container: view.container };
}

/** Two synchronous clicks inside one act(): nothing re-renders between them, like a fast double click. */
export function doubleClick(click: () => void) {
  act(() => {
    click();
    click();
  });
}

export const XSS = '<img src=x onerror="alert(1)"><script>alert(2)</script>';

/** The page contains the string as text and created no element from it. */
export function expectInert(container: HTMLElement) {
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("script")).toBeNull();
  expect(container.textContent).toContain(XSS);
}

export const capability = (
  id: string,
  status: CapabilityView["status"],
  config: Record<string, unknown> = {},
): CapabilityView => ({
  id,
  name: id,
  version: "0.1.0",
  description: id,
  kind: "builtin",
  status,
  health: { status: "healthy" },
  permissions: [],
  commands: [],
  data_categories: [],
  config,
});

export function sendEvent(
  ws: FakeWebSocket,
  seq: number,
  event_type: string,
  extra: { correlation_id?: string } = {},
) {
  act(() =>
    ws.message("event.created", {
      seq,
      event: {
        event_id: `evt_${seq}aaaaaa`,
        event_type,
        source: "core",
        severity: "info",
        timestamp: "2026-10-09T12:00:00Z",
        payload: {},
        ...extra,
      },
    }),
  );
}
