// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { formatClock, nextRepeat, validCover, type NowPlaying } from "../src/core/media";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { doubleClick, expectInert, sendEvent, XSS } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => cleanup());

const capability = (id: string, status: "enabled" | "installed") => ({
  id,
  name: id,
  version: "0.1.0",
  description: id,
  kind: "builtin",
  status,
  health: { status: "healthy" },
  permissions: [],
  commands: [],
  data_categories: [],
});

type Routes = Parameters<typeof fakeApi>[0];

/** `now_playing` for one capability: POST starts `op-<id>`, GET returns the current result. */
function nowPlaying(id: string, result: () => unknown): Routes {
  return {
    [`POST /api/capabilities/${id}/commands/now_playing`]: () => ({ id: `op-${id}` }),
    [`GET /api/operations/op-${id}`]: () => ({ status: "succeeded", result: result() }),
  };
}

type Outcome = { status: string; error?: { message: string } };

/** A control command: POST starts `op-<id>-<cmd>`, GET reports `outcome`. */
function control(
  id: string,
  cmd: string,
  outcome: () => Outcome = () => ({ status: "succeeded" }),
) {
  return {
    [`POST /api/capabilities/${id}/commands/${cmd}`]: () => ({ id: `op-${id}-${cmd}` }),
    [`GET /api/operations/op-${id}-${cmd}`]: () => outcome(),
  } satisfies Routes;
}

