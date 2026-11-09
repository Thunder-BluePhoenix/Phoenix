// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 85, the page side of OS region capture. It adapts Core's `screen-region` capability
// (`capture_region`) and the `github` capability (`issue.create`) to the two seams `ScreenshotDraft`
// takes, so the capture/annotate/redact `ScreenshotIssue` can be mounted.
//
// What this file decides, and what it leaves to Core:
//   * Capturing starts only when `captureRegion()` is called, which the capture button does. This file
//     never captures on load, on a timer or on an event.
//   * It never decides a confirmation. `capture_region` carries the `screen_capture` permission, which
//     Core confirms every time, and `issue.create` is an `external` command Core confirms too. This file
//     only waits and reports the operation's outcome; it never calls `/api/confirmations`.
//   * The image arrives once, as base64 in the operation result (Core blanks it after a minute). It is
//     checked again here (PNG signature, byte cap) and kept in page memory only: never saved, never sent.
//   * The issue itself is always TEXT ONLY. GitHub stops there (it has no documented image upload). For
//     Linear and Jira the person may then attach the redacted PNG in a separate, second step; that is
//     its own Core-confirmed `issues` command (`*.issue.attach`), never part of the create.
import type { IssueClient, IssueDraft, RegionCaptureClient } from "./screenshot";
import { ApiError, type PhoenixClient } from "./client";
import { ISSUES_CAPABILITY, type AttachTracker } from "./issue-attach";
import {
  buildImageIssueDraft,
  cleanIssueText,
  createUnavailable,
  GITHUB_CAPABILITY,
  ISSUE_COMMAND,
  readCreated,
} from "./image-issue";
import type { CapabilityView } from "./types";
import { translate } from "../i18n/store";

export const SCREEN_REGION_CAPABILITY = "screen-region";
export const CAPTURE_COMMAND = "capture_region";
export const SCREEN_CAPTURE_PERMISSION = "screen_capture";

/** The same cap as Core's capability (capabilities/screen-region MAX_IMAGE_BYTES) and the drop. */
export const MAX_CAPTURE_BYTES = 5 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A failed Core operation: `code` is Core's error code, `message` Core's fixed text. */
export class CommandFailure extends Error {
  constructor(
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "CommandFailure";
  }
}

interface Operation {
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  result?: unknown;
  error?: { code?: string; message?: string };
}

export interface CoreTiming {
  /** Milliseconds between operation reads. */
  pollMs?: number;
  /** The longest the page waits for one operation (confirmation plus the run). */
  maxWaitMs?: number;
}

const POLL_MS = 500;
/** A confirmation expires after 5 minutes and a capture after 2: wait a little longer than both. */
const MAX_WAIT_MS = 8 * 60_000;

/** Starts one capability command and follows it to its end (the approval is Core's, in Approvals). */
async function runCommand(
  client: PhoenixClient,
  capabilityId: string,
  command: string,
  input: unknown,
  timing: CoreTiming,
): Promise<unknown> {
  const pollMs = timing.pollMs ?? POLL_MS;
  const deadline = Date.now() + (timing.maxWaitMs ?? MAX_WAIT_MS);
  let id: string;
  try {
    id = (
      await client.request<{ id: string }>(
        "POST",
        `/api/capabilities/${encodeURIComponent(capabilityId)}/commands/${encodeURIComponent(command)}`,
        { input },
      )
    ).id;
  } catch (err) {
    if (err instanceof ApiError) throw new CommandFailure(err.code, err.message);
    throw err;
  }
  for (;;) {
    let op: Operation;
    try {
      op = await client.request<Operation>("GET", `/api/operations/${encodeURIComponent(id)}`);
    } catch (err) {
      if (err instanceof ApiError) throw new CommandFailure(err.code, err.message);
      throw err;
    }
    if (op.status === "succeeded") return op.result;
    if (op.status === "failed" || op.status === "cancelled") {
      throw new CommandFailure(op.error?.code ?? null, op.error?.message ?? "The request failed");
    }
    if (Date.now() >= deadline) throw new CommandFailure("OPERATION_TIMEOUT", "Timed out");
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/** The words for a failed command, from Core's code; Core's own fixed text is the fallback. */
function failureText(err: CommandFailure): string {
  switch (err.code) {
    case "PERMISSION_DENIED":
      return translate("screenRegion.declined");
    case "SECURITY_POLICY_BLOCKED":
      return translate("screenRegion.blocked");
    case "OPERATION_TIMEOUT":
      return translate("screenRegion.timeout");
    default:
      return translate("screenRegion.failed", { message: err.message });
  }
}

function pngBlob(base64: unknown): Blob {
  if (typeof base64 !== "string" || base64.length === 0) {
    throw new Error(translate("screenRegion.badImage"));
  }
  // Check the encoded size before decoding anything (4 characters make 3 bytes).
  if (base64.length > Math.ceil(MAX_CAPTURE_BYTES / 3) * 4) {
    throw new Error(translate("screenRegion.tooLarge"));
  }
  let raw: string;
  try {
    raw = atob(base64);
  } catch {
    throw new Error(translate("screenRegion.badImage"));
  }
  if (raw.length > MAX_CAPTURE_BYTES) throw new Error(translate("screenRegion.tooLarge"));
  if (raw.length < 33 || !PNG_SIGNATURE.every((byte, i) => raw.charCodeAt(i) === byte)) {
    throw new Error(translate("screenRegion.badImage"));
  }
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: "image/png" });
}

