// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
//
// The "Ad and tracker blocking" card against a fake Core. No request leaves the test process, and
// the list text served is synthetic: nothing is downloaded from easylist.to.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ShieldsSection } from "../src/components/ShieldsSettings";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { loadShields } from "../src/core/filter-lists";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(cleanup);

type Routes = Parameters<typeof fakeApi>[0];

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await act(async () => Promise.resolve());
}

function clientFor(api: FakeApi): PhoenixClient {
  return new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
}

async function mount(routes: Routes) {
  const api = fakeApi(routes);
  render(
    <CoreProvider client={clientFor(api)}>
      <ShieldsSection />
    </CoreProvider>,
  );
  await flush();
  return api;
}

const click = async (element: HTMLElement) => {
  fireEvent.click(element);
  await flush();
};

const bodies = (api: FakeApi, method: string, path: string) =>
  api.calls.filter((c) => c.method === method && c.path === path).map((c) => c.body);

const LICENCE = "GPL-3.0-or-later OR CC-BY-SA-3.0-or-later";
const NEVER = {
  status: "never",
  enabled: false,
  fetchedAt: null,
  bytes: null,
  sha256: null,
  version: null,
  listTitle: null,
  lastModified: null,
  refreshAfterDays: null,
  dueAt: null,
  rules: null,
};
function list(id: "easylist" | "easyprivacy", over: Record<string, unknown> = {}) {
  return {
    id,
    title: id === "easylist" ? "EasyList" : "EasyPrivacy",
    purpose: id === "easylist" ? "ads" : "trackers",
    homepage: "https://easylist.to/",
    source: `https://easylist.to/easylist/${id}.txt`,
    licence: LICENCE,
    licenceUrl: "https://easylist.to/pages/licence.html",
    attribution: "The EasyList authors (https://easylist.to/)",
    ...NEVER,
    ...over,
  };
}
const READY = {
  status: "ready",
  fetchedAt: "2026-10-20T10:00:00.000Z",
  bytes: 2_000_000,
  sha256: "0".repeat(64),
  version: "202610200000",
  listTitle: "EasyList",
  lastModified: "20 Oct 2026 10:00 UTC",
  refreshAfterDays: 4,
  dueAt: "2026-10-24T10:00:00.000Z",
  rules: { network: 61234, exceptions: 1000, cosmetic: 24000 },
};

function coreRoutes(over: Routes = {}): Routes {
  let lists = [list("easylist"), list("easyprivacy")];
  let shields = { enabled: true, offSites: [] as string[] };
  const body = (b: unknown, key: string) =>
    b !== null && typeof b === "object" && key in b
      ? Object.entries(b).find(([k]) => k === key)?.[1]
      : undefined;
  return {
    "GET /api/browser/filter-lists": () => ({ lists, shields }),
    "POST /api/browser/filter-lists/easylist/update": () => {
      lists = lists.map((l) => (l.id === "easylist" ? list("easylist", READY) : l));
      return { list: lists[0] };
    },
    "PUT /api/browser/filter-lists/easylist": (b) => {
      lists = lists.map((l) =>
        l.id === "easylist" ? list("easylist", { ...READY, enabled: body(b, "enabled") }) : l,
      );
      return { lists };
    },
    "DELETE /api/browser/filter-lists/easylist": () => {
      lists = lists.map((l) => (l.id === "easylist" ? list("easylist") : l));
      return { lists };
    },
    "PUT /api/browser/shields": (b) => {
      shields = { ...shields, enabled: body(b, "enabled") === true };
      return { shields };
    },
    "PUT /api/browser/shields/sites/*": (b, url) => {
      const site = decodeURIComponent(url.pathname.split("/").pop() ?? "").toLowerCase();
      const off = new Set(shields.offSites);
      if (body(b, "blocking") === false) off.add(site);
      else off.delete(site);
      shields = { ...shields, offSites: [...off].sort() };
      return { shields };
    },
    ...over,
  };
}

const card = () => within(screen.getByRole("region", { name: "Ad and tracker blocking" }));

