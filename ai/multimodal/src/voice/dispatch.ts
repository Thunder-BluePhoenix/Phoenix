// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// From a recognised request to a reply. The rules this file enforces:
//   * The spoken text only SELECTS a fixed intent (intent.ts). It is never a tool input, a command
//     line or a URL (two exceptions: the email draft's body, which is URL-encoded data for a draft the
//     user opens and sends themselves; Fawkes never sends mail; and the web-search query, the single
//     `query` input of ONE `external` tool, which Core only runs after a person approves the exact
//     query in the Pet Panel. Voice can never give that approval).
//   * A tool runs only if the live registry lists it with side effect none|read, checked again at
//     the moment of the call. Core builds the call (`{}` input) and the caller supplies an actor
//     that does not claim `trustedByUser`; anything that needs approval waits for a person in the
//     Pet Panel, and gives up after `approvalWaitMs` (the pending request is denied, never approved).
//   * VOICE MAY DENY, NEVER APPROVE: the only thing voice can do to a confirmation is `deny`.
//   * Tool output is untrusted data: it is summarised into a fixed sentence (summary.ts).
import { isConfirmedSearchTool, matchIntent, type VoiceIntent, type VoiceTool } from "./intent";
import { MAX_REPLY_CHARS, clipSpeech, summariseToolOutput } from "./summary";

/** The narrow view of the permission gateway voice gets: list what is pending, and deny it. */
export interface VoiceApprovals {
  pending(): { id: string }[];
  deny(id: string): void;
}

/** The narrow view of the tool gateway voice gets. */
export interface VoiceActions {
  /** The tools callable right now (enabled capabilities only). */
  tools(): VoiceTool[];
  /**
   * Runs one tool as the voice actor, with empty input unless `input` is given (only the confirmed
   * web search passes one). Rejects on any refusal or failure.
   */
  call(
    tool: string,
    signal: AbortSignal,
    input?: Record<string, unknown>,
  ): Promise<{ output: unknown }>;
}

export type VoiceUiAction =
  { type: "switch_pill"; direction: "next" | "previous" } | { type: "mailto"; url: string };

export type VoiceOutcome = "ok" | "refused" | "unavailable" | "failed" | "denied";

export interface VoiceReply {
  /** What Fawkes says. Plain text, at most MAX_REPLY_CHARS. */
  text: string;
  /** For the client to carry out; Core never acts on it. */
  action?: VoiceUiAction;
  intent: VoiceIntent["kind"];
  outcome: VoiceOutcome;
  /** Present only when a tool call was attempted. */
  tool?: string;
}

export interface VoiceDispatchDeps {
  actions: VoiceActions;
  approvals: VoiceApprovals;
  /** Schedules `fn`; returns the cancel function. */
  after(fn: () => void, ms: number): () => void;
  /** How long a tool call may wait (for a person's approval) before voice gives up. */
  approvalWaitMs: number;
  /** Audit hook: ids, tool names and outcomes only, never text. */
  audit(action: "voice.request" | "voice.action", details: Record<string, unknown>): void;
}

const MAILTO_SUBJECT = "Draft from Fawkes";

export function mailtoDraft(body: string): string {
  const query = [`subject=${encodeURIComponent(MAILTO_SUBJECT)}`];
  if (body.length > 0) query.push(`body=${encodeURIComponent(body)}`);
  return `mailto:?${query.join("&")}`;
}

export async function dispatchRequest(
  session: string,
  request: string,
  deps: VoiceDispatchDeps,
  signal: AbortSignal,
): Promise<VoiceReply> {
  const intent = matchIntent(request, deps.actions.tools());
  deps.audit("voice.request", { session, intent: intent.kind });
  switch (intent.kind) {
    case "switch_pill":
      return {
        text: "Switching pills.",
        action: { type: "switch_pill", direction: intent.direction },
        intent: intent.kind,
        outcome: "ok",
      };
    case "mailto_draft":
      return {
        text: "I made an email draft. Open it to review and send it yourself.",
        action: { type: "mailto", url: mailtoDraft(intent.body) },
        intent: intent.kind,
        outcome: "ok",
      };
    case "deny": {
      const pending = deps.approvals.pending();
      for (const { id } of pending) deps.approvals.deny(id);
      deps.audit("voice.action", { session, action: "deny", count: pending.length });
      return {
        text:
          pending.length === 0
            ? "Nothing is waiting for approval."
            : `Denied ${pending.length} waiting ${pending.length === 1 ? "request" : "requests"}.`,
        intent: intent.kind,
        outcome: "denied",
      };
    }
    case "unavailable":
    case "refuse":
      return {
        text: clipSpeech(intent.message, MAX_REPLY_CHARS),
        intent: intent.kind,
        outcome: intent.kind === "refuse" ? "refused" : "unavailable",
      };
    case "tool":
      return runTool(session, intent.tool, deps, signal);
    case "web_search":
      return runTool(session, intent.tool, deps, signal, { query: intent.query });
  }
}

async function runTool(
  session: string,
  tool: string,
  deps: VoiceDispatchDeps,
  signal: AbortSignal,
  input?: Record<string, unknown>,
): Promise<VoiceReply> {
  const base = { intent: input ? "web_search" : "tool", tool } as const;
  // Re-checked now: the registry may have changed since the intent was chosen. A call with input is
  // allowed for the confirmed web search only; every other tool must be a read that needs no input.
  const contract = deps.actions.tools().find((t) => t.name === tool);
  const allowed = input
    ? contract !== undefined && isConfirmedSearchTool(contract)
    : contract !== undefined && (contract.sideEffect === "none" || contract.sideEffect === "read");
  if (!contract || !allowed) {
    deps.audit("voice.action", { session, tool, outcome: "refused" });
    return { ...base, text: "That tool is not available to voice.", outcome: "refused" };
  }
  // The call's own confirmation (if any) is withdrawn by the gateway when `own` aborts; voice
  // never denies a confirmation it did not cause, so nothing else is touched on a timeout.
  const own = new AbortController();
  const onAbort = () => own.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  const stopWaiting = deps.after(() => own.abort(), deps.approvalWaitMs);
  try {
    const result = await deps.actions.call(tool, own.signal, input);
    deps.audit("voice.action", { session, tool, outcome: "ok" });
    return { ...base, text: summariseToolOutput(tool, result.output), outcome: "ok" };
  } catch {
    const timedOut = own.signal.aborted && !signal.aborted;
    deps.audit("voice.action", { session, tool, outcome: timedOut ? "timed_out" : "failed" });
    return {
      ...base,
      text: timedOut
        ? "That needs your approval in the Pet Panel, so I stopped waiting."
        : "I could not run that.",
      outcome: "failed",
    };
  } finally {
    stopWaiting();
    signal.removeEventListener("abort", onAbort);
  }
}
