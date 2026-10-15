// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { followStep, INITIAL_FOLLOW_STATE, type FollowCommand, type FollowEvent } from "../src";

function run(events: FollowEvent[]) {
  let state = { ...INITIAL_FOLLOW_STATE };
  const commands: FollowCommand[][] = [];
  for (const event of events) {
    const step = followStep(state, event);
    state = step.state;
    commands.push(step.commands);
  }
  return { state, commands };
}

describe("desktop follow / fly home", () => {
  it("stays docked and issues nothing until following is enabled", () => {
    const { state, commands } = run([{ type: "cursor-moved" }, { type: "arrived" }]);
    expect(state.phase).toBe("docked");
    expect(commands.flat()).toEqual([]);
  });

  it("follows the cursor once enabled, and stops when disabled", () => {
    const { state, commands } = run([
      { type: "follow-enabled", enabled: true },
      { type: "cursor-moved" },
      { type: "follow-enabled", enabled: false },
    ]);
    expect(commands[0]).toEqual([
      { kind: "track-cursor", on: true },
      { kind: "move", to: "cursor", animate: false },
    ]);
    expect(commands[1]).toEqual([{ kind: "move", to: "cursor", animate: true }]);
    expect(commands[2]).toEqual([{ kind: "track-cursor", on: false }]);
    expect(state.phase).toBe("docked");
  });

  it("flies home on an alert, holds there, then flies back when it clears", () => {
    const { state, commands } = run([
      { type: "follow-enabled", enabled: true },
      { type: "alert-raised" },
      { type: "cursor-moved" }, // ignored while away
      { type: "arrived" },
      { type: "alert-cleared" },
      { type: "arrived" },
    ]);
    expect(commands[1]).toEqual([
      { kind: "track-cursor", on: false },
      { kind: "move", to: "home", animate: true },
    ]);
    expect(commands[2]).toEqual([]);
    expect(commands[3]).toEqual([{ kind: "stop-move" }]); // landed
    expect(commands[4]).toEqual([{ kind: "move", to: "cursor", animate: true }]);
    expect(commands[5]).toEqual([
      { kind: "track-cursor", on: true },
      { kind: "move", to: "cursor", animate: false }, // snap to wherever the cursor is now
    ]);
    expect(state.phase).toBe("following");
  });

  it("an alert that clears mid-flight turns around into following without a stuck state", () => {
    const { state } = run([
      { type: "follow-enabled", enabled: true },
      { type: "alert-raised" },
      { type: "alert-cleared" },
    ]);
    expect(state.phase).toBe("following");
  });

  it("without following enabled, an alert just holds in place", () => {
    const { state, commands } = run([{ type: "alert-raised" }, { type: "alert-cleared" }]);
    expect(commands.flat()).toEqual([]);
    expect(state.phase).toBe("docked");
  });

  it("reduced motion makes flights instant", () => {
    const { commands } = run([
      { type: "reduced-motion", reduced: true },
      { type: "follow-enabled", enabled: true },
      { type: "alert-raised" },
    ]);
    expect(commands[2]).toContainEqual({ kind: "move", to: "home", animate: false });
  });

  it("dragging halts movement and a dropped flight is re-issued", () => {
    const { state, commands } = run([
      { type: "follow-enabled", enabled: true },
      { type: "alert-raised" },
      { type: "drag-started" },
      { type: "drag-ended" },
    ]);
    expect(commands[2]).toEqual([{ kind: "stop-move" }]);
    expect(commands[3]).toContainEqual({ kind: "move", to: "home", animate: true });
    expect(state.dragging).toBe(false);
    expect(state.phase).toBe("flying-home");
  });

  it("repeated alert events are idempotent", () => {
    const { commands } = run([
      { type: "follow-enabled", enabled: true },
      { type: "alert-raised" },
      { type: "alert-raised" },
    ]);
    expect(commands[2]).toEqual([]);
  });
});
