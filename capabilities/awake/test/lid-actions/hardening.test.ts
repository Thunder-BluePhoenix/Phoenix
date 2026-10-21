// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Findings of the independent security review of the lid actions, each pinned on the fake machine
// of rig.ts (no real signal, sound, display, assertion probe or `defaults` is ever touched).
import { describe, expect, it } from "vitest";
import { trackActivity, ACTIVITY_STALE_MS } from "../../src/lid-actions/activity";
import { parseAssertionHolders } from "../../src/lid-actions/assertions";
import { FakeClock, FakeFeed } from "../../testing/fakes";
import { parseJournal } from "../../src/power/format";
import { JOURNAL } from "../power/fixtures";
import {
  Machine,
  UID,
  boot,
  flush,
  outcomes,
  proc,
  simulateClose,
  simulateOpen,
  startSession,
  type Instance,
} from "./rig";

const IDLE = { protectedState: () => "idle" as const };

async function ready(m: Machine, options: Parameters<typeof boot>[1] = {}): Promise<Instance> {
  const i = await boot(m, { ...options, lid: { ...IDLE, ...options.lid } });
  await startSession(i);
  return i;
}

function pending(m: Machine): string[] {
  return parseJournal(m.fs.read(JOURNAL) ?? "").pending.map((e) => e.kind);
}

const ONLY = (keep: string) => ({
  lid_actions: {
    freeze_apps: keep === "freeze_apps",
    mute: keep === "mute",
    display: keep === "display",
    low_power: false,
    app_nap: keep === "app_nap",
    app_nap_apps: ["com.example.Agent"],
  },
});

/** An `pmset -g assertions` listing in which `pid` holds the given assertion line. */
const listing = (...blocks: string[]) =>
  ["Assertion status system-wide:", "   PreventUserIdleSystemSleep     0", ...blocks, ""].join(
    "\n",
  );
const holder = (pid: number, name: string, type: string, extra = "") =>
  `   pid ${pid}(${name}): [0x0000000000000001] 00:10:00 ${type} named: "call"${extra}`;

describe("1a: meeting guard on mute, display sleep and App Nap", () => {
  for (const action of ["mute", "display", "app_nap"] as const) {
    for (const [state, reason] of [
      ["active", "protected_state"],
      ["unknown", "state_unknown"],
    ] as const) {
      it(`${action}: ${state} state skips it (${reason}) and changes nothing`, async () => {
        const m = new Machine();
        const i = await ready(m, {
          config: ONLY(action),
          lid: { protectedState: () => state },
        });
        const closed = await simulateClose(i);
        expect(closed.results.find((r) => r.action === action)).toMatchObject({
          outcome: "skipped",
          reason,
        });
        expect(m.effects()).toEqual([]);
        expect(pending(m)).toEqual([]);
      });
    }

    it(`${action}: a meeting that starts between plan and apply stops it`, async () => {
      const m = new Machine();
      let reads = 0;
      const i = await ready(m, {
        config: ONLY(action),
        lid: { protectedState: () => (++reads > 1 ? "active" : "idle") },
      });
      const closed = await simulateClose(i);
      expect(closed.results.find((r) => r.action === action)?.outcome).toBe("failed");
      expect(m.effects()).toEqual([]);
      // Nothing happened, so nothing is left to undo.
      expect(pending(m)).toEqual([]);
    });
  }
});

