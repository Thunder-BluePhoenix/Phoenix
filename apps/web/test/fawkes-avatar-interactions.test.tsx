// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import type { InteractionTimers, SoundPlayer } from "@phoenix/pet-runtime";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FawkesAvatar } from "../src/components/FawkesAvatar";
import type { PetState } from "../src/core/types";

function fakeTimers() {
  let now = 50_000;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: InteractionTimers = {
    now: () => now,
    random: () => 0,
    setTimeout(fn, ms) {
      const id = nextId++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (handle) => void pending.delete(handle as number),
  };
  const advance = (ms: number) =>
    act(() => {
      const end = now + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    });
  return { timers, advance };
}

const pet = (over: Partial<PetState> = {}): PetState => ({
  state: "IDLE",
  explanation: "All quiet",
  since: new Date(0).toISOString(),
  recording: false,
  sleeping: false,
  ...over,
});

afterEach(cleanup);

const button = () => screen.getByRole("button", { name: /^Fawkes/ });

describe("FawkesAvatar interactions", () => {
  it("greets on launch, pokes on click and goes dizzy on three quick clicks", () => {
    const { timers, advance } = fakeTimers();
    render(<FawkesAvatar state={pet()} interactionOptions={{ timers }} reducedMotion="off" />);
    expect(button().getAttribute("data-emote")).toBe("greet");
    advance(2_000);
    expect(button().getAttribute("data-emote")).toBeNull();
    fireEvent.click(button());
    expect(button().getAttribute("data-emote")).toBe("poke");
    advance(300);
    fireEvent.click(button());
    advance(300);
    fireEvent.click(button());
    expect(button().getAttribute("data-emote")).toBe("dizzy");
    expect(button().getAttribute("data-state")).toBe("IDLE");
  });

  it("two clicks outside the window do not make it dizzy", () => {
    const { timers, advance } = fakeTimers();
    render(<FawkesAvatar state={pet()} interactionOptions={{ timers }} reducedMotion="off" />);
    advance(2_000);
    fireEvent.click(button());
    advance(700);
    fireEvent.click(button());
    advance(700);
    fireEvent.click(button());
    expect(button().getAttribute("data-emote")).toBe("poke");
  });

  it("jumps only when the state carries a real fresh completion event", () => {
    const { timers, advance } = fakeTimers();
    const { rerender } = render(
      <FawkesAvatar state={pet()} interactionOptions={{ timers }} reducedMotion="off" />,
    );
    advance(2_000);
    rerender(
      <FawkesAvatar
        state={pet({ state: "SUCCESS", explanation: "Done" })}
        interactionOptions={{ timers }}
        reducedMotion="off"
      />,
    );
    expect(button().getAttribute("data-emote")).toBeNull();
    rerender(
      <FawkesAvatar
        state={pet({
          state: "SUCCESS",
          explanation: "claude finished",
          key: "k",
          conditions: [
            { key: "k", eventId: "e1", eventType: "agent.completed", updatedAt: timers.now() },
          ],
        })}
        interactionOptions={{ timers }}
        reducedMotion="off"
      />,
    );
    expect(button().getAttribute("data-emote")).toBe("jump");
    expect(button().getAttribute("data-state")).toBe("SUCCESS");
  });

  it("is silent without a sound player, and sends events to one when given", () => {
    const { timers } = fakeTimers();
    const events: string[] = [];
    const sounds: SoundPlayer = {
      trigger: async (e) => {
        events.push(e);
        return "played";
      },
    };
    render(
      <FawkesAvatar
        state={pet()}
        sounds={sounds}
        interactionOptions={{ timers }}
        reducedMotion="off"
      />,
    );
    expect(events).toEqual(["launch"]);
  });

  it("holds a still pose under reduced motion", () => {
    const { timers, advance } = fakeTimers();
    render(<FawkesAvatar state={pet()} interactionOptions={{ timers }} reducedMotion="on" />);
    advance(2_000);
    document.dispatchEvent(new PointerEvent("pointermove", { clientX: 50_000, clientY: 0 }));
    advance(2_000);
    expect(button().getAttribute("data-reduced-motion")).toBe("true");
    expect(button().style.getPropertyValue("--fawkes-look-x") || "0").toMatch(
      /^0(px)?$|^0\.000px$/,
    );
  });

  it("interactive={false} mounts the plain pet", () => {
    render(<FawkesAvatar state={pet()} interactive={false} />);
    expect(button().getAttribute("data-emote")).toBeNull();
  });
});
