// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
//
// Phase 85: the capture/annotate ScreenshotIssue mounted in Settings over Core's `screen-region`
// capability. Everything runs against a fake Core and a fake image decoder: no screen, macOS
// selector, Screen Recording permission, GitHub account or confirmation card was involved. The
// test, never the UI, decides how Core's confirmations end.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenshotIssueSection } from "../src/components/ScreenshotIssueSection";
import { SettingsPage } from "../src/components/Settings";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider, INITIAL_STATE } from "../src/core/context";
import {
  captureUnavailable,
  createCoreIssueClient,
  createCoreRegionCapture,
  MAX_CAPTURE_BYTES,
} from "../src/core/screen-region";
import type { CapabilityView } from "../src/core/types";
import { I18nProvider } from "../src/i18n";
import { resetActive } from "../src/i18n/store";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { capability } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  resetActive();
  vi.unstubAllGlobals();
});

const CAPTURE = "/api/capabilities/screen-region/commands/capture_region";
const ISSUE = "/api/capabilities/github/commands/issue.create";

const pngBytes = (extra = 0) => {
  const out = new Uint8Array(40 + extra);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return out;
};
const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const PNG_B64 = b64(pngBytes());

type Operation = { status: string; result?: unknown; error?: { code: string; message: string } };

const screenRegion = (
  over: { status?: CapabilityView["status"]; granted?: boolean; commands?: string[] } = {},
): CapabilityView => ({
  ...capability("screen-region", over.status ?? "enabled"),
  permissions: [
    { permission: "screen_capture", description: "Capture", granted: over.granted ?? true },
  ],
  commands: (over.commands ?? ["capture_region"]).map((name) => ({
    name,
    description: name,
    side_effect: "execute",
  })),
});
const github = (): CapabilityView => ({
  ...capability("github", "enabled", { repositories: [] }),
  commands: [{ name: "issue.create", description: "create", side_effect: "external" }],
  secrets: [{ name: "write_token", set: true }],
});

interface Core {
  api: FakeApi;
  operations: Record<string, Operation>;
}

function fakeCore(caps: CapabilityView[], operations: Record<string, Operation>) {
  const core: Core = { api: undefined as unknown as FakeApi, operations };
  core.api = fakeApi({
    "GET /api/capabilities": () => ({ capabilities: caps }),
    [`POST ${CAPTURE}`]: () => ({ id: "cap-1" }),
    [`POST ${ISSUE}`]: () => ({ id: "iss-1" }),
    "GET /api/operations/*": (_b, url) => core.operations[url.pathname.split("/").pop()!]!,
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: core.api.fetchImpl,
  });
  return { core, client };
}

function mount(caps: CapabilityView[], operations: Record<string, Operation>, page = false) {
  const { core, client } = fakeCore(caps, operations);
  render(
    <CoreProvider client={client}>
      <I18nProvider forceLocale="en">
        {page ? <SettingsPage state={INITIAL_STATE} /> : <ScreenshotIssueSection />}
      </I18nProvider>
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  return core;
}

/** A decoder and canvas the test controls: happy-dom has neither. */
function fakeImaging() {
  const bitmaps: { width: number; height: number; close: () => void }[] = [];
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => {
      const bitmap = { width: 40, height: 30, close: vi.fn() };
      bitmaps.push(bitmap);
      return bitmap;
    }),
  );
  const ctx = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  return { bitmaps, ctx };
}

const capturePosts = (core: Core) => core.api.posts(CAPTURE);
const decidedByUi = (core: Core) =>
  core.api.calls.filter((c) => c.method !== "GET" && c.path.startsWith("/api/confirmations"));
const button = (name: string) => screen.getByRole("button", { name });

