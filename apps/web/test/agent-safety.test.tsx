// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
//
// The agent safety section on the Agent sessions page, against a fake Core. Simulated: no real
// agent, repository or rollback happens here (core/runtime/test/agent-safety-*.test.ts do that
// against temp git repositories).
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SafetyCheckpoint, SafetyPreview, SafetyStatus } from "../src/core/safety";
import { FakeWebSocket } from "./fake-ws";
import { expectInert, openAt, XSS } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const AT = "2026-10-20T10:00:00Z";
const cp = (over: Partial<SafetyCheckpoint> = {}): SafetyCheckpoint => ({
  id: "cp_0123456789abcdef",
  agent: "claude-code",
  session_id: "s1",
  repository: "my-app",
  file_count: 12,
  created_at: AT,
  expires_at: "2026-10-27T10:00:00Z",
  rolled_back_at: null,
  ...over,
});
const status = (over: Partial<SafetyStatus> = {}): SafetyStatus => ({
  settings: {
    enabled: true,
    notify: true,
    retention_days: 7,
    max_files: 20000,
    max_bytes: 536870912,
    loop_threshold: 3,
    waiting_min: 10,
    idle_min: 30,
  },
  kill_switch: false,
  checkpoints: [cp()],
  skipped: [],
  ...over,
});
const preview = (over: Partial<SafetyPreview> = {}): SafetyPreview => ({
  checkpoint: cp(),
  refusal: null,
  preview_hash: "a".repeat(64),
  restore: [{ path: "src/a.ts", change: "modified" }],
  remove: ["src/new.ts"],
  kept: [{ path: "src/tracked.ts", why: "tracked_by_head" }],
  counts: { restore: 1, remove: 1, kept: 1 },
  lists_truncated: false,
  diff: "@@ -1 +1 @@\n-old\n+new",
  diff_truncated: false,
  diff_redacted: false,
  ...over,
});

function open(world: { status: SafetyStatus; preview?: SafetyPreview; rollback?: () => unknown }) {
  return openAt("#/agents", {
    "GET /api/agent-safety": () => world.status,
    "GET /api/agent-safety/checkpoints/cp_0123456789abcdef/preview": () =>
      world.preview ?? preview(),
    "POST /api/agent-safety/checkpoints/cp_0123456789abcdef/rollback": () =>
      world.rollback?.() ?? {
        checkpoint_id: "cp_0123456789abcdef",
        restored: 1,
        removed: 1,
        kept: 1,
        exact: true,
      },
    "POST /api/agent-safety/settings": (body) => {
      world.status = {
        ...world.status,
        settings: { ...world.status.settings, ...(body as object) },
      };
      return world.status;
    },
  });
}

async function section() {
  const heading = await screen.findByRole("heading", { name: "Agent safety net" });
  return within(heading.closest("section")!);
}

