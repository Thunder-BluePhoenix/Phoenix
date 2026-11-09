// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

import {
  AttachImageError,
  buildAttachRequest,
  type AttachRequest,
  type AttachTracker,
} from "./issue-attach";

export type IssueTracker = "github" | "linear" | "jira";
export interface RegionCaptureClient {
  /** Must check the OS permission before opening the region selector. */
  permission(): Promise<boolean>;
  /** Invoked only after explicit user action and an affirmative permission check. */
  captureRegion(): Promise<Blob | null>;
}
export interface IssueDraft {
  tracker: IssueTracker;
  project: string;
  title: string;
  body: string;
}
export interface IssueClient {
  supportsAttachment(tracker: IssueTracker): boolean;
  /** Permission gateway: affirmative approval for exactly this draft, before any write/upload. */
  approve(draft: IssueDraft): Promise<boolean>;
  /** Client owns provider issue creation; must never be called without approve. `key` is the tracker's issue key. */
  create(draft: IssueDraft): Promise<{ url: string; key?: string }>;
  /**
   * Attaches the redacted image to an issue that already exists. A separate write from `create`, with
   * its own Core confirmation; only trackers for which `supportsAttachment` is true (never GitHub).
   */
  attach?(request: AttachRequest): Promise<void>;
}
export type Annotation =
  | { kind: "box" | "redact" | "arrow"; x: number; y: number; toX: number; toY: number }
  | { kind: "text"; x: number; y: number; text: string };

/** All image processing stays in browser memory. Only the flattened, redacted canvas is serialized. */
export class ScreenshotPermissionError extends Error {
  constructor() {
    super("Screen recording permission is required");
    this.name = "ScreenshotPermissionError";
  }
}

export class ScreenshotDraft {
  private image: HTMLCanvasElement | null = null;
  private annotations: Annotation[] = [];
  private creating = false;
  private capturing = false;
  private redactions: Extract<Annotation, { kind: "box" | "redact" | "arrow" }>[] = [];
  constructor(
    private readonly capture: RegionCaptureClient,
    private readonly client: IssueClient,
  ) {}