function open(routes: Routes) {
  const api = fakeApi(routes);
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  const view = render(
    <CoreProvider client={client}>
      <App />
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  fireEvent.click(screen.getByRole("button", { name: /^Fawkes/ }));
  return { api, ws: FakeWebSocket.last, container: view.container };
}

const PNG = "data:image/png;base64,iVBORw0KGgo=";

const track = (over: Partial<NowPlaying> = {}): NowPlaying => ({
  running: true,
  state: "playing",
  title: "Blue Hour",
  artist: "The Ravens",
  album: "Dusk",
  position_s: 30,
  duration_s: 200,
  volume: 40,
  shuffle: false,
  repeat: "off",
  ...over,
});

const caps = (...ids: string[]): Routes => ({
  "GET /api/capabilities": () => ({ capabilities: ids.map((id) => capability(id, "enabled")) }),
});

const bodies = (api: FakeApi, path: string) => api.posts(path).map((c) => c.body);

const section = async (name: string) =>
  (await screen.findByRole("heading", { name })).closest("section")!;

describe("Now playing glance", () => {
  it("is absent, and calls nothing, while the capabilities are off", async () => {
    const { api } = open({
      "GET /api/capabilities": () => ({
        capabilities: [capability("spotify", "installed"), capability("apple-music", "installed")],
      }),
    });
    await screen.findByRole("heading", { name: "Active tasks" });
    expect(screen.queryByRole("heading", { name: /Now playing/ })).toBeNull();
    expect(api.calls.some((c) => c.path.includes("/commands/"))).toBe(false);
  });

  it("shows only the enabled service, with its track as text and the inline cover", async () => {
    const { api } = open({
      ...caps("spotify"),
      ...nowPlaying("spotify", () => track({ cover: PNG })),
    });
    const sec = await section("Now playing · Spotify");
    expect(await within(sec).findByText("Blue Hour")).toBeTruthy();
    expect(within(sec).getByText("The Ravens")).toBeTruthy();
    expect(within(sec).getByText("Dusk")).toBeTruthy();
    expect(within(sec).getByText("0:30 / 3:20")).toBeTruthy();
    expect(sec.querySelector("img")!.getAttribute("src")).toBe(PNG);
    expect(sec.querySelector("img")!.getAttribute("alt")).toBe("");
    expect(screen.queryByRole("heading", { name: /Apple Music/ })).toBeNull();
    expect(api.posts("/api/capabilities/apple-music/commands/now_playing")).toHaveLength(0);
  });

  it.each([
    ["an https URL", "https://cdn.example.test/cover.png"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["an SVG data URI", "data:image/svg+xml;base64,PHN2Zy8+"],
    ["an http URL", "http://127.0.0.1/cover.png"],
  ])("does not render %s as a cover image", async (_name, cover) => {
    open({ ...caps("spotify"), ...nowPlaying("spotify", () => track({ cover })) });
    const sec = await section("Now playing · Spotify");
    await within(sec).findByText("Blue Hour");
    expect(sec.querySelector("img")).toBeNull();
  });

  it("keeps a hostile title, artist and album inert text", async () => {
    const { container } = open({
      ...caps("spotify"),
      ...nowPlaying("spotify", () => track({ title: XSS, artist: XSS, album: XSS })),
    });
    await screen.findAllByText(XSS);
    expectInert(container);
  });

  it("labels the controls and reflects play, shuffle and repeat state", async () => {
    open({
      ...caps("apple-music"),
      ...nowPlaying("apple-music", () => track({ shuffle: true, repeat: "one" })),
    });
    const sec = await section("Now playing · Apple Music");
    await within(sec).findByText("Blue Hour");
    expect(within(sec).getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(within(sec).getByRole("button", { name: "Previous" })).toBeTruthy();
    expect(within(sec).getByRole("button", { name: "Next" })).toBeTruthy();
    expect(
      within(sec).getByRole("button", { name: "Shuffle on" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(sec).getByRole("button", { name: "Repeat: one" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(within(sec).getByRole("slider", { name: "Seek" })).toBeTruthy();
    expect(within(sec).getByRole("slider", { name: "Volume" })).toBeTruthy();
  });

  it("says the service is not running and disables every control", async () => {
    open({
      ...caps("spotify"),
      ...nowPlaying("spotify", () => ({ running: false, state: "not_running" })),
    });
    const sec = await section("Now playing · Spotify");
    expect(await within(sec).findByText("Spotify is not running.")).toBeTruthy();
    const controls = [...within(sec).getAllByRole("button"), ...within(sec).getAllByRole("slider")];
    expect(controls.length).toBe(7);
    for (const c of controls)
      expect((c as HTMLButtonElement | HTMLInputElement).disabled).toBe(true);
  });

  it("sends play_pause to the right capability once, even on a double click", async () => {
    const { api } = open({
      ...caps("spotify", "apple-music"),
      ...nowPlaying("spotify", () => track({ state: "paused" })),
      ...nowPlaying("apple-music", () => track({ title: "Other" })),
      ...control("spotify", "play_pause"),
      ...control("apple-music", "play_pause"),
    });
    const sec = await section("Now playing · Spotify");
    const play = await within(sec).findByRole("button", { name: "Play" });
    doubleClick(() => fireEvent.click(play));
    await waitFor(() =>
      expect(api.posts("/api/capabilities/spotify/commands/play_pause")).toHaveLength(1),
    );
    expect(api.posts("/api/capabilities/apple-music/commands/play_pause")).toHaveLength(0);
    expect(bodies(api, "/api/capabilities/spotify/commands/play_pause")).toEqual([{ input: {} }]);
  });

  it("reloads the track after a control succeeds", async () => {
    let title = "Blue Hour";
    const { api } = open({
      ...caps("spotify"),
      ...nowPlaying("spotify", () => track({ title })),
      ...control("spotify", "next"),
    });
    const sec = await section("Now playing · Spotify");
    await within(sec).findByText("Blue Hour");
    title = "Second Song";
    fireEvent.click(within(sec).getByRole("button", { name: "Next" }));
    expect(await within(sec).findByText("Second Song")).toBeTruthy();
    expect(api.posts("/api/capabilities/spotify/commands/now_playing")).toHaveLength(2);
  });

  it("tells the user it is waiting for approval while the command is pending", async () => {
    open({
      ...caps("spotify"),
      ...nowPlaying("spotify", () => track()),
      ...control("spotify", "previous", () => ({ status: "pending" })),
    });
    const sec = await section("Now playing · Spotify");
    fireEvent.click(await within(sec).findByRole("button", { name: "Previous" }));
    expect(await within(sec).findByText(/Waiting for your approval/)).toBeTruthy();
    expect((within(sec).getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("shows the error of a failed control in an alert", async () => {
    open({
      ...caps("spotify"),
      ...nowPlaying("spotify", () => track()),
      ...control("spotify", "play_pause", () => ({
        status: "failed",
        error: { message: "Spotify is not running" },
      })),
    });
    const sec = await section("Now playing · Spotify");
    fireEvent.click(await within(sec).findByRole("button", { name: "Pause" }));
    const alert = await within(sec).findByRole("alert");
    expect(alert.textContent).toBe("Spotify is not running");
  });

  it("commits seek once, as an integer, on key-up and not on change", async () => {
    const { api } = open({
      ...caps("spotify"),
      ...nowPlaying("spotify", () => track()),
      ...control("spotify", "seek"),
    });
    const sec = await section("Now playing · Spotify");
    const seek = (await within(sec).findByRole("slider", { name: "Seek" })) as HTMLInputElement;
    await waitFor(() => expect(seek.disabled).toBe(false));
    fireEvent.change(seek, { target: { value: "80" } });
    fireEvent.change(seek, { target: { value: "90" } });
    expect(seek.value).toBe("90");
    expect(api.posts("/api/capabilities/spotify/commands/seek")).toHaveLength(0);
    doubleClick(() => fireEvent.keyUp(seek));
    await waitFor(() =>
      expect(bodies(api, "/api/capabilities/spotify/commands/seek")).toEqual([
        { input: { position_s: 90 } },
      ]),
    );
  });

  it("commits volume once on pointer-up and not on change", async () => {
    const { api } = open({
      ...caps("apple-music"),
      ...nowPlaying("apple-music", () => track()),
      ...control("apple-music", "set_volume"),
    });
    const sec = await section("Now playing · Apple Music");
    const volume = (await within(sec).findByRole("slider", { name: "Volume" })) as HTMLInputElement;
    await waitFor(() => expect(volume.disabled).toBe(false));
    expect(volume.value).toBe("40");
    fireEvent.change(volume, { target: { value: "75" } });
    expect(api.posts("/api/capabilities/apple-music/commands/set_volume")).toHaveLength(0);
    fireEvent.pointerUp(volume);
    await waitFor(() =>
      expect(bodies(api, "/api/capabilities/apple-music/commands/set_volume")).toEqual([
        { input: { volume: 75 } },
      ]),
    );
  });

  it("sends nothing when a slider is released without having been moved", async () => {
    const { api } = open({
      ...caps("spotify"),
      ...nowPlaying("spotify", () => track()),
      ...control("spotify", "set_volume"),
    });
    const sec = await section("Now playing · Spotify");
    const volume = (await within(sec).findByRole("slider", { name: "Volume" })) as HTMLInputElement;
    await waitFor(() => expect(volume.disabled).toBe(false));
    fireEvent.keyUp(volume);
    fireEvent.pointerUp(volume);
    expect(api.posts("/api/capabilities/spotify/commands/set_volume")).toHaveLength(0);
  });

  it("toggles shuffle and cycles repeat per service", async () => {
    const { api } = open({
      ...caps("spotify", "apple-music"),
      ...nowPlaying("spotify", () => track({ repeat: "all", shuffle: true })),
      ...nowPlaying("apple-music", () => track({ repeat: "all" })),
      ...control("spotify", "set_repeat"),
      ...control("spotify", "set_shuffle"),
      ...control("apple-music", "set_repeat"),
    });
    const spotify = await section("Now playing · Spotify");
    const apple = await section("Now playing · Apple Music");
    fireEvent.click(await within(spotify).findByRole("button", { name: "Repeat: all" }));
    await waitFor(() =>
      expect(bodies(api, "/api/capabilities/spotify/commands/set_repeat")).toEqual([
        { input: { mode: "off" } },
      ]),
    );
    await waitFor(() =>
      expect(
        (within(spotify).getByRole("button", { name: "Shuffle on" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(within(spotify).getByRole("button", { name: "Shuffle on" }));
    await waitFor(() =>
      expect(bodies(api, "/api/capabilities/spotify/commands/set_shuffle")).toEqual([
        { input: { enabled: false } },
      ]),
    );
    fireEvent.click(await within(apple).findByRole("button", { name: "Repeat: all" }));
    await waitFor(() =>
      expect(bodies(api, "/api/capabilities/apple-music/commands/set_repeat")).toEqual([
        { input: { mode: "one" } },
      ]),
    );
  });

  it("refreshes on its own track events and ignores the other service's", async () => {
    let title = "Blue Hour";
    const { api, ws } = open({
      ...caps("spotify"),
      ...nowPlaying("spotify", () => track({ title })),
    });
    const sec = await section("Now playing · Spotify");
    await within(sec).findByText("Blue Hour");
    const path = "/api/capabilities/spotify/commands/now_playing";
    title = "Next Up";
    sendEvent(ws, 1, "apple_music.track.playing");
    sendEvent(ws, 2, "spotify.track.playing");
    expect(await within(sec).findByText("Next Up")).toBeTruthy();
    expect(api.posts(path)).toHaveLength(2);
  });

  it("shows a load error instead of a track", async () => {
    open({
      ...caps("spotify"),
      "POST /api/capabilities/spotify/commands/now_playing": () => ({ id: "op-bad" }),
      "GET /api/operations/op-bad": () => ({
        status: "failed",
        error: { message: "Spotify did not answer" },
      }),
    });
    const sec = await section("Now playing · Spotify");
    expect(await within(sec).findByText("Spotify did not answer")).toBeTruthy();
  });
});

describe("validCover", () => {
  const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
  const WEBP = "data:image/webp;base64,UklGRg==";
  const padTo = (length: number) => {
    const prefix = "data:image/png;base64,";
    return prefix + "A".repeat(length - prefix.length);
  };

  it("accepts inline jpeg, png and webp", () => {
    expect(validCover(JPEG)).toBe(JPEG);
    expect(validCover(PNG)).toBe(PNG);
    expect(validCover(WEBP)).toBe(WEBP);
  });

  it.each([
    ["an https URL", "https://cdn.example.test/a.png"],
    ["javascript:", "javascript:alert(1)"],
    ["svg", "data:image/svg+xml;base64,PHN2Zy8+"],
    ["html", "data:text/html;base64,PGgxPg=="],
    ["gif", "data:image/gif;base64,R0lGODlh"],
    ["a quote that breaks out of src", 'data:image/png;base64,AAAA" onerror="x'],
    ["whitespace in the payload", "data:image/png;base64,AA AA"],
    ["an empty payload", "data:image/png;base64,"],
    ["a trailing newline", `${PNG}\n`],
    ["a prefix before the data URI", `x${PNG}`],
    ["a non-base64 data URI", "data:image/png,AAAA"],
  ])("drops %s", (_name, value) => {
    expect(validCover(value)).toBeUndefined();
  });

  it("drops anything that is not a string", () => {
    expect(validCover(undefined)).toBeUndefined();
    expect(validCover(null)).toBeUndefined();
    expect(validCover(42)).toBeUndefined();
    expect(validCover({ toString: () => PNG })).toBeUndefined();
  });

  it("allows 600,000 characters and drops one more", () => {
    expect(validCover(padTo(600_000))).toBeDefined();
    expect(validCover(padTo(600_001))).toBeUndefined();
  });
});

describe("formatClock", () => {
  it.each([
    [0, "0:00"],
    [5, "0:05"],
    [65, "1:05"],
    [599.9, "9:59"],
    [3600, "1:00:00"],
    [3723, "1:02:03"],
    [Number.NaN, "0:00"],
    [-4, "0:00"],
    [Number.POSITIVE_INFINITY, "0:00"],
    [undefined, "0:00"],
  ])("formats %s as %s", (seconds, text) => {
    expect(formatClock(seconds)).toBe(text);
  });
});

describe("nextRepeat", () => {
  it("toggles off and all for Spotify, which has no repeat-one", () => {
    expect(nextRepeat("off", "spotify")).toBe("all");
    expect(nextRepeat("all", "spotify")).toBe("off");
    expect(nextRepeat("one", "spotify")).toBe("off");
  });

  it("cycles off, all, one for Apple Music", () => {
    expect(nextRepeat("off", "apple-music")).toBe("all");
    expect(nextRepeat("all", "apple-music")).toBe("one");
    expect(nextRepeat("one", "apple-music")).toBe("off");
  });
});
