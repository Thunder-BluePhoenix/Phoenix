// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 62 "attach a window" through the public HTTP API with a fake exec: the confirmation is
// required, nothing is stored by the capture itself, an accepted capture enters the tray as origin
// "window" within its cap of 3 and through the secret detector. No Mac, window or Accessibility grant
// was involved.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowExec, WindowExecResult } from "../src/window-capture";
import { startCore, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const SEP = "\u001e";
const reply = (title: string, text: string, app = "Numbers", bundle = "com.apple.iWork.Numbers") =>
  ({
    code: 0,
    stdout: [app, bundle, title, text].join(SEP),
    stderr: "",
    timedOut: false,
    outputCapped: false,
  }) satisfies WindowExecResult;

async function boot(
  next: () => WindowExecResult | Promise<WindowExecResult>,
  platform: NodeJS.Platform = "darwin",
) {
  const calls: string[][] = [];
  const windowExec: WindowExec = async (_f, argv) => {
    calls.push([...argv]);
    return next();
  };
  const core = await startCore(
    {},
    {
      runtime: { windowExec, windowPlatform: platform, windowCaptureLeadMs: 0 },
    },
  );
  cleanups.push(() => core.runtime.stop());
  return { core, calls };
}

/** Starts a capture, waits for the confirmation prompt, answers it. */
async function capture(core: TestCore, approve: boolean | "none") {
  const pending = core.api("POST", "/api/attachments/window/capture");
  if (approve === "none") return pending;
  await vi.waitFor(() => expect(core.runtime.permissions.pendingConfirmations()).toHaveLength(1));
  const prompt = core.runtime.permissions.pendingConfirmations()[0]!;
  core.runtime.permissions.resolveConfirmation(prompt.id, approve);
  return pending;
}

const attach = (core: TestCore, over: Record<string, unknown> = {}) =>
  core.api("POST", "/api/attachments", {
    name: "Numbers — Budget",
    kind: "text",
    mime: "text/plain",
    origin: "window",
    content: "Rent 900",
    ...over,
  });

describe("window capture route", () => {
  it("asks the user first, reads once after approval and stores nothing", async () => {
    const { core, calls } = await boot(() => reply("Budget", "Rent 900"));
    const pending = core.api("POST", "/api/attachments/window/capture");
    await vi.waitFor(() => expect(core.runtime.permissions.pendingConfirmations()).toHaveLength(1));
    expect(calls).toHaveLength(0); // nothing read before the user answers
    const prompt = core.runtime.permissions.pendingConfirmations()[0]!;
    expect(prompt).toMatchObject({ command: "attachment.window_capture", sideEffect: "execute" });
    expect(prompt.summary).not.toContain("Rent");
    core.runtime.permissions.resolveConfirmation(prompt.id, true);
    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      status: "captured",
      app: "Numbers",
      title: "Budget",
      text: "Rent 900",
      truncated: false,
      secret_kinds: [],
    });
    expect(calls).toHaveLength(1);
    const tray = await core.api("GET", "/api/attachments");
    expect(tray.json.attachments).toEqual([]);
    const audit = JSON.stringify((await core.api("GET", "/api/audit?limit=200")).json);
    expect(audit).not.toContain("Rent 900");
  });

  it("a declined confirmation reads nothing", async () => {
    const { core, calls } = await boot(() => reply("Budget", "Rent 900"));
    const res = await capture(core, false);
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("is refused when the emergency stop is engaged", async () => {
    const { core, calls } = await boot(() => reply("Budget", "x"));
    await core.api("POST", "/api/security/kill-switch", { engaged: true });
    const res = await core.api("POST", "/api/attachments/window/capture");
    expect([403, 409]).toContain(res.status);
    expect(calls).toHaveLength(0);
  });

  it("is refused off macOS before any prompt", async () => {
    const { core, calls } = await boot(() => reply("a", "b"), "linux");
    const res = await core.api("POST", "/api/attachments/window/capture");
    expect(res.status).toBe(503);
    expect(core.runtime.permissions.pendingConfirmations()).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("ignores any body: nothing the caller sends reaches the script", async () => {
    const { core, calls } = await boot(() => reply("Budget", "x"));
    const pending = core.api("POST", "/api/attachments/window/capture", {
      script: 'do shell script "id"',
      app: 'x" & quit',
    });
    await vi.waitFor(() => expect(core.runtime.permissions.pendingConfirmations()).toHaveLength(1));
    core.runtime.permissions.resolveConfirmation(
      core.runtime.permissions.pendingConfirmations()[0]!.id,
      true,
    );
    await pending;
    expect(calls[0]!.join("\n")).not.toContain('do shell script "id"');
    expect(calls[0]!.join("\n")).not.toContain('quit"');
  });

  it("reports accessibility_not_granted cleanly and does not retry", async () => {
    const { core, calls } = await boot(() => ({
      code: 1,
      stdout: "",
      stderr: "osascript is not allowed assistive access. (-25211)",
      timedOut: false,
      outputCapped: false,
    }));
    const res = await capture(core, true);
    expect(res.json).toEqual({ status: "accessibility_not_granted" });
    expect(calls).toHaveLength(1);
    expect(core.runtime.permissions.pendingConfirmations()).toHaveLength(0);
  });

  it("a timeout answers 504 and the outcome is audited as failed", async () => {
    const { core } = await boot(() => ({
      code: null,
      stdout: "",
      stderr: "",
      timedOut: true,
      outputCapped: false,
    }));
    const res = await capture(core, true);
    expect(res.status).toBe(504);
    const entries = (await core.api("GET", "/api/audit?limit=200")).json.entries as {
      action: string;
    }[];
    expect(entries.some((e) => e.action === "action.failed")).toBe(true);
  });

  it("Phoenix's own window comes back as phoenix_window with no text", async () => {
    const { core } = await boot(() =>
      reply("Chat", "private chat text", "Phoenix", "dev.phoenix.desktop"),
    );
    const res = await capture(core, true);
    expect(res.json).toEqual({ status: "phoenix_window" });
  });

  it("only one capture runs at a time", async () => {
    const { core } = await boot(() => reply("Budget", "x"));
    const first = core.api("POST", "/api/attachments/window/capture");
    await vi.waitFor(() => expect(core.runtime.permissions.pendingConfirmations()).toHaveLength(1));
    const second = await core.api("POST", "/api/attachments/window/capture");
    expect(second.status).toBe(409);
    core.runtime.permissions.resolveConfirmation(
      core.runtime.permissions.pendingConfirmations()[0]!.id,
      false,
    );
    await first;
  });

  it("flags secret kinds in the preview (kinds only)", async () => {
    const fakeToken = ["ghp", "_", "a".repeat(36)].join("");
    const { core } = await boot(() => reply("Notes", `token ${fakeToken}`));
    const res = await capture(core, true);
    expect(res.json.status).toBe("captured");
    expect(res.json.secret_kinds.length).toBeGreaterThan(0);
  });
});

describe("accepting a captured window into the tray", () => {
  it("enters as origin window", async () => {
    const { core } = await boot(() => reply("a", "b"));
    const res = await attach(core);
    expect(res.status).toBe(201);
    expect(res.json.origin).toBe("window");
  });

  it("the 4th window attachment is refused (cap 3 per tray)", async () => {
    const { core } = await boot(() => reply("a", "b"));
    for (let i = 0; i < 3; i++) expect((await attach(core, { name: `w${i}` })).status).toBe(201);
    const fourth = await attach(core, { name: "w3" });
    expect(fourth.status).toBe(400);
    expect(fourth.json.message).toMatch(/At most 3 attachments from "window"/);
  });

  it("window text that holds a secret is refused, naming the kind but not the value", async () => {
    const { core } = await boot(() => reply("a", "b"));
    const fakeToken = ["ghp", "_", "b".repeat(36)].join("");
    const res = await attach(core, { content: `notes ${fakeToken}` });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.json)).not.toContain(fakeToken);
    expect(JSON.stringify(res.json)).toMatch(/github_token/);
    expect((await core.api("GET", "/api/attachments")).json.attachments).toEqual([]);
  });

  it("the same text dropped as a file is not blocked here (the check is for window text only)", async () => {
    const { core } = await boot(() => reply("a", "b"));
    const fakeToken = ["ghp", "_", "c".repeat(36)].join("");
    expect((await attach(core, { origin: "drop", content: `notes ${fakeToken}` })).status).toBe(
      201,
    );
  });
});