describe("1b: an app that holds a power or audio assertion is not frozen", () => {
  it("reads the assertions with one constant read-only argv", async () => {
    const m = new Machine();
    const i = await ready(m, { config: ONLY("freeze_apps") });
    await simulateClose(i);
    expect(m.commands.filter((c) => c.startsWith("/usr/bin/pmset -g"))).toEqual([
      "/usr/bin/pmset -g assertions",
      "/usr/bin/pmset -g assertions", // and again right before signalling
    ]);
  });

  it("a Slack process holding PreventUserIdleDisplaySleep keeps ALL of Slack unfrozen; the others freeze", async () => {
    const m = new Machine();
    m.assertions = listing(holder(101, "Slack Helper", "PreventUserIdleDisplaySleep"));
    const i = await ready(m, { config: ONLY("freeze_apps") });
    const closed = await simulateClose(i);
    expect(m.sent("SIGSTOP").sort()).toEqual([110, 120]);
    expect(closed.results.find((r) => r.action === "freeze_apps")).toMatchObject({
      outcome: "applied",
      count: 2,
    });
  });

  it("an audio-out assertion counts, and so does the pid an assertion was created for", async () => {
    const m = new Machine();
    m.assertions = listing(
      holder(110, "WhatsApp", "NoIdleSleepAssertion"),
      '   pid 90(coreaudiod): [0x2] 00:05:00 PreventUserIdleSystemSleep named: "x"',
      "      Created for PID: 120",
      "      Resources: audio-out",
    );
    const i = await ready(m, { config: ONLY("freeze_apps") });
    await simulateClose(i);
    expect(m.sent("SIGSTOP").sort()).toEqual([100, 101]);
  });

  it("every app busy: skipped as holds_assertion, nothing signalled, nothing journalled", async () => {
    const m = new Machine();
    m.assertions = listing(
      holder(100, "Slack", "PreventUserIdleSystemSleep"),
      holder(110, "WhatsApp", "PreventUserIdleSystemSleep"),
      holder(120, "Discord", "PreventUserIdleDisplaySleep"),
    );
    const i = await ready(m, { config: ONLY("freeze_apps") });
    const closed = await simulateClose(i);
    expect(closed.results.find((r) => r.action === "freeze_apps")).toMatchObject({
      outcome: "skipped",
      reason: "holds_assertion",
    });
    expect(m.signals).toEqual([]);
    expect(pending(m)).toEqual([]);
  });

  it("an unreadable probe fails closed: skipped as assertions_unknown and announced", async () => {
    for (const text of [null, "something unexpected\n"]) {
      const m = new Machine();
      m.assertions = text;
      const i = await ready(m, { config: ONLY("freeze_apps") });
      const closed = await simulateClose(i);
      expect(closed.results.find((r) => r.action === "freeze_apps")).toMatchObject({
        outcome: "skipped",
        reason: "assertions_unknown",
      });
      expect(m.signals).toEqual([]);
      expect(i.events("awake.lid_action.failed")).toContainEqual(
        expect.objectContaining({ action: "freeze_apps", reason: "assertions_unknown" }),
      );
    }
  });

  it("a call that starts between plan and apply stops the freeze (read again at the last moment)", async () => {
    const m = new Machine();
    m.assertionsSeq = [
      "Assertion status system-wide:\n",
      listing(holder(100, "Slack", "PreventUserIdleSystemSleep")),
    ];
    const i = await ready(m, { config: ONLY("freeze_apps") });
    const closed = await simulateClose(i);
    expect(m.signals.filter((s) => s.signal === "SIGSTOP").map((s) => s.pid)).toEqual([110, 120]);
    expect(closed.results.find((r) => r.action === "freeze_apps")?.outcome).toBe("applied");
  });

  it("Docker Desktop is guarded the same way", async () => {
    const m = new Machine();
    m.assertions = listing(holder(601, "com.docker.virtualization", "PreventUserIdleSystemSleep"));
    const i = await ready(m, {
      config: {
        lid_actions: {
          ...ONLY("freeze_apps").lid_actions,
          freeze_apps: false,
          docker_freeze: true,
        },
      },
      lid: { dockerIdle: () => Promise.resolve("idle") },
    });
    const closed = await simulateClose(i);
    expect(closed.results.find((r) => r.action === "docker_freeze")).toMatchObject({
      outcome: "skipped",
      reason: "holds_assertion",
    });
    expect(m.signals).toEqual([]);
  });

  it("the parser reads holders and refuses anything that is not a listing", () => {
    expect(parseAssertionHolders("nope")).toBeNull();
    expect(parseAssertionHolders(listing())).toEqual(new Set());
    expect(
      parseAssertionHolders(
        listing(
          holder(7, "a", "PreventUserIdleSystemSleep"),
          holder(8, "b", "PreventDiskIdle"),
          holder(1, "launchd", "PreventUserIdleSystemSleep"),
        ),
      ),
    ).toEqual(new Set([7]));
  });
});

