// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MusicSearchCard } from "../src/components/MusicSearchCard";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { REFUSAL_TEXT, routeCommandText, routeSearch } from "../src/core/music-search";
import { I18nProvider, type ActiveLocale } from "../src/i18n";
import { en } from "../src/i18n/en";
import { resetActive } from "../src/i18n/store";
import { LOCALE_CODES } from "../src/i18n/supported";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

afterEach(() => {
  cleanup();
  resetActive();
});

const SC = "/api/music/connectors/soundcloud/search";

function mount(route: ReturnType<typeof routeSearch>, api: FakeApi, locale?: ActiveLocale) {
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  return render(
    <CoreProvider client={client}>
      <I18nProvider {...(locale ? { forceLocale: locale } : {})}>
        <MusicSearchCard route={route} />
      </I18nProvider>
    </CoreProvider>,
  );
}

describe("routeCommandText", () => {
  it("ignores text that is not a play request and routes the rest", () => {
    expect(routeCommandText("settings")).toBeNull();
    expect(routeCommandText("play jazz on youtube")).toMatchObject({ ok: true });
    expect(routeCommandText("play jazz on tidal")).toEqual({
      ok: false,
      reason: "unknown_service",
    });
  });

  it("has a message for every refusal in all ten languages", () => {
    for (const key of Object.values(REFUSAL_TEXT)) expect(en[key]).toBeTruthy();
    expect(LOCALE_CODES).toHaveLength(10);
  });
});

describe("MusicSearchCard", () => {
  it("shows the site and exact query; the link is the locally built search address and nothing is played", async () => {
    const route = routeSearch("soundcloud", "lo-fi beats");
    if (!route.ok) throw new Error("route");
    const api = fakeApi({ [`POST ${SC}`]: () => ({ url: route.url }) });
    mount(route, api);
    expect(screen.getByText("Site: SoundCloud")).toBeTruthy();
    expect(screen.getByText("Search for: lo-fi beats")).toBeTruthy();
    const link = await screen.findByRole("link", { name: "Open search page" });
    expect(link.getAttribute("href")).toBe("https://soundcloud.com/search?q=lo-fi%20beats");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(api.posts(SC)[0]?.body).toEqual({ query: "lo-fi beats" });
    // Only the search address was asked for; no other call and no player.
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("offers no link when the site is off (403)", async () => {
    const route = routeSearch("soundcloud", "x");
    if (!route.ok) throw new Error("route");
    const api = fakeApi({
      [`POST ${SC}`]: () =>
        new Response(JSON.stringify({ code: "PERMISSION_DENIED", message: "no" }), { status: 403 }),
    });
    mount(route, api);
    expect(await screen.findByText(/SoundCloud is off/)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("offers no link when Core's address differs from the one built here", async () => {
    const route = routeSearch("soundcloud", "x");
    if (!route.ok) throw new Error("route");
    const api = fakeApi({ [`POST ${SC}`]: () => ({ url: "https://evil.example/" }) });
    mount(route, api);
    expect(await screen.findByText("The search address could not be made.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("refuses an unknown service or a bad query without calling Core", () => {
    const api = fakeApi();
    mount(routeSearch("spotify-web", "x"), api);
    expect(screen.getByRole("alert").textContent).toMatch(/Only SoundCloud, Bandcamp and YouTube/);
    cleanup();
    mount(routeSearch("youtube", "a\u202Eb"), api);
    expect(screen.getByRole("alert").textContent).toMatch(/not allowed/);
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("renders in every locale", async () => {
    const route = routeSearch("soundcloud", "x");
    if (!route.ok) throw new Error("route");
    for (const code of LOCALE_CODES) {
      const api = fakeApi({ [`POST ${SC}`]: () => ({ url: route.url }) });
      mount(route, api, code as ActiveLocale);
      await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(1));
      if (code !== "en")
        await waitFor(() =>
          expect(screen.getByRole("heading").textContent).not.toBe(en["musicPlay.title"]),
        );
      cleanup();
    }
  });
});
