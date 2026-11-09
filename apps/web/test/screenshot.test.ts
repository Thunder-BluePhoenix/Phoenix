// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttachImageError, type AttachRequest } from "../src/core/issue-attach";
import { ScreenshotDraft, type IssueDraft, type IssueTracker } from "../src/core/screenshot";

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
    supportsAttachment: vi.fn((_tracker: IssueTracker) => true),
    approve: vi.fn(async (_draft: IssueDraft) => {
      calls.push("approval");
      return approved;
    }),
    attach: vi.fn(async (_request: AttachRequest) => {
      calls.push("attach");
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

  it("destroys redacted pixels on the source and draws masks last when the image is flattened", async () => {
    const f = fixture();
    await f.workflow.captureOnAction();
    f.workflow.annotate({ kind: "text", x: 10, y: 10, text: "note" });
    f.workflow.annotate({ kind: "redact", x: 2, y: 3, toX: 20, toY: 30 });
    expect(f.ctx.fillRect).toHaveBeenCalledWith(2, 3, 18, 27);
    const draft = await f.workflow.preview("github", "org/repo", "Bug", "Details");
    // The issue draft is text only: the image is never a part of it.
    expect(draft).toEqual({
      tracker: "github",
      project: "org/repo",
      title: "Bug",
      body: "Details",
    });
    // Preview renders nothing: the image is flattened only for an attachment the person asked for.
    expect(f.ctx.fillRect).toHaveBeenCalledTimes(1);
    f.client.supportsAttachment.mockReturnValue(true);
    flattenTo(png());
    await f.workflow.prepareAttachment("linear", "ENG-1");
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
    expect(f.client.approve.mock.calls[0]?.[0]).not.toHaveProperty("attachment");
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

/** A whole PNG (signature, IHDR, IEND); the page checks structure, not pixels. */
function png(pad = 0): Blob {
  const ihdr = new Uint8Array(25);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 13);
  ihdr.set([0x49, 0x48, 0x44, 0x52], 4);
  view.setUint32(8, 4);
  view.setUint32(12, 4);
  return new Blob(
    [
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ihdr,
      new Uint8Array(pad).fill(7),
      Uint8Array.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
    ],
    { type: "image/png" },
  );
}
const flattenTo = (blob: Blob) => {
  HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) => callback(blob));
};

describe("attaching the redacted image after the issue exists", () => {
  it("is offered for Linear and Jira only, and only with a client that can attach", async () => {
    const f = fixture();
    f.client.supportsAttachment.mockImplementation((t) => t !== "github");
    expect(f.workflow.canAttach("linear")).toBe(true);
    expect(f.workflow.canAttach("jira")).toBe(true);
    expect(f.workflow.canAttach("github")).toBe(false);
    await f.workflow.captureOnAction();
    await expect(f.workflow.prepareAttachment("github" as never, "ENG-1")).rejects.toThrow(
      "cannot take an attachment",
    );
    expect(f.client.attach).not.toHaveBeenCalled();
  });

  it("preparing shows the generated name, size and hash and sends nothing", async () => {
    const f = fixture();
    f.client.supportsAttachment.mockImplementation((t) => t !== "github");
    await f.workflow.captureOnAction();
    const image = png(100);
    flattenTo(image);
    const prepared = await f.workflow.prepareAttachment("linear", "ENG-12");
    const bytes = new Uint8Array(await image.arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const prefix = [...digest]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 12);
    expect(prepared.details).toEqual({
      tracker: "linear",
      issue: "ENG-12",
      fileName: `phoenix-screenshot-${prefix}.png`,
      bytes: bytes.length,
      sha256Prefix: prefix,
    });
    expect(prepared.input).toEqual({
      issue: "ENG-12",
      image_base64: expect.any(String),
      bytes: bytes.length,
      sha256_prefix: prefix,
      file_name: `phoenix-screenshot-${prefix}.png`,
    });
    expect(atob(prepared.input.image_base64).length).toBe(bytes.length);
    expect(f.client.attach).not.toHaveBeenCalled();
    expect(f.calls).toEqual(["permission", "capture"]);
  });

  it("sends only when asked to, once, with the same bytes the person was shown", async () => {
    const f = fixture();
    f.client.supportsAttachment.mockImplementation((t) => t !== "github");
    await f.workflow.captureOnAction();
    flattenTo(png(10));
    const prepared = await f.workflow.prepareAttachment("jira", "PROJ-7");
    await f.workflow.attachApproved(prepared);
    expect(f.client.attach).toHaveBeenCalledTimes(1);
    expect(f.client.attach.mock.calls[0]![0].input).toEqual(prepared.input);
  });

  it("refuses to send when the image changed after the person reviewed it", async () => {
    const f = fixture();
    f.client.supportsAttachment.mockImplementation((t) => t !== "github");
    await f.workflow.captureOnAction();
    flattenTo(png(10));
    const prepared = await f.workflow.prepareAttachment("jira", "PROJ-7");
    flattenTo(png(11));
    await expect(f.workflow.attachApproved(prepared)).rejects.toMatchObject({
      problem: "changed",
    });
    expect(f.client.attach).not.toHaveBeenCalled();
  });

  it("refuses an image that is not a PNG or is over 5 MiB, before any request", async () => {
    const f = fixture();
    f.client.supportsAttachment.mockImplementation((t) => t !== "github");
    await f.workflow.captureOnAction();
    flattenTo(new Blob(["flattened"], { type: "image/png" }));
    await expect(f.workflow.prepareAttachment("linear", "ENG-1")).rejects.toBeInstanceOf(
      AttachImageError,
    );
    flattenTo(png(5 * 1024 * 1024));
    await expect(f.workflow.prepareAttachment("linear", "ENG-1")).rejects.toMatchObject({
      problem: "tooLarge",
    });
    expect(f.client.attach).not.toHaveBeenCalled();
  });

  it("cannot attach while a capture or creation is in progress", async () => {
    const f = fixture();
    f.client.supportsAttachment.mockImplementation((t) => t !== "github");
    await f.workflow.captureOnAction();
    flattenTo(png());
    const prepared = await f.workflow.prepareAttachment("linear", "ENG-1");
    const pending = Promise.withResolvers<boolean>();
    f.client.approve.mockImplementationOnce(() => pending.promise);
    const creation = f.workflow.createApproved({
      tracker: "linear",
      project: "x",
      title: "t",
      body: "",
    });
    await vi.waitFor(() => expect(f.client.approve).toHaveBeenCalled());
    await expect(f.workflow.attachApproved(prepared)).rejects.toThrow("in progress");
    pending.resolve(false);
    await creation;
  });
});