describe("2: a lid that opened while the observer read `unknown`", () => {
  it("is treated as open once a known `open` follows, and the actions are undone", async () => {
    const m = new Machine();
    const i = await ready(m, { config: ONLY("freeze_apps") });
    await i.tick(); // open
    m.lid = "Yes";
    await i.tick(); // closed: the actions run
    expect(m.sent("SIGSTOP").length).toBeGreaterThan(0);
    m.lidUnreadable = true;
    await i.tick(); // unknown
    m.lidUnreadable = false;
    m.lid = "No";
    await i.tick(); // open, but the observer announces nothing after `unknown`
    expect(pending(m)).toContain("lid.freeze");
    await i.advance(5_000);
    await flush();
    expect(pending(m)).toEqual([]);
    expect(m.stopped.size).toBe(0);
  });

  it("a simulated close is not undone by an `open` reading (only a real lid close is)", async () => {
    const m = new Machine();
    const i = await ready(m, { config: ONLY("freeze_apps") });
    await i.tick();
    await simulateClose(i);
    await i.advance(5_000);
    await flush();
    expect(pending(m)).toContain("lid.freeze");
  });
});

describe("3: mute restores the output that was muted, not whatever is default now", () => {
  const MUTE = ONLY("mute");

  it("the default output's name is recorded in the journal entry", async () => {
    const m = new Machine();
    m.defaultOnly = true;
    const i = await ready(m, { config: MUTE });
    await simulateClose(i);
    const entry = parseJournal(m.fs.read(JOURNAL) ?? "").pending.find((e) => e.kind === "lid.mute");
    expect(entry?.undo.default_name).toBe("Speakers");
  });

  it("a changed default is NOT unmuted: output_changed, pending, announced; restored once the old default is back", async () => {
    const m = new Machine();
    m.defaultOnly = true;
    m.devices = [
      { id: "builtin", muted: false },
      { id: "headphones", muted: true },
    ];
    const i = await ready(m, { config: MUTE });
    await simulateClose(i);
    expect(m.devices[0]?.muted).toBe(true);
    m.defaultOutput = "headphones"; // switched while the lid was closed (muted by the user)
    const opened = await simulateOpen(i);
    expect(opened.results.find((r) => r.action === "mute")).toMatchObject({
      outcome: "undo_failed",
      reason: "output_changed",
    });
    expect(m.log.filter((e) => e.what === "audio:headphones:false")).toEqual([]);
    expect(m.devices.map((d) => d.muted)).toEqual([true, true]);
    expect(pending(m)).toEqual(["lid.mute"]);
    expect(i.events("awake.lid_action.failed")).toContainEqual(
      expect.objectContaining({ action: "mute", phase: "undo", reason: "output_changed" }),
    );
    m.defaultOutput = "builtin";
    await i.services().recovery.undo();
    expect(m.devices[0]?.muted).toBe(false);
    expect(pending(m)).toEqual([]);
  });

  it("an unreadable name at mute time is marked unknown and the undo goes by id as before", async () => {
    const m = new Machine();
    m.defaultOnly = true;
    m.deviceNames = { builtin: null, headphones: null };
    const i = await ready(m, { config: MUTE });
    const closed = await simulateClose(i);
    expect(closed.results.find((r) => r.action === "mute")?.notes).toEqual([
      "output_identity_unknown",
    ]);
    const opened = await simulateOpen(i);
    expect(outcomes(opened).mute).toBe("undone");
    expect(m.devices[0]?.muted).toBe(false);
    const status = (await i.call("lid_actions.status")) as {
      actions: { id: string; limits?: string[] }[];
    };
    expect(status.actions.find((a) => a.id === "mute")?.limits).toEqual([
      "default_output_only",
      "output_identity_unknown",
    ]);
  });
});

