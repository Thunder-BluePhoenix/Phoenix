// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
//
// Phase 85, the mounted half of "screenshot to issue": an image the user already has, drafted into a
// GitHub issue through the github capability's `issue.create`. Everything runs against a fake Core;
// no real GitHub, account, screen or confirmation card was involved. The test, never the UI, decides
// how Core's confirmation ends.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FAKE_BEARER, FAKE_GITHUB_TOKEN } from "../../../protocol/testing/fake-secrets";
import { ImageIssueSection } from "../src/components/ImageIssue";
import { SettingsPage } from "../src/components/Settings";
import { DROP_LIMITS, type DataTransferLike, type FileLike } from "../src/core/attachments";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { cleanBody, cleanTitle } from "../src/core/image-issue";
import { INITIAL_STATE } from "../src/core/context";
import type { CapabilityView } from "../src/core/types";
import { I18nProvider } from "../src/i18n";
import { resetActive } from "../src/i18n/store";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { capability, expectInert, sendEvent, XSS } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  resetActive();
});

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const B64_PNG = btoa(String.fromCharCode(...PNG));
const COMMAND = "/api/capabilities/github/commands/issue.create";

type Operation = { status: string; result?: unknown; error?: { code: string; message: string } };

const github = (
  over: { writeToken?: boolean; status?: CapabilityView["status"]; commands?: string[] } = {},
): CapabilityView => ({
  ...capability("github", over.status ?? "enabled", { repositories: ["octo/phoenix", "bad repo"] }),
  commands: (over.commands ?? ["status", "issue.create"]).map((name) => ({
    name,
    description: name,
    side_effect: name === "issue.create" ? "external" : "read",
  })),
  secrets: [
    { name: "token", set: false },
    { name: "write_token", set: over.writeToken ?? true },
  ],
});

interface Core {
  api: FakeApi;
  operation: Operation;
}