  /** Call only from the capture button handler. No capture happens at construction or render. */
  async captureOnAction(): Promise<boolean> {
    if (this.creating || this.capturing)
      throw new Error("Capture or issue creation already in progress");
    this.capturing = true;
    try {
      if (!(await this.capture.permission())) throw new ScreenshotPermissionError();
      const blob = await this.capture.captureRegion();
      if (!blob) return false;
      const bitmap = await createImageBitmap(blob);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas is unavailable");
        ctx.drawImage(bitmap, 0, 0);
        this.image = canvas;
        this.annotations = [];
        this.redactions = [];
      } finally {
        bitmap.close();
      }
      return true;
    } finally {
      this.capturing = false;
    }
  }

  get size(): { width: number; height: number } | null {
    return this.image ? { width: this.image.width, height: this.image.height } : null;
  }

  annotate(mark: Annotation): void {
    if (this.creating || this.capturing)
      throw new Error("Capture or issue creation already in progress");
    if (!this.image) throw new Error("Capture a region first");
    const { width, height } = this.image;
    const inside = (x: number, y: number) =>
      Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= width && y <= height;
    if (!inside(mark.x, mark.y) || (mark.kind !== "text" && !inside(mark.toX, mark.toY)))
      throw new RangeError("Annotation outside image");
    if (mark.kind === "text" && (!mark.text.trim() || mark.text.length > 500))
      throw new RangeError("Text must be 1–500 characters");
    if (mark.kind === "redact") {
      // Irreversible on the source pixel buffer; clearing annotations cannot recover this data.
      const ctx = this.image.getContext("2d");
      if (!ctx) throw new Error("Canvas is unavailable");
      const x = Math.floor(Math.min(mark.x, mark.toX));
      const y = Math.floor(Math.min(mark.y, mark.toY));
      const right = Math.ceil(Math.max(mark.x, mark.toX));
      const bottom = Math.ceil(Math.max(mark.y, mark.toY));
      if (right <= x || bottom <= y) throw new RangeError("Select an area to redact");
      ctx.fillStyle = "#000000";
      this.redactions.push(mark);
      ctx.fillRect(x, y, right - x, bottom - y);
    } else {
      this.annotations.push(mark);
    }
  }

  /** Draws the current flattened image; never yields the raw capture blob. */
  render(target: HTMLCanvasElement): void {
    if (!this.image) throw new Error("Capture a region first");
    target.width = this.image.width;
    target.height = this.image.height;
    const ctx = target.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable");
    ctx.drawImage(this.image, 0, 0);
    ctx.strokeStyle = "#ffb900";
    ctx.fillStyle = "#ffb900";
    ctx.lineWidth = 3;
    ctx.font = "20px sans-serif";
    for (const mark of this.annotations) {
      if (mark.kind === "text") {
        ctx.fillText(mark.text, mark.x, mark.y);
      } else if (mark.kind === "box") {
        ctx.strokeRect(mark.x, mark.y, mark.toX - mark.x, mark.toY - mark.y);
      } else if (mark.kind === "arrow") {
        const angle = Math.atan2(mark.toY - mark.y, mark.toX - mark.x);
        ctx.beginPath();
        ctx.moveTo(mark.x, mark.y);
        ctx.lineTo(mark.toX, mark.toY);
        ctx.moveTo(mark.toX, mark.toY);
        ctx.lineTo(
          mark.toX - 12 * Math.cos(angle - Math.PI / 6),
          mark.toY - 12 * Math.sin(angle - Math.PI / 6),
        );
        ctx.moveTo(mark.toX, mark.toY);
        ctx.lineTo(
          mark.toX - 12 * Math.cos(angle + Math.PI / 6),
          mark.toY - 12 * Math.sin(angle + Math.PI / 6),
        );
        ctx.stroke();
      }
    }
    // Redact a second time after overlays: prior text/lines cannot reveal covered content.
    ctx.fillStyle = "#000000";
    for (const mark of this.redactions) {
      const x = Math.floor(Math.min(mark.x, mark.toX));
      const y = Math.floor(Math.min(mark.y, mark.toY));
      ctx.fillRect(
        x,
        y,
        Math.ceil(Math.max(mark.x, mark.toX)) - x,
        Math.ceil(Math.max(mark.y, mark.toY)) - y,
      );
    }
  }

  /** Cleans and checks the fields into an issue draft. No image is part of an issue: it is text only. */
  async preview(
    tracker: IssueTracker,
    project: string,
    title: string,
    body: string,
  ): Promise<IssueDraft> {
    if (this.capturing) throw new Error("Capture already in progress");
    if (!this.image) throw new Error("Capture a region first");
    if (!project.trim() || !title.trim()) throw new Error("Project and title are required");
    return { tracker, project: project.trim(), title: title.trim(), body };
  }

  async createApproved(draft: IssueDraft): Promise<{ url: string; key?: string } | null> {
    if (this.creating || this.capturing)
      throw new Error("Capture or issue creation already in progress");
    this.creating = true;
    try {
      // A preview object supplied by a caller must not bypass the current image and redact state.
      const image = this.image;
      const current = await this.preview(draft.tracker, draft.project, draft.title, draft.body);
      if (image !== this.image) throw new Error("Captured region changed during approval");
      const approved = await this.client.approve({ ...current });
      if (!approved) return null;
      if (image !== this.image) throw new Error("Captured region changed during approval");
      return await this.client.create(current);
    } finally {
      this.creating = false;
    }
  }

  /** True for trackers that can take the redacted image after the issue exists (never GitHub). */
  canAttach(tracker: IssueTracker): tracker is AttachTracker {
    return this.client.supportsAttachment(tracker) && this.client.attach !== undefined;
  }

  /** The current flattened, redacted image as a PNG blob. Redactions are drawn last, as in `render`. */
  private async flatten(): Promise<Blob> {
    if (!this.image) throw new Error("Capture a region first");
    const canvas = document.createElement("canvas");
    this.render(canvas);
    const { promise, resolve, reject } = Promise.withResolvers<Blob>();
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Image export failed"))),
      "image/png",
    );
    return await promise;
  }

  /**
   * Builds the attachment for an existing issue exactly as it would be sent: the validated PNG, its
   * generated file name, size and hash. Nothing is sent. The page shows these to the person first.
   */
  async prepareAttachment(tracker: IssueTracker, issue: string): Promise<AttachRequest> {
    if (!this.canAttach(tracker)) throw new Error("This tracker cannot take an attachment");
    if (this.capturing || this.creating) throw new Error("Capture or issue creation in progress");
    return await buildAttachRequest(tracker, issue, await this.flatten());
  }

  /**
   * Sends a prepared attachment, after the person pressed the separate confirm button. The current
   * image is flattened again and must hash to the same bytes the person was shown, so the preview
   * cannot differ from what is uploaded. Core then asks for its own approval (the client's `attach`).
   * Returns false when the person declined there.
   */
  async attachApproved(prepared: AttachRequest): Promise<void> {
    const { tracker, issue } = prepared.details;
    if (!this.canAttach(tracker)) throw new Error("This tracker cannot take an attachment");
    if (this.creating || this.capturing) throw new Error("Capture or issue creation in progress");
    this.creating = true;
    try {
      const current = await buildAttachRequest(tracker, issue, await this.flatten());
      if (current.details.sha256Prefix !== prepared.details.sha256Prefix) {
        throw new AttachImageError("changed");
      }
      await this.client.attach!(current);
    } finally {
      this.creating = false;
    }
  }
}
