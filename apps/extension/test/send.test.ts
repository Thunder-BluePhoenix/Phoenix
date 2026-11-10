// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The click handler against a fake `chrome` object. No browser was involved.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OUTCOMES, outcomeOf, sendActivePage } from "../src/send.js";

interface Sent {
  host: string;
  message: any;
}

function fakeChrome(opts: {
  selection?: unknown;
  scriptThrows?: boolean;
  reply?: unknown;
  lastError?: boolean;
}) {
  const sent: Sent[] = [];
  const badges: string[] = [];
  const titles: string[] = [];
  const scripts: unknown[] = [];
  const api: any = {
    runtime: {
      lastError: undefined as unknown,
      sendNativeMessage(host: string, message: unknown, cb: (r: unknown) => void) {
        sent.push({ host, message });
        api.runtime.lastError = opts.lastError ? { message: "not found" } : undefined;
        cb(opts.reply);
      },
    },
    scripting: {
      async executeScript(details: unknown) {
        scripts.push(details);
        if (opts.scriptThrows) throw new Error("blocked");
        return [{ result: opts.selection }];
      },
    },
    action: {
      async setBadgeText({ text }: { text: string }) {
        badges.push(text);
      },
      async setTitle({ title }: { title: string }) {
        titles.push(title);
      },
    },
  };
  return { api, sent, badges, titles, scripts };
}

const tab = { id: 7, url: "https://example.com/p?q=1#x", title: "Hello\u202e world" };

describe("Send page to Phoenix (click handler)", () => {
  it("sends one message of exactly url, title and a selection the person made", async () => {
    const c = fakeChrome({
      selection: "picked text",
      reply: { ok: true, id: "pn_" + "0".repeat(24) },
    });
    expect(await sendActivePage(c.api, tab)).toBe("sent");
    expect(c.sent).toEqual([
      {
        host: "dev.phoenix.companion",
        message: {
          kind: "page",
          url: "https://example.com/p?q=1",
          title: "Hello world",
          selection: "picked text",
        },
      },
    ]);
    expect(c.badges).toEqual([OUTCOMES.sent.badge]);
    expect(c.scripts).toHaveLength(1);
  });

  it("omits the selection when nothing is selected or the page refuses the script", async () => {
    for (const opts of [{ selection: "" }, { scriptThrows: true }]) {
      const c = fakeChrome({ ...opts, reply: { ok: true } });
      await sendActivePage(c.api, tab);
      expect("selection" in c.sent[0]!.message).toBe(false);
    }
  });

  it("never injects a script or sends for a page that is not http(s)", async () => {
    const c = fakeChrome({ reply: { ok: true } });
    expect(await sendActivePage(c.api, { id: 1, url: "chrome://extensions", title: "x" })).toBe(
      "unsupported_page",
    );
    expect(c.scripts).toHaveLength(0);
    expect(c.sent).toHaveLength(0);
    expect(c.badges).toEqual(["!"]);
  });

  it("reports a missing host and each host error instead of swallowing it", async () => {
    expect(await sendActivePage(fakeChrome({ lastError: true }).api, tab)).toBe("host_missing");
    for (const error of ["core_unreachable", "token_missing", "token_rejected", "rejected"]) {
      expect(await sendActivePage(fakeChrome({ reply: { ok: false, error } }).api, tab)).toBe(
        error,
      );
    }
    expect(outcomeOf({ ok: false, error: "weird" }, undefined)).toBe("failed");
    expect(outcomeOf(undefined, undefined)).toBe("failed");
  });
});

describe("manifest", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  it("has no host permissions, no content scripts, no remote code and a strict CSP", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions.sort()).toEqual(["activeTab", "nativeMessaging", "scripting"]);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.optional_host_permissions).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.web_accessible_resources).toBeUndefined();
    expect(manifest.externally_connectable).toBeUndefined();
    const csp: string = manifest.content_security_policy.extension_pages;
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/unsafe-|https?:|\*/);
  });
});
