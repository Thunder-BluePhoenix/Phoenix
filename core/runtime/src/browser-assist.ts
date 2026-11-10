// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 95: turns the person's words ("add the blue one to the cart") into a PROPOSED list of browser
// steps for the page open in the Phoenix browser. The page text and the goal go to a vetted
// on-device model through `AiService.generateLocal` and nowhere else: with no such model, or while
// it is down, the answer is "no local model", never a cloud call. The result is DATA. Nothing runs
// here; each step the person picks is run through the existing `browser` capability, whose approval
// card shows page, control and full typed text and refuses protected fields again after approval.
import {
  AiDisabledError,
  AllProvidersFailedError,
  ModelError,
  NoLocalModelError,
  NoProviderError,
  type AiService,
} from "@phoenix/ai-models";
import {
  BrowsingAssistant,
  BROWSER_TOOL_NAMES,
  BrowsingSafetyError,
  MAX_GOAL_CHARS,
  type BrowserAction,
} from "@phoenix/ai-browsing";
import { createRelayPageReader, type BrowserRelay } from "@phoenix/capability-browser";
import type { AuditLog } from "@phoenix/permissions";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";

/** Control, bidi-override/isolate, direction-mark and zero-width characters. */
const HIDDEN_CHARS =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/;

export type BrowserAssistResult =
  | {
      status: "ok";
      /** Steps to put to the person. Run one only through `POST /api/capabilities/browser/commands/<kind>`, which asks for approval. */
      plan: { page_url: string; actions: readonly BrowserAction[] };
      /** Model suggestions that were refused (unknown or protected control, navigate, download, bad shape). */
      dropped: number;
      processed_by: string;
    }
  | { status: "no_local_model"; detail: string }
  | { status: "local_model_failed"; detail: string }
  | { status: "no_browser"; detail: string };

export interface BrowserAssistDeps {
  ai: AiService;
  /** Absent in a runtime without a Phoenix browser. */
  relay: BrowserRelay | undefined;
  audit: AuditLog;
}

const NO_LOCAL = "No local model is available. Page text is never sent to a cloud provider.";

export class BrowserAssistService {
  constructor(private readonly d: BrowserAssistDeps) {}

  /** Validates the person's goal: a string, clipped to 500 characters, with no control or bidi characters. */
  static goalOf(input: unknown): string {
    const body =
      input !== null && typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {};
    for (const key of Object.keys(body)) {
      if (key !== "goal") throw invalid(`Unknown field "${key.slice(0, 40)}"`);
    }
    if (typeof body.goal !== "string") throw invalid('"goal" must be a string');
    if (HIDDEN_CHARS.test(body.goal))
      throw invalid('"goal" must not contain control, bidi or zero-width characters');
    const goal = body.goal.trim().slice(0, MAX_GOAL_CHARS).trim();
    if (!goal) throw invalid('"goal" must not be empty');
    return goal;
  }

  async assist(input: unknown, signal?: AbortSignal): Promise<BrowserAssistResult> {
    const goal = BrowserAssistService.goalOf(input);
    const relay = this.d.relay;
    if (!relay)
      return {
        status: "no_browser",
        detail: "This Core has no Phoenix browser to read a page from.",
      };
    // Checked BEFORE the page is read, so a missing local model means no page text is even fetched.
    let provider: string | undefined;
    try {
      provider = this.d.ai.localGenerateProvider();
    } catch (error) {
      if (error instanceof AiDisabledError) return { status: "no_local_model", detail: NO_LOCAL };
      throw error;
    }
    if (provider === undefined) return { status: "no_local_model", detail: NO_LOCAL };

    const { ai } = this.d;
    const assistant = new BrowsingAssistant({
      page: createRelayPageReader(relay),
      // The only door to a model: on-device by construction (`generateLocal` throws for anything else).
      model: {
        locality: "local",
        trustedLocal: true,
        generate: async (request, options) => {
          const outcome = await ai.generateLocal(request, { provider, signal: options?.signal });
          return outcome.result;
        },
      },
      // `propose` never executes: these exist only because the bridge type requires them.
      gateway: {
        tools: () => [],
        call: () => Promise.reject(new BrowsingSafetyError("Assist never runs an action")),
      },
      approval: {
        approve: () => Promise.reject(new BrowsingSafetyError("Assist never approves an action")),
      },
      audit: { record: (entry) => this.d.audit.record(entry) },
      actor: { kind: "agent", id: "fawkes", trustedByUser: false },
      environment: "local",
      tools: BROWSER_TOOL_NAMES,
    });
    try {
      const proposal = await assistant.propose(goal, signal);
      this.record("proposed", proposal.pageUrl, {
        goalLength: goal.length,
        actions: proposal.actions.length,
        dropped: proposal.dropped,
      });
      return {
        status: "ok",
        plan: { page_url: proposal.pageUrl, actions: proposal.actions },
        dropped: proposal.dropped,
        processed_by: proposal.processedBy,
      };
    } catch (error) {
      if (error instanceof NoLocalModelError || error instanceof NoProviderError) {
        return { status: "no_local_model", detail: NO_LOCAL };
      }
      if (error instanceof AllProvidersFailedError || error instanceof ModelError) {
        if (error instanceof ModelError && error.kind === "aborted") throw error;
        return {
          status: "local_model_failed",
          detail: "The local model failed. Nothing was sent anywhere else.",
        };
      }
      throw error;
    }
  }

  /** Counts and a query-stripped page address only: never the goal, the page text or the plan's text. */
  private record(action: string, pageUrl: string, details: Record<string, unknown>): void {
    const url = new URL(pageUrl);
    url.search = "";
    url.hash = "";
    this.d.audit.record({
      actor: "agent:fawkes",
      action: `browser.assist.${action}`,
      decision: "info",
      details: { pageUrl: url.href, ...details },
    });
  }
}

function invalid(message: string): PhoenixError {
  return new PhoenixError(ErrorCode.INVALID_REQUEST, message);
}