describe("ad and tracker blocking card", () => {
  it("says nothing is blocked yet, that Update contacts easylist.to, and lists each list's licence", async () => {
    await mount(coreRoutes());
    const text = screen.getByRole("region", { name: "Ad and tracker blocking" }).textContent ?? "";
    expect(text).toContain("apply in the Phoenix browser when it ships");
    expect(text).toContain("nothing is blocked in any page today");
    expect(text).toContain("this is not a copy of any other browser's shields");
    expect(text).toContain("never downloaded on their own");
    expect(text).toContain("contacts easylist.to once");
    expect(text).toContain("Update contacts https://easylist.to/easylist/easylist.txt");
    expect(text).toContain("Update contacts https://easylist.to/easylist/easyprivacy.txt");
    expect(text).toContain(`Licence: ${LICENCE}. Credit: The EasyList authors`);
    expect(text.match(/Never downloaded\./g)).toHaveLength(2);
    // Nothing is on, and a list that was never downloaded cannot be switched on.
    expect(
      (card().getByRole("checkbox", { name: "Use EasyList" }) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(card().getAllByRole("button", { name: "Download" })).toHaveLength(2);
    expect(card().queryByRole("button", { name: "Delete the downloaded copy" })).toBeNull();
  });

  it("downloads only when the button is pressed, then shows date, rule count and ignored cosmetic rules", async () => {
    const api = await mount(coreRoutes());
    expect(api.calls.filter((c) => c.method === "POST")).toEqual([]);
    await click(card().getAllByRole("button", { name: "Download" })[0] as HTMLElement);
    expect(api.posts("/api/browser/filter-lists/easylist/update")).toHaveLength(1);
    expect(api.posts("/api/browser/filter-lists/easyprivacy/update")).toHaveLength(0);
    const text = screen.getByRole("region", { name: "Ad and tracker blocking" }).textContent ?? "";
    expect(text).toContain("Oct 20, 2026");
    expect(text).toContain("61,234 blocking rules");
    expect(text).toContain("24,000 page-element rules ignored");
    expect(text).toContain("List version 202610200000");
    expect(text).toContain("after Oct 24, 2026");
    expect(text).toContain("Phoenix never checks by itself");
    expect(text).toContain("EasyList was updated.");
    expect(card().getByRole("button", { name: "Update" })).toBeTruthy();
    expect(
      (card().getByRole("checkbox", { name: "Use EasyList" }) as HTMLInputElement).disabled,
    ).toBe(false);
  });

  it("turns a downloaded list on and off with exactly { enabled }, and deletes the copy", async () => {
    const api = await mount(coreRoutes());
    await click(card().getAllByRole("button", { name: "Download" })[0] as HTMLElement);
    await click(card().getByRole("checkbox", { name: "Use EasyList" }));
    expect(bodies(api, "PUT", "/api/browser/filter-lists/easylist")).toEqual([{ enabled: true }]);
    expect(
      (card().getByRole("checkbox", { name: "Use EasyList" }) as HTMLInputElement).checked,
    ).toBe(true);
    await click(card().getByRole("checkbox", { name: "Use EasyList" }));
    expect(bodies(api, "PUT", "/api/browser/filter-lists/easylist")[1]).toEqual({ enabled: false });
    await click(card().getByRole("button", { name: "Delete the downloaded copy" }));
    expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    expect(card().getAllByText("Never downloaded.")).toHaveLength(2);
    expect(screen.getByRole("region").textContent).toContain(
      "The downloaded copy of EasyList was deleted.",
    );
  });

  it("shows a refused update as text and keeps what was there", async () => {
    const api = await mount(
      coreRoutes({
        "POST /api/browser/filter-lists/easylist/update": () =>
          new Response(
            JSON.stringify({
              code: "SECURITY_POLICY_BLOCKED",
              message:
                "EasyList was not updated: the answer was not a filter list; the copy you already have was kept",
              details: [],
            }),
            { status: 403 },
          ),
      }),
    );
    await click(card().getAllByRole("button", { name: "Download" })[0] as HTMLElement);
    expect(api.posts("/api/browser/filter-lists/easylist/update")).toHaveLength(1);
    expect(card().getByRole("alert").textContent).toContain("the copy you already have was kept");
    expect(card().getAllByText("Never downloaded.")).toHaveLength(2);
  });

  it("reports a damaged copy and offers a fresh download, with the list switched off", async () => {
    await mount(
      coreRoutes({
        "GET /api/browser/filter-lists": () => ({
          lists: [list("easylist", { status: "damaged" }), list("easyprivacy")],
          shields: { enabled: true, offSites: [] },
        }),
      }),
    );
    expect(card().getByText(/stored copy is damaged/)).toBeTruthy();
    expect(
      (card().getByRole("checkbox", { name: "Use EasyList" }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(card().getAllByRole("button", { name: "Download" })).toHaveLength(2);
  });

  it("flips the global switch with exactly { enabled }", async () => {
    const api = await mount(coreRoutes());
    const box = card().getByRole("checkbox", {
      name: "Block ads and trackers",
    }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    await click(box);
    expect(bodies(api, "PUT", "/api/browser/shields")).toEqual([{ enabled: false }]);
    expect(
      (card().getByRole("checkbox", { name: "Block ads and trackers" }) as HTMLInputElement)
        .checked,
    ).toBe(false);
  });

  it("adds and removes sites with exactly { blocking }, host names only, encoded in the path", async () => {
    const api = await mount(coreRoutes());
    expect(card().getByText("No site has blocking turned off.")).toBeTruthy();
    fireEvent.change(card().getByLabelText("Site name, for example example.com"), {
      target: { value: " News.Example.com " },
    });
    await click(card().getByRole("button", { name: "Turn blocking off for this site" }));
    expect(bodies(api, "PUT", "/api/browser/shields/sites/News.Example.com")).toEqual([
      { blocking: false },
    ]);
    expect(card().getByText("news.example.com")).toBeTruthy();
    expect(
      (card().getByLabelText("Site name, for example example.com") as HTMLInputElement).value,
    ).toBe("");
    await click(card().getByRole("button", { name: "Turn blocking back on for news.example.com" }));
    expect(bodies(api, "PUT", "/api/browser/shields/sites/news.example.com")).toEqual([
      { blocking: true },
    ]);
    expect(card().getByText("No site has blocking turned off.")).toBeTruthy();
  });

  it("shows Core's refusal of a site name as text", async () => {
    await mount(
      coreRoutes({
        "PUT /api/browser/shields/sites/*": () =>
          new Response(
            JSON.stringify({
              code: "INVALID_REQUEST",
              message: "Give a site name such as example.com, without https:// or a path",
              details: [],
            }),
            { status: 400 },
          ),
      }),
    );
    fireEvent.change(card().getByLabelText("Site name, for example example.com"), {
      target: { value: "exa mple.com" },
    });
    await click(card().getByRole("button", { name: "Turn blocking off for this site" }));
    expect(card().getByRole("alert").textContent).toContain("without https://");
    expect(card().getByText("No site has blocking turned off.")).toBeTruthy();
  });

  it("says 'not available' with no controls when Core lacks the feature, and a failure as text", async () => {
    await mount({});
    expect(card().getByText(/not available/)).toBeTruthy();
    expect(card().queryAllByRole("checkbox")).toHaveLength(0);
    cleanup();
    await mount({
      "GET /api/browser/filter-lists": () => new Response("{}", { status: 500 }),
    });
    expect(card().getByRole("alert").textContent).toContain("could not be read");
  });
});

describe("building the shields from Core", () => {
  const ads = "[Adblock Plus 2.0]\n||ads.test^\n";

  it("loads only enabled, downloaded lists, and takes the YouTube exemption from the music policy", async () => {
    const api = fakeApi({
      "GET /api/browser/filter-lists": () => ({
        lists: [
          list("easylist", { ...READY, enabled: true }),
          list("easyprivacy", { ...READY, enabled: false }),
        ],
        shields: { enabled: true, offSites: ["off.test"] },
      }),
      "GET /api/browser/filter-lists/easylist/text": () => ({ id: "easylist", text: ads }),
      "GET /api/music/connectors": () => ({
        sites: [
          {
            site: "youtube",
            hosts: ["www.youtube.com"],
            enabled: true,
            adBlocking: "exempt",
            reason: "",
          },
        ],
      }),
    });
    const shields = await loadShields(clientFor(api));
    expect(api.calls.map((c) => c.path)).toEqual([
      "/api/browser/filter-lists",
      "/api/browser/filter-lists/easylist/text",
      "/api/music/connectors",
    ]);
    expect(shields.source).toBe("lists");
    expect(shields.offSites).toEqual(["off.test"]);
    const request = (documentUrl: string) =>
      shields.decide({ url: "https://ads.test/a.js", documentUrl, type: "script" });
    expect(request("https://news.test/").blocked).toBe(true);
    expect(request("https://off.test/").exempt).toBe("site_off");
    expect(request("https://www.youtube.com/watch").exempt).toBe("site_ads_exempt");
  });

  it("uses the starter rules when no list is on, and no exemption when the music policy is unreachable", async () => {
    const api = fakeApi({
      "GET /api/browser/filter-lists": () => ({
        lists: [list("easylist"), list("easyprivacy")],
        shields: { enabled: true, offSites: [] },
      }),
    });
    const shields = await loadShields(clientFor(api));
    expect(shields.source).toBe("starter");
    expect(
      shields.decide({
        url: "https://securepubads.g.doubleclick.net/t.js",
        documentUrl: "https://www.youtube.com/",
        type: "script",
      }).blocked,
    ).toBe(true);
  });
});
