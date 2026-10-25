// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserProfilesSection } from "../src/components/BrowserProfilesSettings";
import { MusicSitesSection } from "../src/components/MusicSitesSettings";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(cleanup);

type Routes = Parameters<typeof fakeApi>[0];

/** Lets pending promises and effects settle without a timer. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await act(async () => Promise.resolve());
}

async function mount(ui: React.ReactElement, routes: Routes) {
  const api = fakeApi(routes);
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(<CoreProvider client={client}>{ui}</CoreProvider>);
  await flush();
  return api;
}

const unavailable = () =>
  new Response(JSON.stringify({ code: "UNAVAILABLE", message: "No secret store" }), {
    status: 503,
  });

const WORK = {
  id: "prof_work",
  name: "Work",
  partition: "persist:phoenix-work",
  syncEnabled: false,
  bookmarks: 2,
  history: 1,
  extensions: 1,
};

const EXTENSION = {
  manifest: {
    id: "ext-dark",
    version: "1.2.0",
    origins: ["https://docs.example.test/*"],
    permissions: ["storage"],
  },
  signer: "host-signer",
  approved: false,
  status: "trusted",
};

/** A request body's field, narrowed instead of cast. */
function field(body: unknown, key: string): unknown {
  return body !== null && typeof body === "object" && key in body
    ? Object.entries(body).find(([k]) => k === key)?.[1]
    : undefined;
}

const click = async (element: HTMLElement) => {
  fireEvent.click(element);
  await flush();
};

const bodies = (api: FakeApi, method: string, path: string) =>
  api.calls.filter((c) => c.method === method && c.path === path).map((c) => c.body);

function profileRoutes(over: Routes = {}): Routes {
  let profiles = [{ ...WORK }];
  let pending: string[] = [];
  return {
    "GET /api/browser/profile-purges": () => ({ pending }),
    "GET /api/browser/profiles": () => ({ profiles }),
    "POST /api/browser/profiles": (body) => {
      const created = { ...WORK, id: "prof_new", name: String(field(body, "name")) };
      profiles = [...profiles, created];
      return created;
    },
    "PUT /api/browser/profiles/prof_work/sync": (body) => {
      profiles = profiles.map((p) => ({ ...p, syncEnabled: field(body, "enabled") === true }));
      return profiles[0];
    },
    "DELETE /api/browser/profiles/prof_work": () => {
      profiles = [];
      pending = ["prof_work"];
      return {
        removed: true,
        purge_partition: "persist:phoenix-work",
        purge: { profile_id: "prof_work", status: "pending" },
      };
    },
    "GET /api/browser/profiles/prof_work/extensions": () => ({ extensions: [EXTENSION] }),
    ...over,
  };
}

const card = (name: string) => within(screen.getByRole("heading", { name }).closest("li")!);

