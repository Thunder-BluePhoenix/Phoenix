// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it, vi } from "vitest";
import { FocusController, type FocusClock, type FocusNotification } from "../src/focus";

describe("FocusController", () => {
  function fixture() {
    let now = 0;
    let callback: (() => void) | null = null;
    let dnd: boolean | null = false;
    const delivered: string[] = [];
    const clock: FocusClock = {
      now: () => now,
      setTimeout: (fn) => {
        callback = fn;
        return fn;
      },
      clearTimeout: () => {
        callback = null;
      },
    };
    const controller = new FocusController<FocusNotification>(
      clock,
      { read: async () => dnd },
      (n) => delivered.push(n.id),
    );
    return {
      controller,
      delivered,
      tick(ms: number) {
        now += ms;
        callback?.();
      },
      setDnd(value: boolean | null) {
        dnd = value;
      },
    };
  }

  it("holds ordinary notifications, deduplicates them, and lets approvals/errors pass", () => {
    const { controller, delivered } = fixture();
    controller.start();
    expect(controller.receive({ id: "ordinary", severity: "warning" })).toBe("held");
    controller.receive({ id: "ordinary", severity: "warning" });
    expect(controller.receive({ id: "approval", severity: "info", requiresAction: true })).toBe(
      "delivered",
    );
    expect(controller.receive({ id: "error", severity: "error" })).toBe("delivered");
    expect(delivered).toEqual(["approval", "error"]);
    expect(controller.snapshot().held).toBe(1);
    controller.stop();
    expect(delivered).toEqual(["approval", "error", "ordinary"]);
  });

  it("expires a Pomodoro using only the injected clock", () => {
    const { controller, delivered, tick } = fixture();
    controller.start(25);
    controller.receive({ id: "one", severity: "success" });
    tick(25 * 60_000);
    expect(controller.snapshot()).toMatchObject({ active: false, held: 0 });
    expect(delivered).toEqual(["one"]);
  });

  it("respects read-only OS DND even when manual focus ends", async () => {
    const { controller, delivered, setDnd } = fixture();
    setDnd(true);
    await controller.refreshDnd();
    controller.receive({ id: "one", severity: "info" });
    controller.stop();
    expect(delivered).toEqual([]);
    setDnd(false);
    await controller.refreshDnd();
    expect(delivered).toEqual(["one"]);
  });

  it("keeps held notifications until an affirmative OS DND-off reading", async () => {
    const { controller, delivered, setDnd } = fixture();
    setDnd(true);
    await controller.refreshDnd();
    controller.receive({ id: "held", severity: "info" });
    setDnd(null);
    await controller.refreshDnd();
    expect(delivered).toEqual([]);
    expect(controller.snapshot().held).toBe(1);
    setDnd(false);
    await controller.refreshDnd();
    expect(delivered).toEqual(["held"]);
  });

  it("treats OS read errors as unknown", async () => {
    const controller = new FocusController(
      { now: () => 0, setTimeout: vi.fn(), clearTimeout: vi.fn() },
      {
        read: async () => {
          throw Error("denied");
        },
      },
      vi.fn(),
    );
    await controller.refreshDnd();
    expect(controller.snapshot().osDnd).toBeNull();
  });
});

describe("FocusController integration with host dispatch", () => {
  it("never delivers a held notification twice when it later becomes an approval", () => {
    const delivered: string[] = [];
    const controller = new FocusController<FocusNotification>(
      { now: () => 0, setTimeout: vi.fn(), clearTimeout: vi.fn() },
      { read: async () => false },
      (n) => delivered.push(n.id),
    );
    controller.start();
    expect(controller.receive({ id: "a", severity: "info" })).toBe("held");
    expect(controller.receive({ id: "a", severity: "info", requiresAction: true })).toBe(
      "delivered",
    );
    expect(controller.snapshot().held).toBe(0);
    controller.stop();
    expect(delivered).toEqual(["a"]);
  });

  it("ignores a stale OS read that finishes after a newer read", async () => {
    const reads: PromiseWithResolvers<boolean | null>[] = [];
    const delivered: string[] = [];
    const controller = new FocusController<FocusNotification>(
      { now: () => 0, setTimeout: vi.fn(), clearTimeout: vi.fn() },
      {
        read: () => {
          const pending = Promise.withResolvers<boolean | null>();
          reads.push(pending);
          return pending.promise;
        },
      },
      (n) => delivered.push(n.id),
    );
    const first = controller.refreshDnd();
    const second = controller.refreshDnd();
    reads[1]?.resolve(false);
    await second;
    reads[0]?.resolve(true);
    await first;
    expect(controller.snapshot().osDnd).toBe(false);
    expect(controller.receive({ id: "x", severity: "info" })).toBe("delivered");
    expect(delivered).toEqual(["x"]);
  });

  it("discards held notifications and ignores late reads after dispose", async () => {
    const pending = Promise.withResolvers<boolean | null>();
    const delivered: string[] = [];
    const controller = new FocusController<FocusNotification>(
      { now: () => 0, setTimeout: vi.fn(), clearTimeout: vi.fn() },
      { read: () => pending.promise },
      (n) => delivered.push(n.id),
    );
    controller.start();
    controller.receive({ id: "held", severity: "info" });
    const read = controller.refreshDnd();
    controller.dispose();
    pending.resolve(true);
    await read;
    expect(controller.snapshot()).toMatchObject({ held: 0, osDnd: null });
    expect(delivered).toEqual([]);
  });
});
