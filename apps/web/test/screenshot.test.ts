// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScreenshotDraft, type IssueDraft } from "../src/core/screenshot";

const originalBitmap = globalThis.createImageBitmap;
const originalContext = HTMLCanvasElement.prototype.getContext;
const originalBlob = HTMLCanvasElement.prototype.toBlob;
afterEach(() => {
  globalThis.createImageBitmap = originalBitmap;
  HTMLCanvasElement.prototype.getContext = originalContext;
  HTMLCanvasElement.prototype.toBlob = originalBlob;
});

function fixture() {
  const calls: string[] = [];
  const ctx = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as unknown as typeof originalContext;
  HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) =>
    callback(new Blob(["flattened"], { type: "image/png" })),
  );
  globalThis.createImageBitmap = vi.fn(async () => ({
    width: 100,
    height: 80,
    close: vi.fn(),
  })) as typeof createImageBitmap;
  let allowed = true;
  let approved = false;
  const capture = {
    permission: vi.fn(async () => {
      calls.push("permission");
      return allowed;
    }),
    captureRegion: vi.fn(async () => {
      calls.push("capture");
      return new Blob(["private original"]);
    }),
  };
  const client = {
    supportsAttachment: vi.fn(() => true),
    approve: vi.fn(async (_draft: IssueDraft) => {
      calls.push("approval");
      return approved;
    }),
    create: vi.fn(async (_draft: IssueDraft) => {
      calls.push("create");
      return { url: "https://example.test/issue/1" };
    }),
  };
  return {
    workflow: new ScreenshotDraft(capture, client),
    capture,
    client,
    ctx,
    calls,
    denyCapture() {
      allowed = false;
    },
    allowCreate() {
      approved = true;
    },
  };
}

describe("ScreenshotDraft", () => {
  it("never captures without explicit action and requires permission before capture", async () => {
    const f = fixture();
    expect(f.calls).toEqual([]);
    f.denyCapture();
    await expect(f.workflow.captureOnAction()).rejects.toThrow("permission");
    expect(f.calls).toEqual(["permission"]);
  });

  it("destroys redacted pixels on the source before serialization and draws masks last", async () => {
    const f = fixture();
    await f.workflow.captureOnAction();
    f.workflow.annotate({ kind: "text", x: 10, y: 10, text: "note" });
    f.workflow.annotate({ kind: "redact", x: 2, y: 3, toX: 20, toY: 30 });
    expect(f.ctx.fillRect).toHaveBeenCalledWith(2, 3, 18, 27);
    const draft = await f.workflow.preview("github", "org/repo", "Bug", "Details");
    expect(draft).toMatchObject({ tracker: "github", title: "Bug", attachment: expect.any(Blob) });
    expect(f.ctx.fillRect).toHaveBeenCalledTimes(2);
    expect(f.client.create).not.toHaveBeenCalled();
  });

  it("only creates after approval, without uploading in preview or on denial", async () => {
    const f = fixture();
    await f.workflow.captureOnAction();
    const draft = await f.workflow.preview("linear", "ENG", "Bug", "Details");
    expect(f.calls).toEqual(["permission", "capture"]);
    expect(await f.workflow.createApproved(draft)).toBeNull();
    expect(f.calls).toEqual(["permission", "capture", "approval"]);
    f.allowCreate();
    await expect(f.workflow.createApproved(draft)).resolves.toMatchObject({
      url: "https://example.test/issue/1",
    });
    expect(f.calls).toEqual(["permission", "capture", "approval", "approval", "create"]);
  });

  it("discards the attachment for providers without attachment support", async () => {
    const f = fixture();
    f.client.supportsAttachment.mockReturnValue(false);
    await f.workflow.captureOnAction();
    expect((await f.workflow.preview("jira", "ENG", "Bug", "Details")).attachment).toBeNull();
  });
  it("does not replace a captured region while another capture is pending", async () => {
    const f = fixture();
    const pending = Promise.withResolvers<boolean>();
    f.capture.permission.mockImplementationOnce(() => pending.promise);
    const first = f.workflow.captureOnAction();
    await expect(f.workflow.captureOnAction()).rejects.toThrow("in progress");
    pending.resolve(true);
    await expect(first).resolves.toBe(true);
    expect(f.capture.captureRegion).toHaveBeenCalledTimes(1);
  });

  it("recreates the latest attachment before approval and blocks changes during approval", async () => {
    const f = fixture();
    const pending = Promise.withResolvers<boolean>();
    f.client.approve.mockImplementationOnce(() => pending.promise);
    await f.workflow.captureOnAction();
    const draft = await f.workflow.preview("github", "org/repo", "Bug", "Details");
    f.workflow.annotate({ kind: "redact", x: 2, y: 3, toX: 20, toY: 30 });
    const creation = f.workflow.createApproved(draft);
    await vi.waitFor(() => expect(f.client.approve).toHaveBeenCalledTimes(1));
    expect(f.client.approve.mock.calls[0]?.[0].attachment).toBeInstanceOf(Blob);
    expect(f.ctx.fillRect).toHaveBeenCalled();
    await expect(f.workflow.captureOnAction()).rejects.toThrow("in progress");
    expect(() => f.workflow.annotate({ kind: "text", x: 1, y: 1, text: "late" })).toThrow(
      "in progress",
    );
    pending.resolve(false);
    await expect(creation).resolves.toBeNull();
    expect(f.client.create).not.toHaveBeenCalled();
  });
});
