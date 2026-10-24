// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// ATTACHMENTS PROTOCOL (Phase 62): files, images, folders and windows the user gives Fawkes as
// context for one question. What the web page and the desktop shell speak to Phoenix Core.
//
// Everything is behind the session token. None of it is a capability command or an agent tool.
//
// Privacy contract:
//   * Attachments live in Core's MEMORY only: never in SQLite, never in the memory store, never in
//     a log line, an event or the audit log (those carry name, size, kind, origin and ids only).
//     They expire after one hour, can be removed one by one or all at once, and the emergency stop
//     clears them.
//   * Core never receives or reads a filesystem path. The web page (File API) or the desktop shell
//     (a Tauri command that reads the dropped file under caps) produces the bytes and POSTs them.
//     A name is for display only and is never used in a path.
//   * Asking a question is LOCAL ONLY by construction: privacy "sensitive" with a purpose that is not
//     in SENSITIVE_CLOUD_PURPOSES, so the gate refuses every cloud provider even after the user opted
//     in to cloud AI for sensitive data. Images are described by a local Ollama vision model only.
//     The attached content is untrusted DATA inside nonce-delimited blocks, never instructions.
//
// Routes:
//   POST   /api/attachments       {name<=120, kind:"text"|"image"|"folder", mime<=80,
//                                  origin:"drop"|"window"|"paste", content:string}
//        -> 201 {id,name,kind,mime,origin,bytes,preview,files?,created_at,expires_at}
//        text   : content <= 200,000 characters.
//        image  : base64 PNG or JPEG, <= 5 MiB decoded; the BYTES decide the type, not `mime`.
//        folder : content is JSON {files:[{path<=300, bytes, text?<=20,000}]} built by the client:
//                 <= 200 entries, <= 400,000 characters of text in total, relative paths only.
//        Body limit: ATTACHMENT_BODY_MAX_BYTES (this route only; every other route keeps 256 KiB).
//        Limits: 10 attachments (drop 10, paste 5, window 3), 8 MiB in total, one hour each.
//   GET    /api/attachments       metadata and the first 300 characters of text; never full content
//   GET    /api/attachments/:id   the full content ("visible before anything is sent")
//   DELETE /api/attachments/:id   remove one      DELETE /api/attachments   remove all
//   POST   /api/attachments/window/capture   (no body; macOS only)
//        -> {status:"captured",app,title,text,truncated,secret_kinds} | {status:"accessibility_not_granted"
//           |"phoenix_window"|"no_window"}. Core asks the user to confirm first (an `execute` action),
//           waits a few seconds so the user can bring a window to the front, then reads it ONCE with
//           a fixed osascript. Nothing is stored: the page shows the text and, only if the user
//           accepts, posts it to POST /api/attachments with origin "window".
//   POST   /api/attachments/ask   {question<=2000, attachment_ids:[1..5]}
//        -> {answer, processed_by, model, provider, locality, usage, cost, vision_model, sources:[{id,name}]}
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { ATTACHMENT_BODY_MAX_BYTES, expectObject, route, type Route } from "./http";
import type { CoreServices } from "./services";

export type AttachmentKind = "text" | "image" | "folder";
export type AttachmentOrigin = "drop" | "window" | "paste";

export interface AttachmentSummaryView {
  id: string;
  name: string;
  kind: AttachmentKind;
  /** Images: the type found in the bytes. Others: as sent. */
  mime: string;
  origin: AttachmentOrigin;
  bytes: number;
  /** First 300 characters, text attachments only. */
  preview: string | null;
  /** Folders: how many files the listing holds. */
  files: number | null;
  created_at: string;
  expires_at: string;
}

export interface AttachmentDetailView extends AttachmentSummaryView {
  /** Text as sent, base64 for an image, the JSON listing for a folder. */
  content: string;
}

export interface AttachmentLimitsView {
  max_count: number;
  max_total_bytes: number;
  ttl_ms: number;
  max_text_chars: number;
  max_image_bytes: number;
  max_folder_entries: number;
  max_folder_text_chars: number;
  max_folder_file_text_chars: number;
  max_name_chars: number;
  max_question_chars: number;
  max_ask_attachments: number;
  max_per_origin: Record<AttachmentOrigin, number>;
}

export interface AttachmentListView {
  attachments: AttachmentSummaryView[];
  total_bytes: number;
  limits: AttachmentLimitsView;
}

export interface AttachmentAnswerView {
  answer: string;
  processed_by: string;
  model: string;
  provider: string;
  locality: "local" | "cloud";
  usage: { input_tokens: number | null; output_tokens: number | null } | null;
  cost: { amount: number; currency: "USD"; basis: "user-configured prices" } | null;
  /** The local vision model that described the images, when there were any. */
  vision_model: string | null;
  sources: { id: string; name: string }[];
}

/**
 * What one window capture returns. Never stored by Core: the page shows it and the user decides.
 * `accessibility_not_granted`: macOS refused (nothing was prompted by Phoenix); `phoenix_window`:
 * the front window was Phoenix's own and nothing was read; `no_window`: nothing readable.
 */
export type WindowCaptureView =
  | {
      status: "captured";
      app: string;
      title: string;
      text: string;
      truncated: boolean;
      /** Kinds of secret the detector found in the text (never the values); empty when none. */
      secret_kinds: string[];
    }
  | { status: "accessibility_not_granted" }
  | { status: "phoenix_window" }
  | { status: "no_window" };

/** Attachments as the API sees them. Errors are PhoenixErrors with messages that never hold content. */
export interface AttachmentsApi {
  add(input: unknown): AttachmentSummaryView;
  list(): AttachmentListView;
  get(id: string): AttachmentDetailView;
  remove(id: string): void;
  clear(): { deleted: number };
  ask(input: unknown): Promise<AttachmentAnswerView>;
  captureWindow(): Promise<WindowCaptureView>;
}

export function attachmentRoutes(s: CoreServices): Route[] {
  const attachments = () => {
    if (!s.attachments)
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Attachments are unavailable");
    return s.attachments;
  };
  return [
    route("GET", "/api/attachments", () => attachments().list()),
    route("POST", "/api/attachments", async ({ body, res }) => {
      const input = expectObject(await body(ATTACHMENT_BODY_MAX_BYTES));
      const added = attachments().add(input);
      res.statusCode = 201;
      return added;
    }),
    route("DELETE", "/api/attachments", () => attachments().clear()),
    route("POST", "/api/attachments/ask", async ({ body }) =>
      attachments().ask(expectObject(await body())),
    ),
    // Takes no body and no parameter: whatever the caller sends is ignored.
    route("POST", "/api/attachments/window/capture", () => attachments().captureWindow()),
    route("GET", "/api/attachments/:id", ({ params }) => attachments().get(params.id!)),
    route("DELETE", "/api/attachments/:id", ({ params }) => {
      attachments().remove(params.id!);
      return { deleted: true };
    }),
  ];
}