describe("4: freeze targets, undo retries, EPERM and shutdown", () => {
  it("only processes of Phoenix's own user are targets, in the plan and at the last moment", async () => {
    const m = new Machine();
    m.table.push({
      ...proc(130, 1, "/Applications/Slack.app/Contents/MacOS/Slack Helper Other"),
      uid: 0,
    });
    const i = await ready(m, { config: ONLY("freeze_apps") });
    await simulateClose(i);
    expect(m.sent("SIGSTOP")).not.toContain(130);
    const entry = parseJournal(m.fs.read(JOURNAL) ?? "").pending.find(
      (e) => e.kind === "lid.freeze",
    );
    expect((entry?.undo.procs as { pid: number }[]).map((p) => p.pid)).not.toContain(130);
    expect(UID).toBe(501);
  });

  it("a process whose owner changed between plan and apply is not signalled (checked again at the last moment)", async () => {
    const m = new Machine();
    let reads = 0;
    const i = await ready(m, {
      config: ONLY("freeze_apps"),
      lid: {
        processes: async () => {
          const table = await m.processes();
          return ++reads > 1 ? table.map((p) => (p.pid === 110 ? { ...p, uid: 0 } : p)) : table;
        },
      },
    });
    await simulateClose(i);
    expect(m.sent("SIGSTOP")).not.toContain(110);
    expect(m.sent("SIGSTOP").length).toBeGreaterThan(0);
  });

  it("a recorded process that now belongs to another user is not resumed and is counted as not ours", async () => {
    const m = new Machine();
    const i = await ready(m, { config: ONLY("freeze_apps") });
    await simulateClose(i);
    m.table = m.table.map((p) => (p.pid === 110 ? { ...p, uid: 0 } : p));
    const opened = await simulateOpen(i);
    expect(m.sent("SIGCONT")).not.toContain(110);
    expect(opened.results.find((r) => r.action === "freeze_apps")).toMatchObject({
      outcome: "undone",
      notOurs: 1,
    });
    expect(pending(m)).toEqual([]);
  });

  it("EPERM on thaw does not leave the entry pending forever: classed not_ours and reported", async () => {
    const m = new Machine();
    const i = await ready(m, { config: ONLY("freeze_apps") });
    await simulateClose(i);
    m.denied.add(100);
    const opened = await simulateOpen(i);
    expect(opened.results.find((r) => r.action === "freeze_apps")).toMatchObject({
      outcome: "undone",
      notOurs: 1,
    });
    expect(pending(m)).toEqual([]);
    expect(i.events("awake.lid_action.failed")).toContainEqual(
      expect.objectContaining({ action: "freeze_apps", phase: "undo", reason: "not_ours" }),
    );
  });

  it("a failing undo is tried 3 times with a backoff from the injected timer, then stays pending", async () => {
    const m = new Machine();
    const i = await ready(m, { config: ONLY("freeze_apps") });
    await simulateClose(i);
    m.signalFails.add(100);
    const before = m.sent("SIGCONT").filter((p) => p === 100).length;
    const opened = await simulateOpen(i);
    expect(m.sent("SIGCONT").filter((p) => p === 100).length - before).toBe(3);
    expect(m.sleeps).toEqual([1_000, 3_000]);
    expect(outcomes(opened).freeze_apps).toBe("undo_failed");
    expect(pending(m)).toEqual(["lid.freeze"]);
  });

  it("a retry that succeeds ends the undo", async () => {
    const m = new Machine();
    const i = await ready(m, { config: ONLY("freeze_apps") });
    await simulateClose(i);
    m.signalFails.add(100);
    m.onSleep = () => m.signalFails.clear();
    const opened = await simulateOpen(i);
    expect(m.sleeps).toEqual([1_000]);
    expect(outcomes(opened).freeze_apps).toBe("undone");
    expect(pending(m)).toEqual([]);
    expect(m.stopped.size).toBe(0);
  });

  it("shutdown awaits the undo", async () => {
    const m = new Machine();
    const i = await ready(m, { config: ONLY("freeze_apps") });
    await simulateClose(i);
    await i.lidShutdown();
    expect(pending(m)).toEqual([]);
    expect(m.stopped.size).toBe(0);
  });

  it("shutdown never waits longer than its cap, even when the undo is stuck", async () => {
    const m = new Machine();
    const i = await ready(m, { config: ONLY("freeze_apps") });
    await simulateClose(i);
    m.hang = true;
    let done = false;
    void Promise.resolve(i.lidShutdown()).then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    await i.advance(10_000);
    expect(done).toBe(true);
  });
});

