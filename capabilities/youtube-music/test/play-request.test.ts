// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  MAX_PLAY_QUERY_CHARS,
  checkPlayQuery,
  routePlayRequest,
  routeSearch,
  searchUrl,
} from "../src/index.js";

describe("routePlayRequest", () => {
  it("turns a request into the named service's search address and nothing else", () => {
    expect(routePlayRequest("play lo-fi beats on soundcloud")).toEqual({
      ok: true,
      service: "soundcloud",
      query: "lo-fi beats",
      url: searchUrl("soundcloud", "lo-fi beats"),
    });
    expect(routePlayRequest("Please play Some Album on BANDCAMP")).toMatchObject({
      ok: true,
      service: "bandcamp",
      url: "https://bandcamp.com/search?q=Some%20Album",
    });
    expect(routePlayRequest("  play jazz on youtube  ")).toMatchObject({
      ok: true,
      service: "youtube",
      url: "https://www.youtube.com/results?search_query=jazz",
    });
  });

  it("keeps a query that itself contains the word on", () => {
    expect(routePlayRequest("play songs on the radio on youtube")).toMatchObject({
      ok: true,
      query: "songs on the radio",
    });
  });

  it("is not a play request when the shape is wrong", () => {
    for (const text of ["", "hello", "play lo-fi", "search for jazz on youtube", "play on youtube"])
      expect(routePlayRequest(text), text).toEqual({ ok: false, reason: "not_play_request" });
  });

  it("refuses services outside the allow-list, including Spotify Web and look-alikes", () => {
    for (const service of ["spotify", "spotify-web", "evil.com", "youtube.com", "__proto__", "x"])
      expect(routePlayRequest(`play jazz on ${service}`), service).toEqual({
        ok: false,
        reason: "unknown_service",
      });
  });

  it("refuses control, bidirectional and invisible characters in the query", () => {
    for (const bad of [
      "a\u0000b",
      "a\nb",
      "a\u202Eb",
      "a\u2066b",
      "a\u200Bb",
      "a\u2028b",
      "a\u0085b",
    ])
      expect(routePlayRequest(`play ${bad} on youtube`), JSON.stringify(bad)).toEqual({
        ok: false,
        reason: "bad_characters",
      });
  });

  it("refuses an empty or too long query", () => {
    expect(checkPlayQuery("   ")).toEqual({ ok: false, reason: "empty_query" });
    expect(checkPlayQuery("a".repeat(MAX_PLAY_QUERY_CHARS))).toMatchObject({ ok: true });
    expect(checkPlayQuery("a".repeat(MAX_PLAY_QUERY_CHARS + 1))).toEqual({
      ok: false,
      reason: "too_long",
    });
    expect(routePlayRequest(`play ${"a".repeat(500)} on youtube`)).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("percent-encodes query characters so they cannot change the address", () => {
    const route = routePlayRequest("play a&b=c#d?e/f on youtube");
    expect(route).toMatchObject({ ok: true });
    if (route.ok) {
      expect(new URL(route.url).hostname).toBe("www.youtube.com");
      expect(new URL(route.url).searchParams.get("search_query")).toBe("a&b=c#d?e/f");
      expect(new URL(route.url).hash).toBe("");
    }
  });
});

describe("routeSearch", () => {
  it("re-checks an already parsed service and query", () => {
    expect(routeSearch("bandcamp", "jazz")).toMatchObject({ ok: true, service: "bandcamp" });
    expect(routeSearch("spotify-web", "jazz")).toEqual({ ok: false, reason: "unknown_service" });
    expect(routeSearch({}, "jazz")).toEqual({ ok: false, reason: "unknown_service" });
    expect(routeSearch("youtube", 5)).toEqual({ ok: false, reason: "empty_query" });
    expect(routeSearch("youtube", "a\u202Eb")).toEqual({ ok: false, reason: "bad_characters" });
  });
});