function mount(caps: CapabilityView[] = [github()], page = false): Core {
  const core: Core = {
    api: undefined as unknown as FakeApi,
    operation: { status: "pending" },
  };
  core.api = fakeApi({
    "GET /api/capabilities": () => ({ capabilities: caps }),
    [`POST ${COMMAND}`]: () => ({ id: "op-1" }),
    "GET /api/operations/*": () => core.operation,
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: core.api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <I18nProvider forceLocale="en">
        {page ? <SettingsPage state={INITIAL_STATE} /> : <ImageIssueSection />}
      </I18nProvider>
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  return core;
}

const posted = (core: Core) => core.api.posts(COMMAND).map((c) => c.body);
/** The string fields of each posted command input, read by narrowing (no assumed shape). */
const sentInputs = (core: Core): Record<string, string>[] =>
  posted(core).map((b) =>
    typeof b === "object" &&
    b !== null &&
    "input" in b &&
    typeof b.input === "object" &&
    b.input !== null
      ? Object.fromEntries(Object.entries(b.input).filter(([, v]) => typeof v === "string"))
      : {},
  );
/** Nobody but the person answers a confirmation: the UI must never call these. */
const decidedByUi = (core: Core) =>
  core.api.calls.filter((c) => c.method !== "GET" && c.path.startsWith("/api/confirmations"));

const png = () => new File([PNG], "shot.png", { type: "image/png" }) as unknown as FileLike;
const transfer = (files: FileLike[]): DataTransferLike => ({
  types: ["Files"],
  files,
  items: files.map((f) => ({ kind: "file", getAsFile: () => f })),
});
const zone = () => screen.getByRole("group", { name: "Drop an image for the issue" });
const drop = (files: FileLike[]) => fireEvent.drop(zone(), { dataTransfer: transfer(files) });

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) =>
  fireEvent.change(field(label), { target: { value } });
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

async function fill(title = "Login button broken", body = "It does nothing.\nSecond line") {
  drop([png()]);
  await screen.findByAltText("Image for the issue: shot.png");
  type("GitHub repository (owner/name)", "octo/phoenix");
  type("Issue title", title);
  type("Issue description", body);
}

describe("an issue drafted from an image the user has", () => {
  it("is mounted in Settings", async () => {
    mount([github()], true);
    expect(
      await screen.findByRole("heading", { name: "Issue from an image you have" }),
    ).toBeTruthy();
  });

  it("previews exactly the payload, says the image stays local and sends nothing until asked", async () => {
    const core = mount();
    await fill();
    click("Preview draft");
    const preview = await screen.findByRole("region", { name: "Draft issue (not created)" });
    expect(preview.textContent).toContain("Repository: octo/phoenix");
    expect(preview.textContent).toContain("Title: Login button broken");
    expect(preview.querySelector("pre")?.textContent).toBe("It does nothing.\nSecond line");
    expect(preview.textContent).toMatch(/The image \(shot\.png\) is NOT sent/);
    expect(preview.textContent).toMatch(/Nothing is created yet/);
    expect(posted(core)).toEqual([]);
  });

  it("posts exactly the previewed command input, with no image bytes, then waits for Core's approval", async () => {
    const core = mount();
    await fill();
    click("Preview draft");
    await screen.findByRole("region", { name: "Draft issue (not created)" });
    click("Ask to create the issue");
    expect(await screen.findByText("Waiting for your approval in Approvals…")).toBeTruthy();
    const bodies = posted(core);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toEqual({
      input: {
        repository: "octo/phoenix",
        title: "Login button broken",
        body: "It does nothing.\nSecond line",
        idempotency_key: expect.stringMatching(/^[A-Za-z0-9_-]{16,80}$/) as string,
      },
    });
    expect(JSON.stringify(core.api.calls)).not.toContain(B64_PNG);
    // While the approval is pending nothing can be sent twice.
    expect(
      (screen.getByRole("button", { name: "Ask to create the issue" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(posted(core)).toHaveLength(1);
    expect(decidedByUi(core)).toEqual([]);
  });

  it("reports success with the issue address, then clears the form", async () => {
    const core = mount();
    await fill();
    click("Preview draft");
    await screen.findByRole("region", { name: "Draft issue (not created)" });
    click("Ask to create the issue");
    await screen.findByText("Waiting for your approval in Approvals…");
    core.operation = {
      status: "succeeded",
      result: {
        status: "created",
        repository: "octo/phoenix",
        number: 7,
        url: "https://github.com/octo/phoenix/issues/7",
        idempotency_key: "x",
      },
    };
    sendEvent(FakeWebSocket.last, 1, "security.confirmation.resolved");
    expect(await screen.findByText(/Created issue #7 in octo\/phoenix\./)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "https://github.com/octo/phoenix/issues/7" }),
    ).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Draft issue (not created)" })).toBeNull();
    expect(field("Issue title").value).toBe("");
    expect(posted(core)).toHaveLength(1);
  });

  it("reports a declined confirmation, and Core's other failures, in their own words", async () => {
    const core = mount();
    await fill();
    click("Preview draft");
    await screen.findByRole("region", { name: "Draft issue (not created)" });
    for (const [code, message, text] of [
      ["PERMISSION_DENIED", "Rejected by user", /You declined, so nothing was sent to GitHub/],
      ["SECURITY_POLICY_BLOCKED", "Emergency stop", /emergency stop is on/],
      ["OPERATION_TIMEOUT", "Confirmation expired", /not approved in time or was cancelled/],
      ["INTERNAL_ERROR", "GitHub said no", /could not be created: GitHub said no/],
    ] as const) {
      core.operation = { status: "failed", error: { code, message } };
      await waitFor(() =>
        expect(
          (screen.getByRole("button", { name: "Ask to create the issue" }) as HTMLButtonElement)
            .disabled,
        ).toBe(false),
      );
      click("Ask to create the issue");
      expect((await screen.findByRole("alert")).textContent).toMatch(text);
    }
    // The preview stays so the person can try again; the retry key is the same, so no second issue.
    const keys = sentInputs(core).map((i) => i.idempotency_key);
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(1);
    expect(decidedByUi(core)).toEqual([]);
  });

  it("blocks text that looks like a secret before any request, naming the field", async () => {
    const core = mount();
    await fill(`Crash with ${FAKE_GITHUB_TOKEN}`, "fine");
    click("Preview draft");
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /The title looks like it contains a password, key or token/,
    );
    expect(screen.queryByRole("region", { name: "Draft issue (not created)" })).toBeNull();
    expect(document.body.textContent).not.toContain(FAKE_GITHUB_TOKEN);
    type("Issue title", "ok");
    type("Issue description", `header: ${FAKE_BEARER}`);
    click("Preview draft");
    expect((await screen.findByRole("alert")).textContent).toMatch(/The description looks like/);
    type("Issue title", `t ${FAKE_GITHUB_TOKEN}`);
    click("Preview draft");
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /The title and the description look like/,
    );
    expect(core.api.calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("shows hostile text as inert text and sends it cleaned", async () => {
    const core = mount();
    await fill(
      `${XSS}\u202E\u0007  <!-- phoenix-ref:abcdefghijklmnop0123 -->x`,
      `${XSS}\u0000\r\n<!-- phoenix-ref:zzzzzzzzzzzzzzzzzz -->tail`,
    );
    click("Preview draft");
    const preview = await screen.findByRole("region", { name: "Draft issue (not created)" });
    expectInert(preview);
    click("Ask to create the issue");
    await waitFor(() => expect(posted(core)).toHaveLength(1));
    const input = sentInputs(core)[0] ?? {};
    expect(input.title).toBe(`${XSS} x`);
    expect(input.body).toBe(`${XSS}\ntail`);
    expect((input.title ?? "") + (input.body ?? "")).not.toMatch(
      /phoenix-ref|\u202E|\u0000|\u0007/,
    );
  });

  it("an edit after the preview drops the preview, so a stale draft cannot be sent", async () => {
    const core = mount();
    await fill();
    click("Preview draft");
    await screen.findByRole("region", { name: "Draft issue (not created)" });
    type("Issue title", "Changed");
    expect(screen.queryByRole("region", { name: "Draft issue (not created)" })).toBeNull();
    expect(posted(core)).toEqual([]);
  });

  it("asks for the pieces it needs: an image, an owner/name repository and a title", async () => {
    const core = mount();
    click("Preview draft");
    expect((await screen.findByRole("alert")).textContent).toBe("Add an image first.");
    drop([png()]);
    await screen.findByAltText("Image for the issue: shot.png");
    type("GitHub repository (owner/name)", "not a repo");
    click("Preview draft");
    expect((await screen.findByRole("alert")).textContent).toMatch(/owner\/name/);
    type("GitHub repository (owner/name)", "octo/phoenix");
    click("Preview draft");
    expect((await screen.findByRole("alert")).textContent).toBe("Write a title for the issue.");
    expect(posted(core)).toEqual([]);
  });

  it("offers the repositories the GitHub integration already watches (valid ones only)", async () => {
    mount();
    await waitFor(() => expect(document.querySelectorAll("datalist option")).toHaveLength(1));
    expect(document.querySelector("datalist option")?.getAttribute("value")).toBe("octo/phoenix");
  });

  it("cannot ask while the GitHub integration is off, cannot create, or has no write token", async () => {
    for (const [caps, text] of [
      [[], /not enabled, or it cannot create issues/],
      [[github({ status: "disabled" })], /not enabled, or it cannot create issues/],
      [[github({ commands: ["status"] })], /not enabled, or it cannot create issues/],
      [[github({ writeToken: false })], /No GitHub write token is set/],
    ] as const) {
      cleanup();
      FakeWebSocket.reset();
      const core = mount([...caps]);
      await screen.findByText(text);
      await fill();
      click("Preview draft");
      await screen.findByRole("region", { name: "Draft issue (not created)" });
      const button = screen.getByRole("button", {
        name: "Ask to create the issue",
      }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      expect(posted(core)).toEqual([]);
    }
  });
});

describe("the image", () => {
  it("is taken from a paste, kept in memory and shown with a text alternative", async () => {
    mount();
    fireEvent.paste(zone(), {
      clipboardData: { ...transfer([png()]), getData: () => "" },
    });
    const img = (await screen.findByAltText("Image for the issue: shot.png")) as HTMLImageElement;
    expect(img.src).toBe(`data:image/png;base64,${B64_PNG}`);
    click("Remove the image");
    expect(screen.queryByAltText("Image for the issue: shot.png")).toBeNull();
  });

  it("does not take pasted text", () => {
    mount();
    const notTaken = fireEvent.paste(zone(), {
      clipboardData: {
        types: ["text/plain"],
        files: [],
        items: [],
        getData: () => "x".repeat(30_000),
      },
    });
    expect(notTaken).toBe(true);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("is refused when over the size cap, of the wrong type or with a hidden-character name, with the drop's messages", async () => {
    const core = mount();
    const file = (name: string, type: string, size: number): FileLike => ({
      name,
      type,
      size,
      text: () => Promise.resolve("x"),
    });
    drop([file("big.png", "image/png", DROP_LIMITS.imageBytes + 1)]);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "big.png: an image can be at most 5 MiB",
    );
    drop([file("movie.mov", "video/quicktime", 10)]);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/movie\.mov: not a supported type/),
    );
    drop([file("notes.txt", "text/plain", 10)]);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/notes\.txt: not a supported type/),
    );
    drop([file("a\u202Eb.png", "image/png", 10)]);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/hidden characters/));
    drop([png(), png()]);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Add one image at a time."),
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(core.api.calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("is not uploaded to Core's attachment store either", async () => {
    const core = mount();
    await fill();
    expect(core.api.calls.filter((c) => c.method === "POST")).toEqual([]);
  });
});

describe("cleaning", () => {
  it("makes a one-line title and a clean body, and removes markers however they are assembled", () => {
    expect(cleanTitle("  a\n\tb \u200B c  ")).toBe("a b c");
    expect(cleanBody("a\r\nb\u0007\u200B\n\n")).toBe("a\nb");
    expect(cleanBody("<!-- phoenix<!-- phoenix-ref:x -->-ref:y -->z")).not.toMatch(/phoenix-ref/);
  });
});