describe("screenshot to issue, mounted", () => {
  it("is in Settings and captures nothing on load", async () => {
    fakeImaging();
    const core = mount([screenRegion(), github()], {}, true);
    expect(
      await screen.findByRole("heading", { name: "Capture a region for an issue" }),
    ).toBeTruthy();
    await screen.findByRole("button", { name: "Choose screen region…" });
    expect(capturePosts(core)).toHaveLength(0);
  });

  it("says why when the capability is off, and offers no capture button", async () => {
    const core = mount([screenRegion({ status: "disabled" })], {});
    expect(await screen.findByText(/Region capture is off/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Choose screen region…" })).toBeNull();
    expect(capturePosts(core)).toHaveLength(0);
  });

  it("offers no capture without the screen capture grant", async () => {
    mount([screenRegion({ granted: false })], {});
    expect(await screen.findByText(/Region capture is off/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Choose screen region…" })).toBeNull();
  });

  it("captures only on the button, shows the image to annotate, and never calls /api/confirmations", async () => {
    const { bitmaps } = fakeImaging();
    const core = mount([screenRegion(), github()], {
      "cap-1": { status: "succeeded", result: captured() },
    });
    const open = await screen.findByRole("button", { name: "Choose screen region…" });
    expect(capturePosts(core)).toHaveLength(0);
    fireEvent.click(open);
    await waitFor(() => expect(bitmaps).toHaveLength(1));
    expect(capturePosts(core)).toHaveLength(1);
    expect(capturePosts(core)[0]!.body).toEqual({ input: {} });
    expect(await screen.findByLabelText("Issue title")).toBeTruthy();
    expect(decidedByUi(core)).toHaveLength(0);
  });

  it("waits while Core asks the person, and sends no second request", async () => {
    fakeImaging();
    const ops: Record<string, Operation> = { "cap-1": { status: "pending" } };
    const core = mount([screenRegion()], ops);
    fireEvent.click(await screen.findByRole("button", { name: "Choose screen region…" }));
    await waitFor(() => expect(capturePosts(core)).toHaveLength(1));
    expect((button("Choose screen region…") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button("Choose screen region…"));
    expect(capturePosts(core)).toHaveLength(1);
  });

  it("treats Esc in the selector as a notice, not an error", async () => {
    const { bitmaps } = fakeImaging();
    const core = mount([screenRegion()], {
      "cap-1": { status: "succeeded", result: { status: "cancelled" } },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Choose screen region…" }));
    expect(
      await screen.findByText("You cancelled the selection, so nothing was captured."),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(bitmaps).toHaveLength(0);
    expect(capturePosts(core)).toHaveLength(1);
  });

  it.each([
    [
      "a declined confirmation",
      { code: "PERMISSION_DENIED", message: "x" },
      "You declined, so nothing was captured.",
    ],
    [
      "the emergency stop",
      { code: "SECURITY_POLICY_BLOCKED", message: "x" },
      "The emergency stop is on, so nothing was captured.",
    ],
    [
      "a timeout",
      { code: "OPERATION_TIMEOUT", message: "x" },
      "No region was chosen in time, or the request was not approved; nothing was captured.",
    ],
    [
      "a capture failure",
      { code: "CAPABILITY_UNAVAILABLE", message: "The macOS capture program reported an error" },
      "The region could not be captured: The macOS capture program reported an error",
    ],
  ])("reports %s and shows no image", async (_n, error, text) => {
    const { bitmaps } = fakeImaging();
    mount([screenRegion()], { "cap-1": { status: "failed", error } });
    fireEvent.click(await screen.findByRole("button", { name: "Choose screen region…" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(text);
    expect(bitmaps).toHaveLength(0);
    expect(screen.queryByLabelText("Issue title")).toBeNull();
  });

  it.each([
    [
      "an unsupported platform",
      { status: "unsupported", platform: "linux" },
      "Region capture is only supported on macOS.",
    ],
    [
      "an expired image",
      { ...captured(), image: null, expired: true },
      "The capture was no longer available. Choose a region again.",
    ],
    [
      "a non-PNG image",
      {
        ...captured(),
        image: b64(
          Uint8Array.from([
            0xff, 0xd8, 0xff, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
            21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34,
          ]),
        ),
      },
      "The capture was not a valid PNG image and was discarded.",
    ],
    [
      "an oversize image",
      { ...captured(), image: "A".repeat(Math.ceil(MAX_CAPTURE_BYTES / 3) * 4 + 4) },
      "The captured region is larger than 5 MiB and was discarded.",
    ],
    [
      "a wrong type",
      { ...captured(), mime: "image/jpeg" },
      "The capture was not a valid PNG image and was discarded.",
    ],
  ])("refuses %s from Core", async (_n, result, text) => {
    const { bitmaps } = fakeImaging();
    mount([screenRegion()], { "cap-1": { status: "succeeded", result } });
    fireEvent.click(await screen.findByRole("button", { name: "Choose screen region…" }));
    expect((await screen.findByRole("alert")).textContent).toContain(text);
    expect(bitmaps).toHaveLength(0);
  });
});

function captured() {
  return {
    status: "captured",
    mime: "image/png",
    width: 40,
    height: 30,
    bytes: 40,
    image: PNG_B64,
    expired: false,
  };
}

describe("the Core adapters", () => {
  const timing = { pollMs: 1, maxWaitMs: 50 };

  it("reads availability from Core's own view", () => {
    expect(captureUnavailable([screenRegion()])).toBe(false);
    expect(captureUnavailable([])).toBe(true);
    expect(captureUnavailable([screenRegion({ commands: [] })])).toBe(true);
    expect(captureUnavailable([screenRegion({ granted: false })])).toBe(true);
  });

  it("gives up waiting after the limit and reports a timeout", async () => {
    const { client } = fakeCore([screenRegion()], { "cap-1": { status: "pending" } });
    await expect(createCoreRegionCapture(client, timing).captureRegion()).rejects.toThrow(
      /No region was chosen in time/,
    );
  });

  it("returns the PNG blob, with the PNG type, for a captured result", async () => {
    const { client } = fakeCore([screenRegion()], {
      "cap-1": { status: "succeeded", result: captured() },
    });
    const blob = await createCoreRegionCapture(client, timing).captureRegion();
    expect(blob?.type).toBe("image/png");
    expect(blob?.size).toBe(40);
  });

  it("creates text only, GitHub only, with the cleaned text and no image", async () => {
    const ops: Record<string, Operation> = {
      "iss-1": {
        status: "succeeded",
        result: {
          status: "created",
          repository: "octo/phoenix",
          number: 7,
          url: "https://github.com/octo/phoenix/issues/7",
        },
      },
    };
    const { core, client } = fakeCore([github()], ops);
    const issues = createCoreIssueClient(client, timing);
    expect(issues.supportsAttachment("github")).toBe(false);
    expect(issues.supportsAttachment("linear")).toBe(false);
    const draft = {
      tracker: "github" as const,
      project: "octo/phoenix",
      title: "Bug\u202e",
      body: "Details",
      attachment: null,
    };
    expect(await issues.approve(draft)).toBe(true);
    // approving asks Core nothing: the confirmation is Core's, raised by create.
    expect(core.api.posts(ISSUE)).toHaveLength(0);
    expect(await issues.create(draft)).toEqual({ url: "https://github.com/octo/phoenix/issues/7" });
    const body = core.api.posts(ISSUE)[0]!.body as { input: Record<string, string> };
    expect(Object.keys(body.input).sort()).toEqual([
      "body",
      "idempotency_key",
      "repository",
      "title",
    ]);
    expect(body.input.title).toBe("Bug");
    expect(body.input.repository).toBe("octo/phoenix");
  });

  it.each(["linear", "jira"] as const)("refuses %s visibly and sends nothing", async (tracker) => {
    const { core, client } = fakeCore([github()], {});
    const issues = createCoreIssueClient(client, timing);
    await expect(
      issues.approve({ tracker, project: "octo/phoenix", title: "T", body: "", attachment: null }),
    ).rejects.toThrow(/Only GitHub/);
    expect(core.api.posts(ISSUE)).toHaveLength(0);
  });

  it("refuses secret-looking text before any request", async () => {
    const { core, client } = fakeCore([github()], {});
    const issues = createCoreIssueClient(client, timing);
    const secret = ["gh", "p_", "a".repeat(36)].join("");
    await expect(
      issues.approve({
        tracker: "github",
        project: "octo/phoenix",
        title: "T",
        body: secret,
        attachment: null,
      }),
    ).rejects.toThrow();
    expect(core.api.posts(ISSUE)).toHaveLength(0);
    expect(core.api.calls.filter((c) => c.path === "/api/capabilities")).toHaveLength(0);
  });

  it("reports a declined issue confirmation as an error, never as a created issue", async () => {
    const { client } = fakeCore([github()], {
      "iss-1": { status: "failed", error: { code: "PERMISSION_DENIED", message: "x" } },
    });
    await expect(
      createCoreIssueClient(client, timing).create({
        tracker: "github",
        project: "octo/phoenix",
        title: "T",
        body: "",
        attachment: null,
      }),
    ).rejects.toThrow(/You declined/);
  });
});
