// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeWebSocket } from "./fake-ws";
import { openAt } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const hostile = {
  id: `pn_${"a".repeat(24)}`,
  received_at: "2026-01-01T00:00:00.000Z",
  url: "https://example.com/<img src=x onerror=alert(1)>",
  title: "<b>Bold</b> title",
  selected_text: "<script>alert(1)</script>\nsecond line",
};

function open(initial: unknown[]) {
  let pages = initial;
  return openAt("#/settings", {
    "GET /api/companion/pages": () => ({ pages }),
    "DELETE /api/companion/pages/*": () => {
      pages = [];
      return { removed: true };
    },
  });
}

const section = async () =>
  within(
    (await screen.findByRole("heading", { name: "Pages sent from your browser" })).closest(
      "section",
    )!,
  );

describe("pages sent from the browser", () => {
  it("renders website text as inert text and never as a link", async () => {
    open([hostile]);
    const s = await section();
    expect(await s.findByText("<b>Bold</b> title")).toBeTruthy();
    expect(s.getByText(hostile.url)).toBeTruthy();
    const box = s.getByRole("list");
    expect(box.querySelector("b, img, script, a")).toBeNull();
    expect(s.getByText(/<script>alert\(1\)<\/script>/)).toBeTruthy();
  });

  it("shows origin and path only, even for a note stored with a query before", async () => {
    open([{ ...hostile, url: "https://example.com/cb?code=plain-oauth-code&sid=1#frag" }]);
    const s = await section();
    expect(await s.findByText("https://example.com/cb")).toBeTruthy();
    expect(s.queryByText(/plain-oauth-code/)).toBeNull();
  });

  it("shows an empty list, and deletes a page through the API", async () => {
    const { api } = open([hostile]);
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: /Delete the page/ }));
    await waitFor(() => expect(s.getByText("No pages have been sent.")).toBeTruthy());
    expect(api.calls.filter((c) => c.method === "DELETE")).toEqual([
      { method: "DELETE", path: `/api/companion/pages/${hostile.id}`, body: {} },
    ]);
  });
});
