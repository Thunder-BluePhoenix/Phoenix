// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { FocusController, type FocusNotification } from "../../../core/runtime/src/focus";
import { FocusMode } from "../src/components/FocusMode";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("FocusMode", () => {
  it("starts and stops manually while displaying held notifications", async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const delivered: string[] = [];
    const controller = new FocusController<FocusNotification>(
      { now: () => 0, setTimeout: () => 1, clearTimeout: () => undefined },
      { read: async () => false },
      (notification) => {
        delivered.push(notification.id);
      },
    );
    await act(async () => {
      root?.render(<FocusMode controller={controller} />);
    });
    await act(async () => {
      host
        ?.querySelector("button:last-of-type")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      controller.receive({ id: "ordinary", severity: "warning" });
    });
    expect(host.textContent).toContain("Notifications held: 1");
    expect(delivered).toEqual([]);
    await act(async () => {
      host
        ?.querySelector("button:last-of-type")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(delivered).toEqual(["ordinary"]);
    expect(host.textContent).toContain("Focus is off");
  });
});
