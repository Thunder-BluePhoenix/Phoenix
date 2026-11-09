// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
//
// Phase 85: creating a Linear or Jira issue from a capture and then, only after a SECOND explicit
// step, attaching the redacted PNG. Everything runs against a fake Core and a fake canvas: no
// screen, tracker, account or approval card was involved. The test, never the UI, decides how
// Core's confirmations end, and the UI never calls /api/confirmations.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenshotIssueSection } from "../src/components/ScreenshotIssueSection";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { createCoreIssueClient } from "../src/core/screen-region";
import type { CapabilityView } from "../src/core/types";
import { I18nProvider } from "../src/i18n";
import { resetActive } from "../src/i18n/store";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { capability } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetActive();
});

const CAPTURE = "/api/capabilities/screen-region/commands/capture_region";
const LINEAR_CREATE = "/api/capabilities/issues/commands/linear.issue.create";
const JIRA_CREATE = "/api/capabilities/issues/commands/jira.issue.create";
const LINEAR_ATTACH = "/api/capabilities/issues/commands/linear.issue.attach";
const JIRA_ATTACH = "/api/capabilities/issues/commands/jira.issue.attach";
const TEAM = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";

type Operation = { status: string; result?: unknown; error?: { code: string; message: string } };

function pngBytes(pad = 0): Uint8Array {
  const out = new Uint8Array(8 + 25 + pad + 12);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(out.buffer);
  view.setUint32(8, 13);
  out.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, 4);
  view.setUint32(20, 4);
  out.set([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82], out.length - 12);
  return out;
}
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const caps = (secrets = true): CapabilityView[] => [
  {
    ...capability("screen-region", "enabled"),
    permissions: [{ permission: "screen_capture", description: "Capture", granted: true }],
    commands: [{ name: "capture_region", description: "c", side_effect: "execute" }],
  },
  {
    ...capability("issues", "enabled"),
    commands: [
      "linear.issue.create",
      "jira.issue.create",
      "linear.issue.attach",
      "jira.issue.attach",
    ].map((name) => ({ name, description: name, side_effect: "external" })),
    secrets: secrets
      ? ["linear_write_key", "jira_write_email", "jira_write_token"].map((name) => ({
          name,
          set: true,
        }))
      : [],
  },
];

