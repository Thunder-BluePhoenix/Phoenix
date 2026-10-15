// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  ALL_DISPLAY_STATES,
  ANIMATIONS,
  COMPLETION_FRESH_MS,
  completionEvent,
  EMOTE_VISUALS,
  emotesAllowedIn,
  INTERACTION_EMOTES,
  isInteractionEmote,
} from "../src";

describe("interaction emotes are not states", () => {
  it("share no name with any display state or state animation", () => {
    for (const emote of INTERACTION_EMOTES) {
      expect(ALL_DISPLAY_STATES as readonly string[]).not.toContain(emote.toUpperCase());
      expect(ANIMATIONS as readonly string[]).not.toContain(emote);
    }
    expect(isInteractionEmote("WORKING")).toBe(false);
    expect(isInteractionEmote("jump")).toBe(true);
  });

  it("every emote is bound to a real source and bounded in time", () => {
    expect(Object.keys(EMOTE_VISUALS).sort()).toEqual([...INTERACTION_EMOTES].sort());
    for (const v of Object.values(EMOTE_VISUALS)) {
      expect(v.source.length).toBeGreaterThan(0);
      expect(v.durationMs).toBeGreaterThan(0);
    }
  });

  it("plays only over calm states", () => {
    for (const calm of [
      "IDLE",
      "WORKING",
      "THINKING",
      "LISTENING",
      "SUCCESS",
      "DEPLOYING",
      "WARNING",
    ]) {
      expect(emotesAllowedIn(calm), calm).toBe(true);
    }
    for (const busy of ["ERROR", "WAITING", "RECORDING", "SLEEPING", "OFFLINE"]) {
      expect(emotesAllowedIn(busy), busy).toBe(false);
    }
  });
});

describe("completionEvent", () => {
  const cond = (over: Record<string, unknown> = {}) => ({
    key: "agents:completed:s1",
    eventId: "evt-1",
    eventType: "agent.completed",
    updatedAt: 10_000,
    ...over,
  });
  const view = (over: Record<string, unknown> = {}) => ({
    state: "SUCCESS",
    key: "agents:completed:s1",
    conditions: [cond()],
    ...over,
  });

  it("returns the real event behind a fresh SUCCESS", () => {
    expect(completionEvent(view(), 11_000)).toEqual({
      eventId: "evt-1",
      eventType: "agent.completed",
    });
  });

  it("accepts agent_run.completed too", () => {
    expect(
      completionEvent(view({ conditions: [cond({ eventType: "agent_run.completed" })] }), 11_000),
    ).not.toBeNull();
  });

  it("is null without an event: SUCCESS alone is not enough", () => {
    expect(completionEvent({ state: "SUCCESS" }, 11_000)).toBeNull();
    expect(completionEvent(view({ conditions: [] }), 11_000)).toBeNull();
    expect(completionEvent(view({ conditions: [{ key: "k" }] }), 11_000)).toBeNull();
  });

  it("is null for SUCCESS caused by something other than an agent finishing", () => {
    expect(
      completionEvent(view({ conditions: [cond({ eventType: "build.passed" })] }), 11_000),
    ).toBeNull();
  });

  it("is null for other states and for stale events", () => {
    expect(completionEvent(view({ state: "WORKING" }), 11_000)).toBeNull();
    expect(completionEvent(view(), 10_000 + COMPLETION_FRESH_MS + 1)).toBeNull();
    expect(completionEvent(view({ conditions: [cond({ updatedAt: "x" })] }), 11_000)).toBeNull();
  });
});
