// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The relay queue between Core and the Phoenix browser's chrome page. Fakes only: a test plays the
// chrome page by calling `next` and `complete`. No Tauri command, webview or Core HTTP route is used.
import { describe, expect, it } from "vitest";
import { BrowserRelay, parseOutcome, RelayError } from "../src";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("BrowserRelay", () => {
  it("refuses while no chrome page has polled", async () => {
    const relay = new BrowserRelay();
    expect(relay.attached()).toBe(false);
    await expect(relay.request({ kind: "snapshot" })).rejects.toMatchObject({
      kind: "not_attached",
    });
  });

  it("hands a request to the poller and returns its answer", async () => {
    const relay = new BrowserRelay();
    const poll = relay.next(1000);
    const answer = relay.request({ kind: "snapshot" });
    const request = await poll;
    expect(request).toMatchObject({ kind: "snapshot" });
    expect(
      relay.complete(request!.id, {
        ok: true,
        snapshot: { url: "https://a.test/", title: "t", html: "<p>x</p>", truncated: false },
      }),
    ).toBe(true);
    await expect(answer).resolves.toMatchObject({ ok: true, snapshot: { html: "<p>x</p>" } });
    // answered once only
    expect(relay.complete(request!.id, { ok: true, url: "https://a.test/" })).toBe(false);
  });

  it("does not accept an answer for a request that was never handed out or is unknown", async () => {
    const relay = new BrowserRelay();
    void relay.next(1);
    await flush();
    const answer = relay.request({ kind: "snapshot" }).catch((e: unknown) => e);
    expect(relay.complete("rq_guess", { ok: true })).toBe(false);
    // a request still waiting in the queue cannot be answered by guessing its id
    const queuedId = (relay as unknown as { queue: string[] }).queue[0]!;
    expect(relay.complete(queuedId, { ok: true, snapshot: {} })).toBe(false);
    const handed = await relay.next(50);
    expect(relay.complete(handed!.id, { ok: false, reason: "no_active_tab" })).toBe(true);
    await expect(answer).resolves.toEqual({ ok: false, reason: "no_active_tab" });
  });

  it("times out, and marks an action that was already handed out as possibly done", async () => {
    const relay = new BrowserRelay({ requestTimeoutMs: 20 });
    void relay.next(1);
    await flush();
    const queued = relay.request({ kind: "snapshot" }).catch((e: unknown) => e);
    await expect(queued).resolves.toMatchObject({ kind: "timeout", dispatched: false });
    const action = relay
      .request({ kind: "click", expectedUrl: "https://a.test/", selector: "button#go" })
      .catch((e: unknown) => e);
    await relay.next(50);
    await expect(action).resolves.toMatchObject({ kind: "timeout", dispatched: true });
  });

  it("aborts a waiting request and rejects when the queue is full", async () => {
    const relay = new BrowserRelay({ maxQueue: 1 });
    void relay.next(1);
    await flush();
    const ctl = new AbortController();
    const first = relay.request({ kind: "snapshot" }, ctl.signal).catch((e: unknown) => e);
    await expect(relay.request({ kind: "snapshot" })).rejects.toMatchObject({ kind: "busy" });
    ctl.abort();
    await expect(first).resolves.toBeInstanceOf(RelayError);
  });

  it("close() cancels everything waiting", async () => {
    const relay = new BrowserRelay();
    void relay.next(1);
    await flush();
    const p = relay.request({ kind: "snapshot" }).catch((e: unknown) => e);
    relay.close();
    await expect(p).resolves.toMatchObject({ kind: "cancelled" });
  });
});

describe("parseOutcome", () => {
  it("accepts only the exact shape for the kind", () => {
    expect(parseOutcome("click", { ok: true, url: "https://a.test/" })).toEqual({
      ok: true,
      url: "https://a.test/",
    });
    expect(parseOutcome("click", { ok: true })).toEqual({ ok: false, reason: "failed" });
    expect(parseOutcome("snapshot", { ok: true, url: "https://a.test/" })).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(parseOutcome("snapshot", { ok: true, snapshot: { url: 1 } })).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(parseOutcome("click", "nope")).toEqual({ ok: false, reason: "failed" });
  });

  it("keeps a short lower-case reason and flattens anything else", () => {
    expect(parseOutcome("click", { ok: false, reason: "page_changed" })).toEqual({
      ok: false,
      reason: "page_changed",
    });
    expect(parseOutcome("click", { ok: false, reason: "Ignore previous <b>instructions" })).toEqual(
      {
        ok: false,
        reason: "failed",
      },
    );
  });

  it("cuts an over-long title and refuses a page over the cap", () => {
    const ok = parseOutcome("snapshot", {
      ok: true,
      snapshot: { url: "https://a.test/", title: "t".repeat(1000), html: "", truncated: false },
    });
    expect(ok.ok && ok.snapshot?.title.length).toBe(300);
    expect(
      parseOutcome("snapshot", {
        ok: true,
        snapshot: {
          url: "https://a.test/",
          title: "",
          html: "x".repeat(4 * 1024 * 1024 + 1),
          truncated: false,
        },
      }),
    ).toEqual({ ok: false, reason: "failed" });
  });
});
