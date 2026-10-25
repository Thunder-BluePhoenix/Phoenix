// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phoenix browser actions (Phase 95): click, type, submit, navigate and download on the ACTIVE tab of
// the Phoenix mini browser. Every command is `external`, so Core's confirmation asks for each one even
// when permissions are granted; the card shows the page, the selector or destination and, for `type`,
// the full text (`x-phoenix-confirm-input`, see capability-manager). A command carries the page URL the
// user approved. After the confirmation the handler reads the page again and refuses when the active
// tab is no longer on that URL, or when the action is no longer allowed on the fresh page (protected
// field, form with a protected control, a selector the host cannot resolve uniquely). The action then
// goes through the chrome-window-only Tauri commands via the relay (see relay.ts): no new command is
// reachable from a content window. Evidence: fakes only. See docs/browsing-assistant.md.
import {
  checkBrowserAction,
  isActionableSelector,
  MAX_TYPED_CHARS,
  readPageSnapshot,
  SnapshotPageReader,
  type BrowserAction,
  type PageReader,
} from "@phoenix/ai-browsing";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { defineCapability } from "@phoenix/sdk";
import { BrowserRelay, RelayError, type RelayOutcome, type RelayRequestBody } from "./relay";

export * from "./relay";

export const BROWSER_CAPABILITY_ID = "browser";
export const BROWSER_COMMANDS = ["click", "type", "submit", "navigate", "download"] as const;
export type BrowserCommand = (typeof BROWSER_COMMANDS)[number];

const CONFIRM = "x-phoenix-confirm-input";
const PAGE_URL = {
  type: "string",
  minLength: 8,
  maxLength: 2048,
  pattern: "^https?://",
  [CONFIRM]: true,
} as const;
const SELECTOR = {
  type: "string",
  minLength: 1,
  maxLength: 512,
  pattern: '^[a-z]+(?:#[A-Za-z0-9_:.-]{1,80}|\\[name="[A-Za-z0-9_:.-]{1,80}"\\])$',
  [CONFIRM]: true,
} as const;

const schema = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

function command(name: BrowserCommand, description: string, properties: Record<string, unknown>) {
  return {
    name,
    description,
    side_effect: "external" as const,
    permissions: ["network" as const],
    timeout_ms: 30_000,
    input_schema: schema(properties),
  };
}

/** Same rule as the assistant's `publicUrl`: credential-free http(s), no fragment. */
function pageKey(value: unknown): string {
  if (typeof value !== "string") throw refuse("bad_url", "Not a page address");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw refuse("bad_url", "Not a page address");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw refuse("bad_url", "Only credential-free http(s) pages are supported");
  url.hash = "";
  return url.href;
}

function refuse(reason: string, message: string): PhoenixError {
  return new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, message, [reason]);
}

const UNAVAILABLE = new Set(["not_attached", "no_active_tab", "timeout", "busy", "failed"]);

function failure(reason: string): PhoenixError {
  const messages: Record<string, string> = {
    page_changed: "The browser is no longer on the page you approved",
    not_a_web_page: "The active tab is not a web page",
    bad_selector: "That control cannot be addressed safely",
    not_found: "The control was not found on the page",
    ambiguous: "More than one control matches",
    protected: "That control is protected",
    unsupported: "That control does not support this action",
    not_attached: "The Phoenix browser window is not open",
    no_active_tab: "The Phoenix browser has no active tab",
    timeout: "The browser did not answer in time",
  };
  const message = messages[reason] ?? `The browser refused the action (${reason})`;
  return new PhoenixError(
    UNAVAILABLE.has(reason) ? ErrorCode.CAPABILITY_UNAVAILABLE : ErrorCode.SECURITY_POLICY_BLOCKED,
    message,
    [reason],
  );
}

async function ask(
  relay: BrowserRelay,
  body: RelayRequestBody,
  signal: AbortSignal,
): Promise<RelayOutcome> {
  try {
    return await relay.request(body, signal);
  } catch (err) {
    if (err instanceof RelayError) {
      if (err.kind === "cancelled" || err.kind === "timeout")
        throw new PhoenixError(
          ErrorCode.OPERATION_TIMEOUT,
          err.dispatched ? "The browser did not confirm; the outcome is unknown" : err.message,
        );
      throw failure(err.kind);
    }
    throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "The browser could not be reached");
  }
}

/** Reads the active tab and returns its URL after the same checks the assistant ran before approval. */
async function revalidate(
  relay: BrowserRelay,
  action: BrowserAction,
  pageUrl: string,
  signal: AbortSignal,
): Promise<void> {
  const outcome = await ask(relay, { kind: "snapshot" }, signal);
  if (!outcome.ok || !outcome.snapshot) throw failure(outcome.ok ? "failed" : outcome.reason);
  const { snapshot } = outcome;
  let page;
  try {
    page = readPageSnapshot({ url: snapshot.url, title: snapshot.title, html: snapshot.html }).page;
  } catch {
    throw failure("failed");
  }
  if (pageKey(page.url) !== pageUrl) throw failure("page_changed");
  try {
    checkBrowserAction(action, page);
  } catch {
    throw refuse("protected", "That action is not allowed on the page as it is now");
  }
}