function fakeCore(operations: Record<string, Operation>) {
  let api: FakeApi;
  api = fakeApi({
    "GET /api/capabilities": () => ({ capabilities: caps() }),
    [`POST ${CAPTURE}`]: () => ({ id: "cap" }),
    [`POST ${LINEAR_CREATE}`]: () => ({ id: "lc" }),
    [`POST ${JIRA_CREATE}`]: () => ({ id: "jc" }),
    [`POST ${LINEAR_ATTACH}`]: () => ({ id: "la" }),
    [`POST ${JIRA_ATTACH}`]: () => ({ id: "ja" }),
    "GET /api/operations/*": (_b, url) => operations[url.pathname.split("/").pop()!]!,
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  return { api, client };
}

const timing = { pollMs: 1, maxWaitMs: 2000 };
const createdLinear = {
  tracker: "linear",
  id: "0a1b2c3d-1111-2222-3333-444455556666",
  key: "ENG-12",
  url: "https://linear.app/acme/issue/ENG-12/x",
};
const createdJira = {
  tracker: "jira",
  id: "10001",
  key: "PROJ-7",
  url: "https://acme.atlassian.net/browse/PROJ-7",
};

describe("the Core issue client", () => {
  it("creates a Linear issue and a Jira issue as text only through the issues commands", async () => {
    const { api, client } = fakeCore({
      lc: { status: "succeeded", result: createdLinear },
      jc: { status: "succeeded", result: createdJira },
    });
    const issues = createCoreIssueClient(client, timing);
    expect(
      await issues.create({
        tracker: "linear",
        project: TEAM,
        title: "Bug\u202e",
        body: "Details",
      }),
    ).toEqual({ url: createdLinear.url, key: "ENG-12" });
    expect(api.posts(LINEAR_CREATE)[0]!.body).toEqual({
      input: { team_id: TEAM, title: "Bug", body: "Details" },
    });
    expect(await issues.create({ tracker: "jira", project: "PROJ", title: "T", body: "" })).toEqual(
      {
        url: createdJira.url,
        key: "PROJ-7",
      },
    );
    expect(api.posts(JIRA_CREATE)[0]!.body).toEqual({ input: { project: "PROJ", title: "T" } });
    for (const path of [LINEAR_CREATE, JIRA_CREATE]) {
      expect(JSON.stringify(api.posts(path))).not.toContain("image");
    }
  });

  it("attach posts the exact prepared input to the tracker's own command and nothing else", async () => {
    const { api, client } = fakeCore({
      la: { status: "succeeded", result: { tracker: "linear", issue: "ENG-12", attached: true } },
    });
    const issues = createCoreIssueClient(client, timing);
    const input = {
      issue: "ENG-12",
      image_base64: b64(pngBytes()),
      bytes: pngBytes().length,
      sha256_prefix: "0123456789ab",
      file_name: "phoenix-screenshot-0123456789ab.png",
    };
    await issues.attach!({
      details: {
        tracker: "linear",
        issue: "ENG-12",
        fileName: input.file_name,
        bytes: input.bytes,
        sha256Prefix: input.sha256_prefix,
      },
      input,
    });
    expect(api.posts(LINEAR_ATTACH)).toHaveLength(1);
    expect(api.posts(LINEAR_ATTACH)[0]!.body).toEqual({ input });
    expect(api.posts(JIRA_ATTACH)).toHaveLength(0);
    expect(api.calls.filter((c) => c.path.startsWith("/api/confirmations"))).toHaveLength(0);
  });

  it.each([
    ["PERMISSION_DENIED", /You declined/],
    ["SECURITY_POLICY_BLOCKED", /emergency stop/],
    ["CAPABILITY_UNAVAILABLE", /could not be created/],
  ])("a failed attach (%s) is an error, never a success", async (code, message) => {
    const { client } = fakeCore({ ja: { status: "failed", error: { code, message: "x" } } });
    await expect(
      createCoreIssueClient(client, timing).attach!({
        details: { tracker: "jira", issue: "PROJ-7", fileName: "f", bytes: 1, sha256Prefix: "a" },
        input: {
          issue: "PROJ-7",
          image_base64: "AA==",
          bytes: 1,
          sha256_prefix: "a",
          file_name: "f",
        },
      }),
    ).rejects.toThrow(message);
  });

  it("a reply that is not exactly an attached confirmation is not a success", async () => {
    const { client } = fakeCore({
      ja: { status: "succeeded", result: { attached: true, issue: "OTHER-1" } },
    });
    await expect(
      createCoreIssueClient(client, timing).attach!({
        details: { tracker: "jira", issue: "PROJ-7", fileName: "f", bytes: 1, sha256Prefix: "a" },
        input: {
          issue: "PROJ-7",
          image_base64: "AA==",
          bytes: 1,
          sha256_prefix: "a",
          file_name: "f",
        },
      }),
    ).rejects.toThrow();
  });
});

describe("the mounted flow", () => {
  function setup(operations: Record<string, Operation>) {
    const { api, client } = fakeCore(operations);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 40, height: 30, close: vi.fn() })),
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
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) =>
      callback(new Blob([pngBytes(64).buffer as ArrayBuffer], { type: "image/png" })),
    );
    render(
      <CoreProvider client={client}>
        <I18nProvider forceLocale="en">
          <ScreenshotIssueSection />
        </I18nProvider>
      </CoreProvider>,
    );
    act(() => FakeWebSocket.last.open());
    return api;
  }

  async function capture(api: FakeApi) {
    fireEvent.click(await screen.findByRole("button", { name: "Choose screen region…" }));
    await screen.findByLabelText("Issue title");
    expect(api.posts(CAPTURE)).toHaveLength(1);
  }

  async function fill(tracker: "linear" | "jira", project: string) {
    fireEvent.change(screen.getByLabelText("Issue tracker"), { target: { value: tracker } });
    fireEvent.change(
      screen.getByLabelText("GitHub repository (owner/name), Linear team ID or Jira project key"),
      {
        target: { value: project },
      },
    );
    fireEvent.change(screen.getByLabelText("Issue title"), { target: { value: "Broken" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview draft" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Request approval and create issue" }),
    );
  }

  const captureOp: Operation = {
    status: "succeeded",
    result: {
      status: "captured",
      mime: "image/png",
      width: 40,
      height: 30,
      bytes: pngBytes().length,
      image: b64(pngBytes()),
      expired: false,
    },
  };

  it("creating a Jira issue offers the attach step but uploads nothing by itself", async () => {
    const api = setup({ cap: captureOp, jc: { status: "succeeded", result: createdJira } });
    await capture(api);
    await fill("jira", "PROJ");
    expect(await screen.findByText(/PROJ-7 was created without the image/)).toBeTruthy();
    expect(api.posts(JIRA_CREATE)).toHaveLength(1);
    expect(api.posts(JIRA_ATTACH)).toHaveLength(0);
    expect(api.posts(LINEAR_ATTACH)).toHaveLength(0);
    // Even reviewing what would be attached sends nothing.
    fireEvent.click(screen.getByRole("button", { name: "Show what would be attached" }));
    expect(await screen.findByText(/File name: phoenix-screenshot-[0-9a-f]{12}\.png/)).toBeTruthy();
    expect(screen.getByText(/Size: \d+ bytes/)).toBeTruthy();
    expect(
      screen.getByText(/Content hash \(SHA-256, first 12 characters\): [0-9a-f]{12}/),
    ).toBeTruthy();
    expect(screen.getByText("Issue: PROJ-7")).toBeTruthy();
    expect(api.posts(JIRA_ATTACH)).toHaveLength(0);
  });

  it("needs the confirmation tick, then the attach button, then Core's own approval", async () => {
    const api = setup({
      cap: captureOp,
      jc: { status: "succeeded", result: createdJira },
      ja: { status: "succeeded", result: { tracker: "jira", issue: "PROJ-7", attached: true } },
    });
    await capture(api);
    await fill("jira", "PROJ");
    fireEvent.click(await screen.findByRole("button", { name: "Show what would be attached" }));
    const send = (await screen.findByRole("button", {
      name: "Request approval and attach",
    })) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(send);
    expect(api.posts(JIRA_ATTACH)).toHaveLength(0);
    fireEvent.click(screen.getByRole("checkbox", { name: /Yes, upload this image to Jira/ }));
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    expect(await screen.findByText("The screenshot was attached to PROJ-7.")).toBeTruthy();
    const posts = api.posts(JIRA_ATTACH);
    expect(posts).toHaveLength(1);
    const sent = posts[0]!.body;
    if (typeof sent !== "object" || sent === null || !("input" in sent))
      throw new Error("no input");
    const input = sent.input as Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual([
      "bytes",
      "file_name",
      "image_base64",
      "issue",
      "sha256_prefix",
    ]);
    expect(input.issue).toBe("PROJ-7");
    expect(input.file_name).toMatch(/^phoenix-screenshot-[0-9a-f]{12}\.png$/);
    expect(api.calls.filter((c) => c.path.startsWith("/api/confirmations"))).toHaveLength(0);
    // Linear's command was never touched.
    expect(api.posts(LINEAR_ATTACH)).toHaveLength(0);
  });

  it("a declined attach confirmation shows an error and the issue stays text only", async () => {
    const api = setup({
      cap: captureOp,
      lc: { status: "succeeded", result: createdLinear },
      la: { status: "failed", error: { code: "PERMISSION_DENIED", message: "x" } },
    });
    await capture(api);
    await fill("linear", TEAM);
    fireEvent.click(await screen.findByRole("button", { name: "Show what would be attached" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /upload this image to Linear/ }));
    fireEvent.click(screen.getByRole("button", { name: "Request approval and attach" }));
    expect((await screen.findByRole("alert")).textContent).toContain("You declined");
    expect(screen.queryByText("The screenshot was attached to ENG-12.")).toBeNull();
  });

  it("GitHub never gets an attach step", async () => {
    const api = setup({
      cap: captureOp,
      gh: {
        status: "succeeded",
        result: {
          status: "created",
          repository: "octo/phoenix",
          number: 7,
          url: "https://github.com/octo/phoenix/issues/7",
        },
      },
    });
    await capture(api);
    expect(screen.queryByText(/Attach the screenshot/)).toBeNull();
    // Whatever happens, no attach command exists for GitHub.
    expect(api.calls.filter((c) => c.path.includes("attach"))).toHaveLength(0);
    await waitFor(() => expect(screen.queryByRole("button", { name: /attach/i })).toBeNull());
  });
});