/** Why a capture cannot be asked for now, or null when Core's own view says it can. */
export function captureUnavailable(capabilities: readonly CapabilityView[]): boolean {
  const cap = capabilities.find((c) => c.id === SCREEN_REGION_CAPABILITY);
  return !(
    cap?.status === "enabled" &&
    cap.commands.some((c) => c.name === CAPTURE_COMMAND) &&
    cap.permissions.some((p) => p.permission === SCREEN_CAPTURE_PERMISSION && p.granted)
  );
}

export interface RegionCaptureHooks extends CoreTiming {
  /** Told when a new capture is requested, so a previous notice can be cleared. */
  onStart?: () => void;
  /** Told when the person ended the selector without choosing (Esc): a notice, not an error. */
  onCancelled?: () => void;
}

/**
 * `RegionCaptureClient` over Core. `permission()` reads Core's view of the capability and grant (the
 * macOS Screen Recording permission itself cannot be read from here); `captureRegion()` runs the
 * confirmed command and returns the PNG, or null when the person cancelled.
 */
export function createCoreRegionCapture(
  client: PhoenixClient,
  hooks: RegionCaptureHooks = {},
): RegionCaptureClient {
  return {
    async permission() {
      hooks.onStart?.();
      const list = await client.request<{ capabilities: CapabilityView[] }>(
        "GET",
        "/api/capabilities",
      );
      return !captureUnavailable(list.capabilities);
    },
    async captureRegion() {
      let result: unknown;
      try {
        result = await runCommand(client, SCREEN_REGION_CAPABILITY, CAPTURE_COMMAND, {}, hooks);
      } catch (err) {
        if (err instanceof CommandFailure) throw new Error(failureText(err));
        throw err;
      }
      const r =
        typeof result === "object" && result !== null && !Array.isArray(result)
          ? (result as Record<string, unknown>)
          : {};
      if (r.status === "cancelled") {
        hooks.onCancelled?.();
        return null;
      }
      if (r.status === "unsupported") throw new Error(translate("screenRegion.unsupported"));
      if (r.status !== "captured" || r.mime !== "image/png") {
        throw new Error(translate("screenRegion.badImage"));
      }
      if (r.expired === true) throw new Error(translate("screenRegion.expired"));
      return pngBlob(r.image);
    },
  };
}

const TEAM_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const JIRA_PROJECT = /^[A-Z][A-Z0-9_]{1,49}$/;
const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9_]{0,49}-\d{1,9}$/;

/** Core's failure for a write, in the words of the issue flow (decline, emergency stop, timeout, other). */
function writeFailure(err: unknown): never {
  if (err instanceof CommandFailure) {
    if (err.code === "PERMISSION_DENIED") throw new Error(translate("focus.issueDraft.denied"));
    if (err.code === "SECURITY_POLICY_BLOCKED") {
      throw new Error(translate("focus.issueDraft.blocked"));
    }
    if (err.code === "OPERATION_TIMEOUT") throw new Error(translate("focus.issueDraft.timeout"));
    throw new Error(translate("focus.issueDraft.failed", { message: err.message }));
  }
  throw err;
}