/**
 * The real browser source for the PageReader: asks the chrome page (through `page_snapshot`, a fixed
 * script in the active tab's content webview) for the active tab's HTML and hands it to the pure
 * `readPageSnapshot`. The page cannot call it; only a Core caller holding the relay can.
 */
export function createRelayPageReader(relay: BrowserRelay): PageReader {
  return new SnapshotPageReader(async (signal) => {
    const outcome = await relay.request({ kind: "snapshot" }, signal);
    if (!outcome.ok || !outcome.snapshot) throw failure(outcome.ok ? "failed" : outcome.reason);
    const { url, title, html } = outcome.snapshot;
    return { url, title, html };
  });
}

export interface BrowserCapabilityOptions {
  /** The queue the chrome page polls. Default: a private relay nobody polls (every call refuses). */
  relay?: BrowserRelay;
}

export function createBrowserCapability(options: BrowserCapabilityOptions = {}) {
  const relay = options.relay ?? new BrowserRelay();

  const run = async (
    action: BrowserAction,
    pageUrl: string,
    signal: AbortSignal,
  ): Promise<{ ok: true; url: string }> => {
    if (action.kind !== "navigate" && !isActionableSelector(action.selector))
      throw failure("bad_selector");
    if (action.kind === "type" && action.text.length > MAX_TYPED_CHARS)
      throw refuse("bad_text", "Text is too long");
    await revalidate(relay, action, pageUrl, signal);
    const body: RelayRequestBody =
      action.kind === "navigate"
        ? { kind: "navigate", expectedUrl: pageUrl, destination: pageKey(action.destination) }
        : action.kind === "type"
          ? { kind: "type", expectedUrl: pageUrl, selector: action.selector, text: action.text }
          : { kind: action.kind, expectedUrl: pageUrl, selector: action.selector };
    const outcome = await ask(relay, body, signal);
    if (!outcome.ok) throw failure(outcome.reason);
    // Only the address crosses back: never the typed text, never page content.
    return { ok: true, url: outcome.url ?? "" };
  };

  const input = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

  return defineCapability({
    manifest: {
      id: BROWSER_CAPABILITY_ID,
      name: "Phoenix browser actions",
      version: "0.1.0",
      description:
        "Lets Fawkes click, type, submit, navigate and download in the ACTIVE tab of the Phoenix browser, for the page you approved. Core asks you to confirm every single action and shows the page, the control and, for typing, the full text. Passwords, payment details and other protected fields are refused. Needs the Phoenix browser window to be open.",
      license: "GPL-3.0-or-later",
      homepage: "https://github.com/Thunder-BluePhoenix/Phoenix",
      permissions: ["network"],
      data_categories: [
        "the web page you are on (address, controls)",
        "text you ask Fawkes to type",
      ],
      events: [],
      commands: [
        command("click", "Click one control on the active browser page", {
          pageUrl: PAGE_URL,
          selector: SELECTOR,
        }),
        command("type", "Type text into one field on the active browser page", {
          pageUrl: PAGE_URL,
          selector: SELECTOR,
          text: { type: "string", maxLength: MAX_TYPED_CHARS, [CONFIRM]: true },
        }),
        command("submit", "Submit one form on the active browser page", {
          pageUrl: PAGE_URL,
          selector: SELECTOR,
        }),
        command("navigate", "Open another address in the active browser tab", {
          pageUrl: PAGE_URL,
          destination: { ...PAGE_URL },
        }),
        command("download", "Start a download from one control on the active browser page", {
          pageUrl: PAGE_URL,
          selector: SELECTOR,
        }),
      ],
    },
    shutdown() {
      relay.close();
    },
    health() {
      return relay.attached()
        ? { status: "healthy" as const }
        : { status: "degraded" as const, message: "The Phoenix browser window is not open" };
    },
    commands: {
      click: (raw, ctx) => {
        const i = input(raw);
        return run({ kind: "click", selector: String(i.selector) }, pageKey(i.pageUrl), ctx.signal);
      },
      type: (raw, ctx) => {
        const i = input(raw);
        return run(
          { kind: "type", selector: String(i.selector), text: String(i.text ?? "") },
          pageKey(i.pageUrl),
          ctx.signal,
        );
      },
      submit: (raw, ctx) => {
        const i = input(raw);
        return run(
          { kind: "submit", selector: String(i.selector) },
          pageKey(i.pageUrl),
          ctx.signal,
        );
      },
      navigate: (raw, ctx) => {
        const i = input(raw);
        return run(
          { kind: "navigate", destination: String(i.destination) },
          pageKey(i.pageUrl),
          ctx.signal,
        );
      },
      download: (raw, ctx) => {
        const i = input(raw);
        return run(
          { kind: "download", selector: String(i.selector) },
          pageKey(i.pageUrl),
          ctx.signal,
        );
      },
    },
  });
}