describe("browser profiles card", () => {
  it("says plainly that no browser engine exists and that extensions come from the administrator", async () => {
    await mount(<BrowserProfilesSection />, profileRoutes());
    const text = screen.getByRole("region", { name: "Browser profiles" }).textContent ?? "";
    expect(text).toContain("nothing opens a page here");
    expect(text).toContain("Extensions are installed by your administrator.");
  });

  it("creates a profile with exactly { name }", async () => {
    const api = await mount(<BrowserProfilesSection />, profileRoutes());
    fireEvent.change(screen.getByLabelText("Profile name"), { target: { value: "  Home " } });
    await click(screen.getByRole("button", { name: "Create profile" }));
    expect(bodies(api, "POST", "/api/browser/profiles")).toEqual([{ name: "Home" }]);
    expect(screen.getByRole("heading", { name: "Home" })).toBeTruthy();
  });

  it("turns sync on with exactly { enabled: true } and mentions account sync", async () => {
    const api = await mount(<BrowserProfilesSection />, profileRoutes());
    const work = card("Work");
    expect(work.getByText(/account sync is also set up/).textContent).toContain("Settings → Sync");
    const box = work.getByRole("checkbox", {
      name: "Sync this profile across my devices",
    }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    await click(box);
    expect(bodies(api, "PUT", "/api/browser/profiles/prof_work/sync")).toEqual([{ enabled: true }]);
    expect(box.checked).toBe(true);
  });

  it("removes only after a confirm step, then says the web data is deleted when the browser window opens", async () => {
    const api = await mount(<BrowserProfilesSection />, profileRoutes());
    await click(card("Work").getByRole("button", { name: "Remove profile" }));
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);

    // Cancel backs out without a request.
    await click(card("Work").getByRole("button", { name: "Cancel" }));
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);

    await click(card("Work").getByRole("button", { name: "Remove profile" }));
    await click(card("Work").getByRole("button", { name: "Confirm" }));
    expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Work" })).toBeNull();
    const note = screen.getByText(/Profile removed\./).textContent ?? "";
    expect(note).toContain("deleted when the Phoenix browser window is open");
    expect(note).not.toContain("persist:phoenix-work");
    expect(note).not.toContain("cannot be cleared by Phoenix Core yet");
    // Honest and persistent: the saved web data is still waiting for the browser window.
    expect(
      screen.getByText(/Saved web data of 1 removed profile is waiting/).textContent,
    ).toContain("Open the Phoenix browser to finish.");
  });

  it("shows a persistent pending line from Core on load, and nothing extra when Core has none or cannot answer", async () => {
    await mount(
      <BrowserProfilesSection />,
      profileRoutes({ "GET /api/browser/profile-purges": () => ({ pending: ["a", "b"] }) }),
    );
    expect(screen.getByText(/Saved web data of 2 removed profiles are waiting/)).toBeTruthy();
    cleanup();
    await mount(
      <BrowserProfilesSection />,
      profileRoutes({ "GET /api/browser/profile-purges": () => ({ pending: [] }) }),
    );
    expect(screen.queryByText(/waiting to be deleted/)).toBeNull();
    cleanup();
    await mount(
      <BrowserProfilesSection />,
      profileRoutes({ "GET /api/browser/profile-purges": unavailable }),
    );
    expect(screen.queryByText(/waiting to be deleted/)).toBeNull();
    expect(screen.getByRole("heading", { name: "Work" })).toBeTruthy();
  });

  it("imports exactly { html } and shows the counts", async () => {
    const html = '<DT><A HREF="https://a.example.test/">a</A>';
    const api = await mount(
      <BrowserProfilesSection />,
      profileRoutes({
        "POST /api/browser/profiles/prof_work/bookmarks/import": () => ({
          imported: 1,
          skipped: 2,
        }),
      }),
    );
    const work = card("Work");
    fireEvent.change(work.getByLabelText(/Bookmarks to import/), { target: { value: html } });
    await click(work.getByRole("button", { name: "Import bookmarks" }));
    expect(bodies(api, "POST", "/api/browser/profiles/prof_work/bookmarks/import")).toEqual([
      { html },
    ]);
    expect(work.getByText("Imported 1, skipped 2.")).toBeTruthy();
  });

  it("publishes only a profile that syncs", async () => {
    const api = await mount(
      <BrowserProfilesSection />,
      profileRoutes({
        "GET /api/browser/profiles": () => ({ profiles: [{ ...WORK, syncEnabled: true }] }),
        "POST /api/browser/profiles/prof_work/publish": () => ({ published: true }),
      }),
    );
    await click(card("Work").getByRole("button", { name: "Publish to my other devices" }));
    expect(api.posts("/api/browser/profiles/prof_work/publish")).toHaveLength(1);
    expect(card("Work").getByText("Published.")).toBeTruthy();
  });

  it("disables publishing while the profile does not sync", async () => {
    await mount(<BrowserProfilesSection />, profileRoutes());
    const publish = card("Work").getByRole("button", {
      name: "Publish to my other devices",
    }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
  });

  it("checks other devices and adopts with the revision it was given", async () => {
    const api = await mount(
      <BrowserProfilesSection />,
      profileRoutes({
        "POST /api/browser/sync/pull": () => ({
          remote: [{ id: "prof_laptop", name: "Laptop", revision: "rev-7" }],
        }),
        "POST /api/browser/profiles/prof_laptop/adopt": () => ({
          ...WORK,
          id: "prof_laptop",
          name: "Laptop",
        }),
      }),
    );
    await click(screen.getByRole("button", { name: "Check for profiles from my other devices" }));
    expect(api.posts("/api/browser/sync/pull")).toHaveLength(1);
    await click(screen.getByRole("button", { name: "Adopt Laptop onto this device" }));
    expect(bodies(api, "POST", "/api/browser/profiles/prof_laptop/adopt")).toEqual([
      { revision: "rev-7" },
    ]);
    expect(screen.queryByRole("button", { name: "Adopt Laptop onto this device" })).toBeNull();
  });

  it("says so when no other device has anything new", async () => {
    await mount(
      <BrowserProfilesSection />,
      profileRoutes({ "POST /api/browser/sync/pull": () => ({ remote: [] }) }),
    );
    await click(screen.getByRole("button", { name: "Check for profiles from my other devices" }));
    expect(screen.getByText("No new profiles from your other devices.")).toBeTruthy();
  });

  it("shows an extension and waits while the approval question is open, then PUTs { approved: true }", async () => {
    const answer = Promise.withResolvers<unknown>();
    const api = await mount(
      <BrowserProfilesSection />,
      profileRoutes({
        "PUT /api/browser/profiles/prof_work/extensions/ext-dark/approval": () => answer.promise,
      }),
    );
    const ext = card("Work");
    expect(ext.getByText("ext-dark")).toBeTruthy();
    expect(ext.getByText("Version 1.2.0")).toBeTruthy();
    expect(ext.getByText("Sites: https://docs.example.test/*")).toBeTruthy();
    expect(ext.getByText("Permissions: storage")).toBeTruthy();
    expect(ext.getByText("Not approved")).toBeTruthy();

    await click(ext.getByRole("button", { name: "Approve extension ext-dark" }));
    expect(ext.getByText("Waiting for your answer to the approval question…")).toBeTruthy();
    expect(
      bodies(api, "PUT", "/api/browser/profiles/prof_work/extensions/ext-dark/approval"),
    ).toEqual([{ approved: true }]);

    answer.resolve({ extensions: [{ ...EXTENSION, approved: true }] });
    await flush();
    expect(ext.queryByText("Waiting for your answer to the approval question…")).toBeNull();
    expect(ext.getByText("Approved")).toBeTruthy();
    expect(
      ext.getByRole("button", { name: "Withdraw approval of extension ext-dark" }),
    ).toBeTruthy();
  });

  it("withdraws without a waiting state and removes an extension", async () => {
    const api = await mount(
      <BrowserProfilesSection />,
      profileRoutes({
        "GET /api/browser/profiles/prof_work/extensions": () => ({
          extensions: [{ ...EXTENSION, approved: true }],
        }),
        "PUT /api/browser/profiles/prof_work/extensions/ext-dark/approval": () => ({
          extensions: [EXTENSION],
        }),
        "DELETE /api/browser/profiles/prof_work/extensions/ext-dark": () => ({ extensions: [] }),
      }),
    );
    const ext = card("Work");
    await click(ext.getByRole("button", { name: "Withdraw approval of extension ext-dark" }));
    expect(
      bodies(api, "PUT", "/api/browser/profiles/prof_work/extensions/ext-dark/approval"),
    ).toEqual([{ approved: false }]);
    expect(ext.getByText("Not approved")).toBeTruthy();
    await click(ext.getByRole("button", { name: "Remove extension ext-dark" }));
    expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    expect(ext.getByText("No extensions.")).toBeTruthy();
  });

  it("shows a revoked extension as revoked and cannot approve it", async () => {
    await mount(
      <BrowserProfilesSection />,
      profileRoutes({
        "GET /api/browser/profiles/prof_work/extensions": () => ({
          extensions: [{ ...EXTENSION, approved: false, status: "revoked" }],
        }),
      }),
    );
    const ext = card("Work");
    expect(ext.getByText("Revoked")).toBeTruthy();
    expect(ext.queryByText("Not approved")).toBeNull();
    const approve = ext.getByRole("button", { name: "Approve extension ext-dark" });
    expect(approve.hasAttribute("disabled")).toBe(true);
  });

  it("shows only 'not available' with no controls when Core answers 503", async () => {
    await mount(<BrowserProfilesSection />, { "GET /api/browser/profiles": unavailable });
    const section = within(screen.getByRole("region", { name: "Browser profiles" }));
    expect(section.getByText(/not available/)).toBeTruthy();
    expect(section.queryAllByRole("button")).toHaveLength(0);
    expect(section.queryAllByRole("textbox")).toHaveLength(0);
    expect(section.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("shows only 'not available' when the route is absent (404)", async () => {
    await mount(<BrowserProfilesSection />, {});
    const section = within(screen.getByRole("region", { name: "Browser profiles" }));
    expect(section.getByText(/not available/)).toBeTruthy();
    expect(section.queryAllByRole("button")).toHaveLength(0);
  });

  it("shows a request error as an alert", async () => {
    await mount(
      <BrowserProfilesSection />,
      profileRoutes({
        "POST /api/browser/profiles": () =>
          new Response(JSON.stringify({ code: "BAD_REQUEST", message: "Name is taken" }), {
            status: 400,
          }),
      }),
    );
    fireEvent.change(screen.getByLabelText("Profile name"), { target: { value: "Work" } });
    await click(screen.getByRole("button", { name: "Create profile" }));
    expect(screen.getByRole("alert").textContent).toBe("Name is taken");
  });
});

const SITES = [
  { site: "youtube", hosts: ["www.youtube.com"], enabled: false, adBlocking: "normal", reason: "" },
  {
    site: "soundcloud",
    hosts: ["soundcloud.com"],
    enabled: false,
    adBlocking: "normal",
    reason: "",
  },
  { site: "bandcamp", hosts: ["bandcamp.com"], enabled: false, adBlocking: "normal", reason: "" },
  {
    site: "spotify-web",
    hosts: ["open.spotify.com"],
    enabled: false,
    adBlocking: "normal",
    reason: "",
  },
];

function musicRoutes(over: Routes = {}): Routes {
  let sites = SITES.map((s) => ({ ...s }));
  return {
    "GET /api/music/connectors": () => ({ sites }),
    "PUT /api/music/connectors/*": (body, url) => {
      const site = url.pathname.split("/").pop();
      const enabled = field(body, "enabled") === true;
      sites = sites.map((s) =>
        s.site === site
          ? { ...s, enabled, adBlocking: s.site === "youtube" && enabled ? "exempt" : "normal" }
          : s,
      );
      return { sites };
    },
    ...over,
  };
}

describe("music sites card", () => {
  it("lists four sites, off, with their exact hosts and i18n names", async () => {
    await mount(<MusicSitesSection />, musicRoutes());
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(4);
    expect(boxes.every((b) => !b.checked)).toBe(true);
    for (const name of ["YouTube", "SoundCloud", "Bandcamp", "Spotify Web"])
      expect(screen.getByRole("checkbox", { name })).toBeTruthy();
    const text = screen.getByRole("region", { name: "Music sites" }).textContent ?? "";
    for (const host of ["www.youtube.com", "soundcloud.com", "bandcamp.com", "open.spotify.com"])
      expect(text).toContain(host);
    expect(text).not.toContain("While YouTube is on");
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
  });

  it("turns a site on with exactly { enabled: true } and notes ad blocking only for YouTube", async () => {
    const api = await mount(<MusicSitesSection />, musicRoutes());
    await click(screen.getByRole("checkbox", { name: "Bandcamp" }));
    expect(bodies(api, "PUT", "/api/music/connectors/bandcamp")).toEqual([{ enabled: true }]);
    expect((screen.getByRole("checkbox", { name: "Bandcamp" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(screen.queryByText(/ad blocking does not apply/)).toBeNull();

    await click(screen.getByRole("checkbox", { name: "YouTube" }));
    expect(bodies(api, "PUT", "/api/music/connectors/youtube")).toEqual([{ enabled: true }]);
    expect(screen.getAllByText(/ad blocking does not apply/)).toHaveLength(1);

    await click(screen.getByRole("checkbox", { name: "YouTube" }));
    expect(bodies(api, "PUT", "/api/music/connectors/youtube")[1]).toEqual({ enabled: false });
    expect(screen.queryByText(/ad blocking does not apply/)).toBeNull();
  });

  it("searches an enabled site and offers the returned address as a safe link", async () => {
    const url = "https://www.youtube.com/results?search_query=lofi%20beats";
    const api = await mount(
      <MusicSitesSection />,
      musicRoutes({ "POST /api/music/connectors/youtube/search": () => ({ url }) }),
    );
    await click(screen.getByRole("checkbox", { name: "YouTube" }));
    fireEvent.change(screen.getByLabelText("Search YouTube"), { target: { value: "lofi beats" } });
    await click(screen.getByRole("button", { name: "Search" }));
    expect(bodies(api, "POST", "/api/music/connectors/youtube/search")).toEqual([
      { query: "lofi beats" },
    ]);
    const link = screen.getByRole("link", { name: url }) as HTMLAnchorElement;
    expect(link.href).toBe(url);
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
  });

  it("never turns a non-web address from Core into a link", async () => {
    await mount(
      <MusicSitesSection />,
      musicRoutes({
        "POST /api/music/connectors/youtube/search": () => ({ url: "javascript:alert(1)" }),
      }),
    );
    await click(screen.getByRole("checkbox", { name: "YouTube" }));
    fireEvent.change(screen.getByLabelText("Search YouTube"), { target: { value: "x" } });
    await click(screen.getByRole("button", { name: "Search" }));
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("cannot be opened");
  });

  it("shows 'not available' with no controls on 503", async () => {
    await mount(<MusicSitesSection />, { "GET /api/music/connectors": unavailable });
    const section = within(screen.getByRole("region", { name: "Music sites" }));
    expect(section.getByText(/not available/)).toBeTruthy();
    expect(section.queryAllByRole("checkbox")).toHaveLength(0);
  });
});
