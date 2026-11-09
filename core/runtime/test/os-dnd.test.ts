// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it, vi } from "vitest";
import { FocusController, type FocusNotification } from "../src/focus";
import {
  DND_EXEC_MAX_OUTPUT_BYTES,
  DND_EXEC_TIMEOUT_MS,
  DND_MIN_READ_INTERVAL_MS,
  OsDndReader,
  execDnd,
  parseGdbusInhibited,
  parseGsettingsBanners,
  type DndExec,
  type DndExecResult,
} from "../src/focus/os-dnd";

const ok = (stdout: string): DndExecResult => ({
  code: 0,
  stdout,
  notFound: false,
  timedOut: false,
  outputCapped: false,
});

function rig(
  platform: NodeJS.Platform,
  desktop: string | undefined,
  result: DndExecResult | (() => Promise<DndExecResult>) | Error,
) {
  let now = 1_000_000;
  const calls: { file: string; argv: readonly string[]; limits: unknown }[] = [];
  const exec: DndExec = async (file, argv, limits) => {
    calls.push({ file, argv, limits });
    if (result instanceof Error) throw result;
    return typeof result === "function" ? result() : result;
  };
  const reader = new OsDndReader({
    platform,
    env: desktop === undefined ? {} : { XDG_CURRENT_DESKTOP: desktop },
    exec,
    now: () => now,
  });
  return {
    reader,
    calls,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("parsers accept only the documented output", () => {
  it("gsettings booleans", () => {
    expect(parseGsettingsBanners("true\n")).toBe("off");
    expect(parseGsettingsBanners("false\n")).toBe("on");
    for (const hostile of ["", "True", "false true", "1", "'false'", "false\nrm -rf /", "truee"]) {
      expect(parseGsettingsBanners(hostile)).toBeNull();
    }
  });
  it("gdbus Inhibited variant", () => {
    expect(parseGdbusInhibited("(<true>,)\n")).toBe("on");
    expect(parseGdbusInhibited("(<false>,)\n")).toBe("off");
    for (const hostile of ["", "true", "(<true>)", "(<'true'>,)", "(<true>,) extra", "(<1>,)"]) {
      expect(parseGdbusInhibited(hostile)).toBeNull();
    }
  });
});

describe("OsDndReader on Linux", () => {
  it("GNOME: show-banners false is DND on, true is off, with fixed argv and limits", async () => {
    const off = rig("linux", "ubuntu:GNOME", ok("true\n"));
    expect(await off.reader.readReading()).toEqual({
      state: "off",
      platform: "linux",
      source: "gsettings:org.gnome.desktop.notifications/show-banners",
      reason: null,
    });
    expect(off.calls).toEqual([
      {
        file: "gsettings",
        argv: ["get", "org.gnome.desktop.notifications", "show-banners"],
        limits: { timeoutMs: DND_EXEC_TIMEOUT_MS, maxOutputBytes: DND_EXEC_MAX_OUTPUT_BYTES },
      },
    ]);
    const on = rig("linux", "GNOME", ok("false\n"));
    expect(await on.reader.read()).toBe(true);
    expect(await off.reader.read()).toBe(false);
  });

  it("KDE: Inhibited true is DND on, false is off, read through gdbus on the session bus", async () => {
    const on = rig("linux", "KDE", ok("(<true>,)\n"));
    expect(await on.reader.readReading()).toMatchObject({
      state: "on",
      source: "dbus:org.freedesktop.Notifications.Inhibited (KDE Plasma)",
    });
    expect(on.calls[0]?.file).toBe("gdbus");
    expect(on.calls[0]?.argv).toEqual([
      "call",
      "--session",
      "--dest",
      "org.freedesktop.Notifications",
      "--object-path",
      "/org/freedesktop/Notifications",
      "--method",
      "org.freedesktop.DBus.Properties.Get",
      "org.freedesktop.Notifications",
      "Inhibited",
    ]);
    const off = rig("linux", "KDE", ok("(<false>,)"));
    expect(await off.reader.read()).toBe(false);
  });

  it("never passes caller-controlled text to the program (only the desktop name picks a fixed argv)", async () => {
    const { reader, calls } = rig("linux", "GNOME;touch /tmp/x", ok("true"));
    expect(await reader.readReading()).toMatchObject({
      state: "unknown",
      reason: "desktop_unsupported",
    });
    expect(calls).toEqual([]);
  });

  it("hostile or surprising output is unknown, with a fixed reason", async () => {
    for (const out of ["maybe\n", "", "true\nfalse\n", "(<true>,)"]) {
      const r = rig("linux", "GNOME", ok(out));
      expect(await r.reader.readReading()).toMatchObject({
        state: "unknown",
        reason: "unexpected_output",
      });
      expect(await r.reader.read()).toBeNull();
    }
    const big = rig("linux", "GNOME", ok("true" + " ".repeat(DND_EXEC_MAX_OUTPUT_BYTES)));
    expect(await big.reader.readReading()).toMatchObject({ reason: "output_too_large" });
    const capped = rig("linux", "GNOME", { ...ok(""), code: null, outputCapped: true });
    expect(await capped.reader.readReading()).toMatchObject({ reason: "output_too_large" });
  });

  it("a non-zero exit, a timeout and a thrown exec are unknown", async () => {
    const failed = rig("linux", "KDE", { ...ok("(<true>,)"), code: 1 });
    expect(await failed.reader.readReading()).toMatchObject({ state: "unknown", reason: "failed" });
    const timed = rig("linux", "GNOME", { ...ok(""), code: null, timedOut: true });
    expect(await timed.reader.readReading()).toMatchObject({ state: "unknown", reason: "timeout" });
    const thrown = rig("linux", "GNOME", new Error("secret /home/x"));
    const reading = await thrown.reader.readReading();
    expect(reading).toMatchObject({ state: "unknown", reason: "failed" });
    expect(JSON.stringify(reading)).not.toContain("secret");
  });

  it("a missing tool is permanent and is not retried", async () => {
    const r = rig("linux", "GNOME", { ...ok(""), code: null, notFound: true });
    expect(r.reader.permanentlyUnavailable()).toBe(false);
    expect(await r.reader.readReading()).toMatchObject({
      state: "unknown",
      reason: "tool_missing",
    });
    expect(r.reader.permanentlyUnavailable()).toBe(true);
    r.advance(10 * DND_MIN_READ_INTERVAL_MS);
    await r.reader.readReading();
    expect(r.calls).toHaveLength(1);
  });

  it("reuses a fresh reading and shares one in-flight read", async () => {
    const gate = Promise.withResolvers<DndExecResult>();
    const r = rig("linux", "GNOME", () => gate.promise);
    const a = r.reader.readReading();
    const b = r.reader.readReading();
    gate.resolve(ok("false"));
    expect((await a).state).toBe("on");
    expect(await b).toBe(await a);
    expect(r.calls).toHaveLength(1);
    r.advance(DND_MIN_READ_INTERVAL_MS - 1);
    await r.reader.readReading();
    expect(r.calls).toHaveLength(1);
    r.advance(1);
    await r.reader.readReading();
    expect(r.calls).toHaveLength(2);
  });
});

describe("platform gating: nothing is executed", () => {
  it.each([
    ["darwin", "unsupported_macos"],
    ["win32", "unsupported_windows"],
    ["freebsd", "unsupported_platform"],
  ] as const)("%s", async (platform, reason) => {
    const { reader, calls } = rig(platform, "GNOME", ok("false"));
    expect(await reader.readReading()).toEqual({
      state: "unknown",
      platform,
      source: null,
      reason,
    });
    expect(await reader.read()).toBeNull();
    expect(reader.permanentlyUnavailable()).toBe(true);
    expect(calls).toEqual([]);
  });

  it("Linux without a recognised desktop", async () => {
    for (const desktop of [undefined, "", "XFCE", "MATE:Budgie"]) {
      const { reader, calls } = rig("linux", desktop, ok("false"));
      expect(await reader.readReading()).toMatchObject({
        state: "unknown",
        source: null,
        reason: "desktop_unsupported",
      });
      expect(calls).toEqual([]);
    }
  });
});

describe("execDnd (real exec, harmless programs only)", () => {
  const limits = { timeoutMs: 2_000, maxOutputBytes: 64 };
  it("reports a missing program", async () => {
    expect(await execDnd("phoenix-no-such-program-xyz", [], limits)).toMatchObject({
      notFound: true,
      code: null,
    });
  });
  it("returns stdout of a normal exit, with no shell interpretation", async () => {
    const result = await execDnd(
      process.execPath,
      ["-e", "process.stdout.write('$HOME;true')"],
      limits,
    );
    expect(result).toMatchObject({ code: 0, stdout: "$HOME;true" });
  });
  it("flags too much output and a timeout", async () => {
    const big = await execDnd(
      process.execPath,
      ["-e", "process.stdout.write('x'.repeat(500))"],
      limits,
    );
    expect(big.outputCapped).toBe(true);
    // Real timer on purpose: this checks that the OS-level kill deadline in `execFile` fires, which
    // fake timers cannot exercise. The child sleeps past a 200 ms deadline and is killed.
    const slow = await execDnd(process.execPath, ["-e", "setTimeout(()=>{},10000)"], {
      ...limits,
      timeoutMs: 200,
    });
    expect(slow).toMatchObject({ timedOut: true, outputCapped: false });
  });
});

describe("FocusController polling", () => {
  function pollRig(reader: {
    read: () => Promise<boolean | null>;
    permanentlyUnavailable?: () => boolean;
  }) {
    const timers: { fn: () => void; ms: number }[] = [];
    const cleared: unknown[] = [];
    const controller = new FocusController<FocusNotification>(
      {
        now: () => 0,
        setTimeout: (fn, ms) => {
          const timer = { fn, ms };
          timers.push(timer);
          return timer;
        },
        clearTimeout: (h) => cleared.push(h),
      },
      reader,
      vi.fn(),
    );
    const flush = async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    };
    return { controller, timers, cleared, flush };
  }

  it("does nothing until started, reads once, then every interval clamped to the bounds", async () => {
    const read = vi.fn(async () => false as boolean | null);
    const { controller, timers, flush } = pollRig({ read });
    expect(timers).toEqual([]);
    controller.startDndPolling(1);
    controller.startDndPolling(1);
    expect(timers).toHaveLength(1);
    timers[0]!.fn();
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    expect(timers[1]!.ms).toBe(15_000);
    timers[1]!.fn();
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    expect(timers[2]!.ms).toBe(15_000);
    const huge = pollRig({ read });
    huge.controller.startDndPolling(10 ** 12);
    huge.timers[0]!.fn();
    await huge.flush();
    expect(huge.timers[1]!.ms).toBe(300_000);
  });

  it("stops after a read when no read can ever succeed, and on dispose", async () => {
    const read = vi.fn(async () => null as boolean | null);
    const gone = pollRig({ read, permanentlyUnavailable: () => true });
    gone.controller.startDndPolling(60_000);
    gone.timers[0]!.fn();
    await gone.flush();
    expect(gone.timers).toHaveLength(1);
    const live = pollRig({ read });
    live.controller.startDndPolling(60_000);
    live.timers[0]!.fn();
    await live.flush();
    expect(live.timers).toHaveLength(2);
    live.controller.dispose();
    expect(live.cleared).toContain(live.timers[1]);
  });

  it("an OS reading holds ordinary notifications and names platform and source in the snapshot", async () => {
    const { reader } = rig("linux", "GNOME", ok("false\n"));
    const delivered: string[] = [];
    const controller = new FocusController<FocusNotification>(
      { now: () => 0, setTimeout: vi.fn(), clearTimeout: vi.fn() },
      {
        read: () => reader.read(),
        reading: () => reader.reading(),
        permanentlyUnavailable: () => reader.permanentlyUnavailable(),
      },
      (n) => delivered.push(n.id),
    );
    await controller.refreshDnd();
    expect(controller.snapshot()).toMatchObject({
      osDnd: true,
      active: true,
      dnd: {
        state: "on",
        platform: "linux",
        source: "gsettings:org.gnome.desktop.notifications/show-banners",
        reason: null,
      },
    });
    expect(controller.receive({ id: "a", severity: "info" })).toBe("held");
    expect(controller.receive({ id: "b", severity: "error" })).toBe("delivered");
    expect(delivered).toEqual(["b"]);
  });
});
