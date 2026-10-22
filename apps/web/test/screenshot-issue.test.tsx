// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScreenshotIssue } from "../src/components/ScreenshotIssue";
import { ScreenshotDraft, type IssueDraft } from "../src/core/screenshot";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const click = async (label: string) => {
  const button = [...(host?.querySelectorAll("button") ?? [])].find(
    (item) => item.textContent === label,
  );
  if (!button) throw new Error(`Button not found: ${label}`);
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("ScreenshotIssue", () => {
  it("captures only on click and presents a draft before approval", async () => {
    const calls: string[] = [];
    const workflow = new ScreenshotDraft(
      {
        permission: async () => {
          calls.push("permission");
          return true;
        },
        captureRegion: async () => {
          calls.push("capture");
          return null;
        },
      },
      {
        supportsAttachment: () => true,
        approve: async () => {
          calls.push("approve");
          return true;
        },
        create: async () => {
          calls.push("create");
          return { url: "https://example.test/issue" };
        },
      },
    );
    const draft: IssueDraft = {
      tracker: "github",
      project: "org/repo",
      title: "Bug",
      body: "Details",
      attachment: new Blob(),
    };
    vi.spyOn(workflow, "captureOnAction").mockImplementation(async () => {
      calls.push("capture-click");
      return true;
    });
    vi.spyOn(workflow, "preview").mockResolvedValue(draft);
    vi.spyOn(workflow, "render").mockImplementation(() => undefined);
    vi.spyOn(workflow, "createApproved").mockImplementation(async () => {
      calls.push("approve-and-create");
      return { url: "https://example.test/issue" };
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<ScreenshotIssue workflow={workflow} />);
    });
    expect(calls).toEqual([]);
    // The capture seam reports a selected region; a real adapter supplies the size.
    vi.spyOn(workflow, "size", "get").mockReturnValue({ width: 40, height: 30 });
    await click("Choose screen region…");
    expect(calls).toEqual(["capture-click"]);
    expect(host.textContent).toContain("Issue tracker");
    expect([...host.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "GitHub",
      "Linear",
      "Jira",
    ]);
    await click("Preview draft");
    expect(host.querySelector('[aria-label="Draft issue (not created)"]')?.textContent).toContain(
      "Bug",
    );
    expect(calls).toEqual(["capture-click"]);
    await click("Request approval and create issue");
    expect(calls).toEqual(["capture-click", "approve-and-create"]);
    expect(host.textContent).toContain("Issue created:");
  });
  it("renders permission denial without invoking capture", async () => {
    const captureRegion = vi.fn(async () => null);
    const workflow = new ScreenshotDraft(
      { permission: async () => false, captureRegion },
      {
        supportsAttachment: () => false,
        approve: async () => false,
        create: async () => ({ url: "" }),
      },
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<ScreenshotIssue workflow={workflow} />));
    await click("Choose screen region…");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Screen recording permission is required.",
    );
    expect(captureRegion).not.toHaveBeenCalled();
  });
});