describe("display: the brightness tool is trusted only by its owner and mode", () => {
  const DISPLAY = ONLY("display");

  it("a tool owned by another user is not run; only displaysleepnow happens", async () => {
    const m = new Machine();
    m.toolStat = { uid: 777, mode: 0o755 };
    const i = await ready(m, { config: DISPLAY });
    const closed = await simulateClose(i);
    expect(closed.results.find((r) => r.action === "display")?.notes).toContain(
      "brightness_tool_missing",
    );
    expect(m.commands.some((c) => c.includes("brightness"))).toBe(false);
    expect(m.commands).toContain("/usr/bin/pmset displaysleepnow");
  });

  it("a group- or world-writable tool is not run, and neither is an unreadable one", async () => {
    for (const stat of [{ uid: 0, mode: 0o775 }, { uid: UID, mode: 0o757 }, null]) {
      const m = new Machine();
      m.toolStat = stat;
      const i = await ready(m, { config: DISPLAY });
      await simulateClose(i);
      expect(
        m.commands.some((c) => c.includes("brightness")),
        JSON.stringify(stat),
      ).toBe(false);
    }
  });

  it("a tool owned by root or by the user, not group/world-writable, is run (exact argv)", async () => {
    for (const uid of [0, UID]) {
      const m = new Machine();
      m.toolStat = { uid, mode: 0o755 };
      const i = await ready(m, { config: DISPLAY });
      await simulateClose(i);
      expect(m.commands).toContain("/opt/homebrew/bin/brightness -l");
      expect(m.commands).toContain("/opt/homebrew/bin/brightness -d 0 0");
      await simulateOpen(i);
      expect(m.commands).toContain("/opt/homebrew/bin/brightness -d 0 0.6");
    }
  });

  it("a tool that became untrusted before the undo is not run to restore brightness; the entry is not left pending", async () => {
    const m = new Machine();
    const i = await ready(m, { config: DISPLAY });
    await simulateClose(i);
    m.toolStat = { uid: 777, mode: 0o777 };
    const opened = await simulateOpen(i);
    expect(m.commands).not.toContain("/opt/homebrew/bin/brightness -d 0 0.6");
    expect(opened.results.find((r) => r.action === "display")?.notes).toEqual([
      "brightness_tool_untrusted",
    ]);
    expect(pending(m)).toEqual([]);
  });
});

describe("1c/1d: meeting and recording never expire by themselves, and an end clears only its own capture", () => {
  const HOURS = 60 * 60_000;

  it("a meeting or recording stays active past ACTIVITY_STALE_MS until its end event arrives", async () => {
    for (const [on, off] of [
      ["kage.meeting.started", "kage.meeting.ended"],
      ["notetaker.recording", "notetaker.idle"],
    ] as const) {
      const feed = new FakeFeed();
      const clock = new FakeClock();
      const a = trackActivity(feed, clock);
      await feed.publish(on, { title: "standup", session: "s1" });
      clock.current += 3 * ACTIVITY_STALE_MS;
      expect(a.protectedState(), on).toBe("active");
      await feed.publish(off, { title: "standup", session: "s1" });
      expect(a.protectedState(), off).toBe("idle");
    }
  });

  it("dictation and voice (short by design) still stop counting when their idle event is lost", async () => {
    const feed = new FakeFeed();
    const clock = new FakeClock();
    const a = trackActivity(feed, clock);
    await feed.publish("voice.listening", { session: "v1" });
    clock.current += 3 * HOURS + 1;
    expect(a.protectedState()).toBe("idle");
  });

  it("an end event of one capture does not clear another that is still running", async () => {
    const feed = new FakeFeed();
    const a = trackActivity(feed, new FakeClock());
    await feed.publish("kage.meeting.started", { title: "A" });
    await feed.publish("kage.meeting.started", { title: "B" });
    await feed.publish("kage.meeting.ended", { title: "A" });
    expect(a.protectedState()).toBe("active");
    await feed.publish("kage.meeting.ended", { title: "B" });
    expect(a.protectedState()).toBe("idle");
  });

  it("a meeting end does not clear a recording or a dictation that is still active", async () => {
    const feed = new FakeFeed();
    const a = trackActivity(feed, new FakeClock());
    await feed.publish("kage.meeting.started", { title: "A" });
    await feed.publish("notetaker.recording", { session: "n1" });
    await feed.publish("dictation.listening", { session: "d1" });
    await feed.publish("kage.meeting.ended", { title: "A" });
    expect(a.protectedState()).toBe("active");
    await feed.publish("notetaker.idle", { session: "n1" });
    expect(a.protectedState()).toBe("active");
    await feed.publish("dictation.idle", { session: "d1" });
    expect(a.protectedState()).toBe("idle");
  });

  it("two notetaker sessions: the first idle leaves the second recording", async () => {
    const feed = new FakeFeed();
    const a = trackActivity(feed, new FakeClock());
    await feed.publish("notetaker.recording", { session: "n1" });
    await feed.publish("notetaker.recording", { session: "n2" });
    await feed.publish("notetaker.idle", { session: "n1" });
    expect(a.protectedState()).toBe("active");
  });
});