/** `{ command, input }` of the create command for a draft; the text is cleaned and secret-scanned first. */
function createCall(draft: IssueDraft): { capability: string; command: string; input: unknown } {
  if (draft.tracker === "github") {
    // The image is never part of the GitHub issue, so a placeholder stands in for the draft check.
    const built = buildImageIssueDraft(
      {
        image: { name: "screenshot.png", mime: "image/png", base64: "" },
        repository: draft.project,
        title: draft.title,
        body: draft.body,
      },
      `screenshot-issue-${crypto.randomUUID()}`,
    );
    if (!built.ok) throw new Error(translate(built.problem.key, built.problem.vars ?? {}));
    return { capability: GITHUB_CAPABILITY, command: ISSUE_COMMAND, input: built.draft.input };
  }
  const text = cleanIssueText(draft.title, draft.body);
  if (!text.ok) throw new Error(translate(text.problem.key, text.problem.vars ?? {}));
  const body = text.body ? { body: text.body } : {};
  if (draft.tracker === "linear") {
    if (!TEAM_ID.test(draft.project)) throw new Error(translate("screenRegion.linearTeamInvalid"));
    return {
      capability: ISSUES_CAPABILITY,
      command: "linear.issue.create",
      input: { team_id: draft.project, title: text.title, ...body },
    };
  }
  if (!JIRA_PROJECT.test(draft.project))
    throw new Error(translate("screenRegion.jiraProjectInvalid"));
  return {
    capability: ISSUES_CAPABILITY,
    command: "jira.issue.create",
    input: { project: draft.project, title: text.title, ...body },
  };
}

/** What `linear.issue.create` / `jira.issue.create` return, read defensively. */
function readTrackerIssue(raw: unknown): { url: string; key: string } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.url !== "string" || typeof r.key !== "string" || !ISSUE_KEY.test(r.key)) return null;
  return { url: r.url, key: r.key };
}

/** Why the `issues` capability cannot run `command` now, or null when Core's own view says it can. */
function issuesUnavailable(
  list: readonly CapabilityView[],
  command: string,
  tracker: AttachTracker,
) {
  const issues = list.find((c) => c.id === ISSUES_CAPABILITY);
  if (issues?.status !== "enabled" || !issues.commands.some((c) => c.name === command)) {
    return translate("screenRegion.issuesUnavailable");
  }
  const secrets =
    tracker === "linear" ? ["linear_write_key"] : ["jira_write_email", "jira_write_token"];
  if (!secrets.every((name) => issues.secrets?.find((s) => s.name === name)?.set === true)) {
    return translate("screenRegion.issuesNoWriteCredential", {
      tracker: translate(
        tracker === "linear" ? "focus.screenshot.tracker.linear" : "focus.screenshot.tracker.jira",
      ),
    });
  }
  return null;
}

/**
 * `IssueClient` over Core. GitHub: text only, through the `github` capability's `issue.create`.
 * Linear and Jira: text through `issues` `linear.issue.create` / `jira.issue.create`, and then, only
 * when the person asks for it in a second step, the redacted PNG through `linear.issue.attach` /
 * `jira.issue.attach`. GitHub has no attach: it offers no documented endpoint for an issue image.
 * The text is cleaned and secret-scanned with the same rules as the image flow before any request.
 * Every approval is Core's: each command is `external`, so Core raises its own confirmation when the
 * command runs; a decline surfaces as an error, never as a created issue or an attached image.
 */
export function createCoreIssueClient(client: PhoenixClient, timing: CoreTiming = {}): IssueClient {
  const capabilities = async () =>
    (await client.request<{ capabilities: CapabilityView[] }>("GET", "/api/capabilities"))
      .capabilities;
  return {
    supportsAttachment: (tracker) => tracker === "linear" || tracker === "jira",
    async approve(draft) {
      // Everything that can be refused is refused before Core is asked anything.
      const call = createCall(draft);
      const list = await capabilities();
      if (draft.tracker === "github") {
        const why = createUnavailable(list);
        if (why) throw new Error(translate(why));
      } else {
        const why = issuesUnavailable(list, call.command, draft.tracker);
        if (why) throw new Error(why);
      }
      return true;
    },
    async create(draft) {
      const call = createCall(draft);
      let result: unknown;
      try {
        result = await runCommand(client, call.capability, call.command, call.input, timing);
      } catch (err) {
        return writeFailure(err);
      }
      if (draft.tracker === "github") {
        const created = readCreated(result);
        if (!created) throw new Error(translate("focus.issueDraft.failed", { message: "" }));
        return { url: created.url };
      }
      const created = readTrackerIssue(result);
      if (!created) throw new Error(translate("focus.issueDraft.failed", { message: "" }));
      return created;
    },
    async attach(request) {
      const { tracker, issue } = request.details;
      if (!ISSUE_KEY.test(issue)) throw new Error(translate("screenRegion.issueKeyInvalid"));
      const command = `${tracker}.issue.attach`;
      const why = issuesUnavailable(await capabilities(), command, tracker);
      if (why) throw new Error(why);
      let result: unknown;
      try {
        result = await runCommand(client, ISSUES_CAPABILITY, command, request.input, timing);
      } catch (err) {
        return writeFailure(err);
      }
      const r =
        typeof result === "object" && result !== null ? (result as Record<string, unknown>) : {};
      if (r.attached !== true || r.issue !== issue) {
        throw new Error(translate("focus.issueDraft.failed", { message: "" }));
      }
    },
  };
}
