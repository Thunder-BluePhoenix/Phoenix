// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { act, fireEvent, render, screen } from "@testing-library/react";
import { App } from "../src/App";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import type { AgentRunState, AgentTaskDetail, Confirmation } from "../src/core/types";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

export function mount(routes: Parameters<typeof fakeApi>[0] = {}) {
  window.location.hash = "";
  const api = fakeApi(routes);
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <App />
    </CoreProvider>,
  );
  const ws = FakeWebSocket.last;
  act(() => ws.open());
  return { api, ws };
}

export const openPanel = () => fireEvent.click(screen.getByRole("button", { name: /^Fawkes/ }));
export const openTab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
export const fawkesAvatar = () => screen.getByRole("button", { name: /^Fawkes/ });

export const petState = (state: string, explanation = "") => ({
  state,
  explanation: explanation || state,
  since: new Date().toISOString(),
  recording: false,
  sleeping: false,
});

/** A live event as the WebSocket delivers it. */
export function sendEvent(ws: FakeWebSocket, seq: number, event_type: string, payload = {}) {
  act(() =>
    ws.message("event.created", {
      seq,
      event: {
        event_id: `evt_${seq}aaaaaa`,
        event_type,
        source: "core",
        severity: "info",
        timestamp: "2026-10-09T12:00:00Z",
        payload,
      },
    }),
  );
}

export const TASK_ID = `task_${"a".repeat(32)}`;

export function taskDetail(
  state: AgentRunState,
  patch: Partial<AgentTaskDetail> = {},
): AgentTaskDetail {
  return {
    task: {
      id: TASK_ID,
      kind: "ci_failure",
      input: { repository: "acme/app", run_id: 7 },
      requested_by: "user",
      created_at: "2026-10-09T12:00:00Z",
      correlation_id: "corr_1",
    },
    run: {
      id: "run_1",
      state,
      agent_id: "ci-failure",
      agent_version: "1.0.0",
      created_at: "2026-10-09T12:00:00Z",
      updated_at: "2026-10-09T12:00:05Z",
      failure_reason: null,
    },
    steps: [],
    evidence: [],
    summary: null,
    diagnosis: null,
    proposals: [],
    ai_used: false,
    processed_by: null,
    model_calls: 0,
    verification: null,
    audit_ids: [],
    ...patch,
  };
}

export const taskSummary = (state: AgentRunState) => ({
  id: TASK_ID,
  kind: "ci_failure",
  state,
  title: "CI failure in acme/app",
  requested_by: "user",
  created_at: "2026-10-09T12:00:00Z",
  updated_at: "2026-10-09T12:00:05Z",
  failure_reason: null,
});

export function confirmation(patch: Partial<Confirmation> = {}): Confirmation {
  return {
    id: "conf_1",
    capabilityId: "mock",
    command: "write",
    summary: "Mock: write a note",
    sideEffect: "write",
    permissions: ["filesystem_write"],
    requestedAt: "2026-10-09T12:00:00Z",
    expiresAt: "2026-10-09T12:05:00Z",
    ...patch,
  };
}

declare global {
  // tsconfig.web.json still has lib ES2023, which lacks this ES2024 method; the runtime (Node 22,
  // current browsers) has it. Delete this block when that lib moves to ES2024.
  interface PromiseConstructor {
    withResolvers<T>(): {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  }
}
