// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DailyDigestCommitPage, DailyDigestPage } from "../src/components/DailyDigest";
import { cleanTitle, digestText, type DailyDigest } from "../src/core/digest";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { FakeWebSocket } from "./fake-ws";
import { fakeApi } from "./fake-api";

afterEach(cleanup);

const SHA = "a".repeat(40);
const digest = (over: Partial<DailyDigest> = {}): DailyDigest => ({
  day: "2026-10-22",
  model: "deterministic-local",
  yesterday: [
    {
      text: "Fixed parser",
      source: {
        kind: "commit",
        href: `#/digest/commit/${SHA}`,
        title: "Fixed parser",
        occurredAt: "2026-10-21T12:00:00Z",
        status: "done",
      },
    },
  ],
  today: [],
  blockers: [],
  endOfDay: [],
  unavailable: [],
  partial: [],
  unattributed: [],
  ...over,
});

function mount(
  ui: (client: PhoenixClient) => React.ReactNode,
  routes: Parameters<typeof fakeApi>[0],
) {
  FakeWebSocket.reset();
  const api = fakeApi(routes);
  const client = new PhoenixClient({
    token: "test",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(<CoreProvider client={client}>{ui(client)}</CoreProvider>);
  return api;
}

describe("daily digest page", () => {
  it("shows each activity with a local source link and copies the citation", async () => {
    const copy = vi.fn(async (_text: string) => {});
    const api = mount(() => <DailyDigestPage copy={copy} />, {
      "GET /api/digest": () => digest(),
      "GET /api/digest/slack": () => ({ enabled: false, available: false, reason: "disabled" }),
    });
    expect(await screen.findByText("Fixed parser")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Source" }).getAttribute("href")).toBe(
      `#/digest/commit/${SHA}`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy with sources" }));
    await waitFor(() =>
      expect(copy).toHaveBeenCalledWith(
        expect.stringContaining(`Fixed parser (#/digest/commit/${SHA})`),
      ),
    );
    expect(screen.getByText("Daily-digest Slack delivery is off.")).toBeTruthy();
    expect(api.calls.filter((call) => call.method === "POST")).toEqual([]);
  });

  it("discloses Slack content, saves the opt-in, and displays the confirmation wait", async () => {
    mount(() => <DailyDigestPage />, {
      "GET /api/digest": () => digest(),
      "GET /api/digest/slack": () => ({ enabled: true, available: true, reason: "ready" }),
      "POST /api/digest/slack": () => new Promise(() => {}),
    });
    expect(await screen.findByText(/unverified event claims/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send to Slack" }));
    expect(await screen.findByText("Waiting for your Core confirmation…")).toBeTruthy();
  });

  it("finding 1: labels unavailable, partial and unattributed sources and puts them in the copy", async () => {
    const copy = vi.fn(async (_text: string) => {});
    mount(() => <DailyDigestPage copy={copy} />, {
      "GET /api/digest": () =>
        digest({
          yesterday: [],
          unavailable: ["git"],
          partial: ["events"],
          unattributed: ["git"],
        }),
    });
    const notice = await screen.findByRole("alert", { name: "Incomplete digest" });
    expect(notice.textContent).toContain("Could not be read");
    expect(notice.textContent).toContain("git repositories");
    expect(notice.textContent).toContain("Only the newest records were read");
    expect(notice.textContent).toContain("event history");
    expect(notice.textContent).toContain("No git identity");
    // An empty section on an incomplete digest never claims the day was empty.
    expect(screen.queryByText("No linked activity")).toBeNull();
    expect(screen.getAllByText("Nothing found in the sources that could be read.").length).toBe(4);
    fireEvent.click(screen.getByRole("button", { name: "Copy with sources" }));
    await waitFor(() => expect(copy).toHaveBeenCalled());
    const pasted = copy.mock.calls[0]![0];
    expect(pasted.startsWith("! Could not be read")).toBe(true);
  });

  it("finding 4: the pasted text carries only cleaned titles", () => {
    const text = digestText(
      digest({
        yesterday: [
          {
            text: "evil\u202E\nfake line\u0007",
            source: { ...digest().yesterday[0]!.source },
          },
        ],
      }),
      {
        yesterday: "Y",
        today: "T",
        blockers: "B",
        endOfDay: "E",
        none: "-",
        notices: [],
      },
    );
    expect(text).toContain("- evil fake line (#/digest/commit/");
    expect(text).not.toMatch(/[\u202E\u0007]/);
    expect(cleanTitle("a\u200Bb\n\nc")).toBe("ab c");
    expect(Array.from(cleanTitle("y".repeat(400)))).toHaveLength(200);
  });
});

describe("finding 6: commit evidence opens in the app with the session token", () => {
  it("loads the commit through the authenticated client, not a plain link", async () => {
    const api = mount(() => <DailyDigestCommitPage sha={SHA} />, {
      [`GET /api/digest/commit/${SHA}`]: () => ({
        sha: SHA,
        title: "Fixed parser",
        occurredAt: "2026-10-21T12:00:00Z",
      }),
    });
    expect(await screen.findByText("Fixed parser")).toBeTruthy();
    expect(screen.getByText(SHA)).toBeTruthy();
    expect(api.calls.map((call) => call.path)).toEqual([`/api/digest/commit/${SHA}`]);
    expect(document.querySelector('a[href^="/api/"]')).toBeNull();
  });

  it("says so when the commit is not in a watched repository", async () => {
    mount(() => <DailyDigestCommitPage sha={SHA} />, {});
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("This commit is not in a watched repository.")).toBeTruthy();
  });
});