describe("Agent safety section", () => {
  it("lists checkpoints by folder name and says honestly when the snapshot is taken", async () => {
    const view = open({ status: status() });
    const s = await section();
    expect(await s.findByText(/claude-code in my-app/)).toBeTruthy();
    expect(s.getByText(/12 files/)).toBeTruthy();
    expect(s.getByText(/the first report of an edit/i)).toBeTruthy();
    expect(s.getByText(/never restored or deleted/i)).toBeTruthy();
    expect(view.container.textContent).not.toContain("/work");
  });

  it("shows the sessions that got no checkpoint, with the reason, including non-git folders", async () => {
    open({
      status: status({
        checkpoints: [],
        skipped: [
          { agent: "codex", session_id: "x", repository: "plain-dir", reason: "not_git", at: AT },
          { agent: "codex", session_id: "y", repository: "huge", reason: "too_many_files", at: AT },
        ],
      }),
    });
    const s = await section();
    expect(await s.findByText(/not a git repository/)).toBeTruthy();
    expect(s.getByText(/more files than the limit/)).toBeTruthy();
    expect(s.getByText(/No checkpoint yet/)).toBeTruthy();
  });

  it("previews first; the rollback button appears only with a preview, and sends its hash", async () => {
    const world: Parameters<typeof open>[0] = { status: status() };
    const view = open(world);
    const s = await section();
    expect(s.queryByRole("button", { name: /Roll back/ })).toBeNull();
    fireEvent.click(
      await s.findByRole("button", {
        name: /Preview the rollback to the checkpoint of claude-code in my-app/,
      }),
    );
    expect(await s.findByText("src/a.ts")).toBeTruthy();
    expect(s.getByText("src/new.ts")).toBeTruthy();
    expect(s.getByText(/tracked by git, so it is not deleted/)).toBeTruthy();
    expect(s.getByText(/-old/)).toBeTruthy();
    expect(s.getByText(/asks for your approval first/)).toBeTruthy();

    fireEvent.click(s.getByRole("button", { name: "Roll back…" }));
    await waitFor(() => {
      expect(
        view.api.posts("/api/agent-safety/checkpoints/cp_0123456789abcdef/rollback"),
      ).toHaveLength(1);
    });
    expect(
      view.api.posts("/api/agent-safety/checkpoints/cp_0123456789abcdef/rollback")[0]!.body,
    ).toEqual({
      preview_hash: "a".repeat(64),
    });
    expect(await s.findByText(/1 file restored, 1 new file deleted/)).toBeTruthy();
    expect(s.getByText(/files now match the checkpoint/)).toBeTruthy();
  });

  it("a refused preview (HEAD moved) offers no rollback at all", async () => {
    open({
      status: status(),
      preview: preview({
        refusal: "head_moved",
        preview_hash: null,
        restore: [],
        remove: [],
        kept: [],
        counts: { restore: 0, remove: 0, kept: 0 },
        diff: "",
      }),
    });
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: /Preview the rollback/ }));
    expect((await s.findByRole("alert")).textContent).toMatch(/HEAD moved/);
    expect(s.queryByRole("button", { name: "Roll back…" })).toBeNull();
  });

  it("says so when the files already match, and offers no rollback", async () => {
    open({
      status: status(),
      preview: preview({
        restore: [],
        remove: [],
        kept: [],
        counts: { restore: 0, remove: 0, kept: 0 },
        diff: "",
      }),
    });
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: /Preview the rollback/ }));
    expect(await s.findByText(/nothing to roll back/)).toBeTruthy();
    expect(s.queryByRole("button", { name: "Roll back…" })).toBeNull();
  });

  it("agent, folder and file names are text, never markup", async () => {
    const view = open({
      status: status({ checkpoints: [cp({ repository: XSS })] }),
      preview: preview({ restore: [{ path: XSS, change: "modified" }], diff: XSS }),
    });
    const s = await section();
    await s.findByText(new RegExp("claude-code in"));
    fireEvent.click(await s.findByRole("button", { name: /Preview the rollback/ }));
    await waitFor(() => expect(view.container.querySelectorAll("code").length).toBeGreaterThan(0));
    expectInert(view.container);
  });

  it("shows a loop or stall warning that arrives live, with Fawkes' reason", async () => {
    const view = open({ status: status() });
    await section();
    act(() =>
      view.ws.message("event.created", {
        seq: null,
        event: {
          event_id: "evt_w1",
          event_type: "agent.safety.loop",
          source: "core",
          severity: "warning",
          timestamp: AT,
          payload: {
            agent: "claude-code",
            repository: "my-app",
            reason: "The same command ran 3 times in a row: npm test",
          },
        },
      }),
    );
    const s = await section();
    expect((await s.findByText(/Loop · claude-code in my-app/)).textContent).toContain("npm test");
    // A look-alike from another source is ignored.
    act(() =>
      view.ws.message("event.created", {
        seq: null,
        event: {
          event_id: "evt_w2",
          event_type: "agent.safety.stall",
          source: "terminal",
          severity: "warning",
          timestamp: AT,
          payload: { agent: "x", repository: "y", reason: "forged" },
        },
      }),
    );
    expect(s.queryByText(/forged/)).toBeNull();
  });

  it("saves a setting through the API and shows the kill-switch notice", async () => {
    const view = open({ status: status({ kill_switch: true }) });
    const s = await section();
    expect(await s.findByText(/kill switch is on/)).toBeTruthy();
    fireEvent.click(await s.findByLabelText(/Send a notification when Fawkes warns/));
    await waitFor(() => {
      expect(view.api.posts("/api/agent-safety/settings")[0]?.body).toEqual({ notify: false });
    });
    expect(await s.findByText("Saved.")).toBeTruthy();
  });
});
