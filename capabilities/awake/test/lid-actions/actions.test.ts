// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The safety rules of each action, on the fake machine of rig.ts (no real signal, sound, display or
// `defaults` is ever touched).
import { describe, expect, it } from "vitest";
import { parseJournal } from "../../src/power/format";
import { JOURNAL } from "../power/fixtures";
import {
  Machine,
  SELF_PID,
  T0,
  T1,
  boot,
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

describe("freeze: who is signalled", () => {
  it("never signals a protected process, even one listed for freezing (a chat app under a terminal, Phoenix's own pid, a tracked agent)", async () => {
    const m = new Machine();
    // A Slack process started from Terminal (pid 300); Slack's pid listed by a tracked agent;
    // a Slack-path process that IS Phoenix's own pid; a Slack child of Phoenix.
    m.table.push(proc(310, 300, "/Applications/Slack.app/Contents/MacOS/Slack"));
    m.table.push(proc(320, 1, "/Applications/Discord.app/Contents/MacOS/Discord Helper"));
    m.table.push(proc(330, SELF_PID, "/Applications/Slack.app/Contents/MacOS/Slack"));
    const i = await ready(m, { lid: { agentPids: () => [320] } });
    await simulateClose(i);
    const stopped = m.sent("SIGSTOP");
    expect(stopped).not.toContain(310); // under a terminal
    expect(stopped).not.toContain(320); // a tracked agent
    expect(stopped).not.toContain(330); // Phoenix's tree
    expect(stopped).not.toContain(SELF_PID);
    expect(stopped).not.toContain(300); // the terminal
    expect(stopped).not.toContain(400); // the editor
    expect(stopped.sort()).toEqual([100, 101, 110, 120]);
    // The plan itself refuses them: a protected pid is never even written to the journal.
    const entry = parseJournal(m.fs.read(JOURNAL) ?? "").pending.find(
      (e) => e.kind === "lid.freeze",
    );
    const planned = (entry?.undo.procs as { pid: number }[]).map((p) => p.pid).sort();
    expect(planned).toEqual([100, 101, 110, 120]);
  });

  it("a user-added protected name stops a freeze that would otherwise happen", async () => {
    const m = new Machine();
    const i = await ready(m, { config: { lid_actions: { protected_extra: ["whatsapp"] } } });
    await simulateClose(i);
    expect(m.sent("SIGSTOP")).not.toContain(110);
    expect(m.sent("SIGSTOP").sort()).toEqual([100, 101, 120]);
  });

  it("a process that became protected between plan and apply is not signalled (checked again at the last moment)", async () => {
    const m = new Machine();
    let polls = 0;
    const i = await ready(m, {
      lid: {
        // The second table read (at apply) shows the Slack process as a child of a terminal.
        processes: () => {
          polls += 1;
          return Promise.resolve(
            m.table.map((p) => (polls > 1 && p.pid === 100 ? { ...p, ppid: 300 } : { ...p })),
          );
        },
      },
    });
    await simulateClose(i);
    expect(m.sent("SIGSTOP")).not.toContain(100);
  });

  it("never freezes in a meeting, a recording or while dictating", async () => {
    const m = new Machine();
    const i = await ready(m, { lid: { protectedState: () => "active" } });
    const closed = await simulateClose(i);
    expect(closed.results.find((r) => r.action === "freeze_apps")).toMatchObject({
      outcome: "skipped",
      reason: "protected_state",
    });
    expect(m.signals).toEqual([]);
    expect(pending(m)).not.toContain("lid.freeze");
  });

  it("unknown state fails closed: no freeze (no event feed at all)", async () => {
    const m = new Machine();
    const i = await boot(m, { noFeed: true });
    await startSession(i).catch(() => undefined);
    // agents_grace needs a feed but a timed session does not.
    const closed = await simulateClose(i);
    expect(closed.results.find((r) => r.action === "freeze_apps")).toMatchObject({
      outcome: "skipped",
      reason: "state_unknown",
    });
    expect(m.signals).toEqual([]);
    // The other actions still run; mute, display sleep and App Nap fail closed too (finding 1a).
    expect(closed.results.find((r) => r.action === "mute")).toMatchObject({
      outcome: "skipped",
      reason: "state_unknown",
    });
    expect(closed.results.find((r) => r.action === "display")).toMatchObject({
      outcome: "skipped",
      reason: "state_unknown",
    });
    expect(outcomes(closed).low_power).toBe("applied");
  });

  it("a meeting that starts between plan and apply stops the freeze", async () => {
    const m = new Machine();
    let calls = 0;
    const i = await ready(m, { lid: { protectedState: () => (++calls > 1 ? "active" : "idle") } });
    const closed = await simulateClose(i);
    expect(closed.results.find((r) => r.action === "freeze_apps")?.outcome).toBe("failed");
    expect(m.signals).toEqual([]);
    // The entry closed itself: it never happened.
    expect(pending(m)).not.toContain("lid.freeze");
  });

  it("a process already stopped by someone else is not Phoenix's to freeze or resume", async () => {
    const m = new Machine();
    m.table = m.table.map((p) => (p.pid === 110 ? { ...p, state: "T" } : p));
    const i = await ready(m);
    await simulateClose(i);
    expect(m.sent("SIGSTOP")).not.toContain(110);
    await simulateOpen(i);
    expect(m.sent("SIGCONT")).not.toContain(110);
  });

  it("records pid, start time and command in the journal entry", async () => {
    const m = new Machine();
    const i = await ready(m);
    await simulateClose(i);
    const entry = parseJournal(m.fs.read(JOURNAL) ?? "").pending.find(
      (e) => e.kind === "lid.freeze",
    );
    expect(entry?.undo.procs).toContainEqual({
      pid: 110,
      start: T0,
      command: "/Applications/WhatsApp.app/Contents/MacOS/WhatsApp",
    });
    expect(JSON.stringify(entry)).not.toContain("password");
  });
});

describe("unfreeze: only what it can prove it froze", () => {
  it("a pid with the recorded command but another start time is NOT signalled and stays pending with a warning (retry_or_alert); the others are resumed", async () => {
    const m = new Machine();
    const i = await ready(m);
    await simulateClose(i);
    // Slack (100) quit and its pid was handed to another program that started later.
    m.table = m.table.map((p) => (p.pid === 100 ? { ...p, start: T1 } : p));
    const opened = await simulateOpen(i);
    expect(m.sent("SIGCONT")).not.toContain(100);
    expect(m.sent("SIGCONT").sort()).toEqual([101, 110, 120]);
    const freeze = opened.results.find((r) => r.action === "freeze_apps");
    expect(freeze).toMatchObject({ outcome: "undo_failed", reason: "retry_or_alert" });
    expect(i.events("awake.lid_action.failed")).toContainEqual(
      expect.objectContaining({ action: "freeze_apps", phase: "undo", reason: "retry_or_alert" }),
    );
    expect(pending(m)).toEqual(["lid.freeze"]);
    expect(m.sleeps).toEqual([]); // a changed world is not fixed by retrying at once
  });

  it("a pid reused with the SAME start time but a different command is not signalled either", async () => {
    const m = new Machine();
    const i = await ready(m);
    await simulateClose(i);
    m.table = m.table.map((p) =>
      p.pid === 110 ? { ...p, command: "/usr/bin/some-other-tool" } : p,
    );
    const opened = await simulateOpen(i);
    expect(m.sent("SIGCONT")).not.toContain(110);
    // A different command is a different program: reported as mismatched and dropped.
    expect(opened.results.find((r) => r.action === "freeze_apps")).toMatchObject({
      outcome: "undone",
      mismatched: 1,
    });
    expect(pending(m)).toEqual([]);
  });

  it("a process that is gone is not signalled and is counted as gone", async () => {
    const m = new Machine();
    const i = await ready(m);
    await simulateClose(i);
    m.table = m.table.filter((p) => p.pid !== 120);
    const opened = await simulateOpen(i);
    expect(m.sent("SIGCONT")).not.toContain(120);
    expect(opened.results.find((r) => r.action === "freeze_apps")).toMatchObject({ gone: 1 });
  });

  it("a tampered journal entry (pid 1, pid 0, negative, string) cannot make the undo signal anything", async () => {
    const m = new Machine();
    const i = await ready(m);
    await i.services().recovery.change(
      "lid.freeze",
      { procs: [] },
      {
        procs: [
          { pid: 1, start: T0, command: "/sbin/launchd" },
          { pid: 0, start: T0, command: "/x" },
          { pid: -1, start: T0, command: "/x" },
          { pid: "100", start: T0, command: "/Applications/Slack.app/Contents/MacOS/Slack" },
        ],
      },
      () => Promise.resolve(),
      null,
    );
    await i.services().recovery.undo();
    expect(m.signals).toEqual([]);
  });

  it("an unreadable process table at undo time signals nothing and keeps the entry pending", async () => {
    const m = new Machine();
    let broken = false;
    const i = await ready(m, {
      lid: { processes: () => (broken ? Promise.reject(new Error("ps")) : m.processes()) },
    });
    await simulateClose(i);
    broken = true;
    const opened = await simulateOpen(i);
    expect(opened.results.find((r) => r.action === "freeze_apps")?.outcome).toBe("undo_failed");
    expect(m.sent("SIGCONT")).toEqual([]);
    expect(pending(m)).toContain("lid.freeze");
    broken = false;
    await i.services().recovery.undo();
    expect(m.sent("SIGCONT").length).toBe(4);
    expect(pending(m)).toEqual([]);
  });
});

describe("mute", () => {
  it("records the previous mute state per device; one that was already muted stays muted afterwards", async () => {
    const m = new Machine();
    m.devices = [
      { id: "builtin", muted: false },
      { id: "speaker", muted: true },
      { id: "dac", muted: null },
    ];
    const i = await ready(m);
    await simulateClose(i);
    expect(m.devices.map((d) => d.muted)).toEqual([true, true, null]);
    expect(m.log.filter((e) => e.what.startsWith("audio:")).map((e) => e.what)).toEqual([
      "audio:builtin:true",
    ]);
    await simulateOpen(i);
    expect(m.devices.map((d) => d.muted)).toEqual([false, true, null]);
  });

  it("restores the CURRENT default output when the user switched outputs while the lid was closed", async () => {
    const m = new Machine();
    const i = await ready(m);
    await simulateClose(i);
    expect(m.devices.map((d) => d.muted)).toEqual([true, true]);
    // The user plugs in a new device and switches to it; the OS leaves it muted/unmuted at will.
    m.devices.push({ id: "usb-dac", muted: true });
    m.defaultOutput = "usb-dac";
    await simulateOpen(i);
    // Every recorded device is restored AND the new default is unmuted.
    expect(m.devices).toEqual([
      { id: "builtin", muted: false },
      { id: "headphones", muted: false },
      { id: "usb-dac", muted: false },
    ]);
  });

  it("switching the default to a device that Phoenix muted still restores it", async () => {
    const m = new Machine();
    const i = await ready(m);
    await simulateClose(i);
    m.defaultOutput = "headphones";
    await simulateOpen(i);
    expect(m.devices.map((d) => d.muted)).toEqual([false, false]);
  });

  it("does not unmute a new default output that the user had muted themselves before", async () => {
    const m = new Machine();
    m.devices = [
      { id: "builtin", muted: true },
      { id: "dac", muted: false },
    ];
    m.defaultOutput = "builtin"; // the default was ALREADY muted by the user
    const i = await ready(m);
    await simulateClose(i);
    m.defaultOutput = "dac"; // switched while closed: dac is muted by Phoenix, builtin the user's own
    await simulateOpen(i);
    expect(m.devices.map((d) => d.muted)).toEqual([true, false]);
  });

  it("skips a recorded device that vanished (unplugged) without failing the rest", async () => {
    const m = new Machine();
    const i = await ready(m);
    await simulateClose(i);
    m.devices = m.devices.filter((d) => d.id !== "headphones");
    const opened = await simulateOpen(i);
    expect(outcomes(opened).mute).toBe("undone");
    expect(m.devices.map((d) => d.muted)).toEqual([false]);
  });

  it("an output list that cannot be read is skipped with a notice and nothing is muted", async () => {
    const m = new Machine();
    const i = await ready(m, {
      lid: { audio: { ...m.audio, listOutputs: () => Promise.reject(new Error("no audio")) } },
    });
    const closed = await simulateClose(i);
    expect(closed.results.find((r) => r.action === "mute")).toMatchObject({
      outcome: "skipped",
      reason: "audio_unavailable",
    });
    expect(m.devices.map((d) => d.muted)).toEqual([false, false]);
  });

  it("by-id adapter: the journal entry carries every device's prior state, the default's id, prior state and name", async () => {
    const m = new Machine();
    m.devices = [
      { id: "builtin", muted: false },
      { id: "speaker", muted: true },
      { id: "headphones", muted: false },
    ];
    m.deviceNames = { builtin: "Speakers", speaker: "Desk", headphones: "Headphones" };
    const i = await ready(m);
    await simulateClose(i);
    const entry = parseJournal(m.fs.read(JOURNAL) ?? "").pending.find((e) => e.kind === "lid.mute");
    expect(entry?.undo).toEqual({
      devices: [
        { id: "builtin", prior: false },
        { id: "headphones", prior: false },
      ],
      default_id: "builtin",
      default_prior: false,
      default_name: "Speakers",
    });
    expect(entry?.apply).toEqual({ devices: ["builtin", "headphones"] });
    const journalled = m.log.findIndex((e) => e.what === "journal:lid.mute");
    const firstAudio = m.log.findIndex((e) => e.what.startsWith("audio:"));
    expect(journalled).toBeGreaterThanOrEqual(0);
    expect(firstAudio).toBeGreaterThan(journalled);
  });

  it("default-only adapter: a default switched between the plan and the apply mutes NOTHING (not the new default) and leaves no entry behind", async () => {
    const m = new Machine();
    m.defaultOnly = true;
    m.devices = [
      { id: "builtin", muted: false },
      { id: "headphones", muted: false },
    ];
    // The plan reads the outputs once; the user switches right after it, before the apply reads them.
    let reads = 0;
    const real = m.audio;
    const audio = {
      addressing: real.addressing,
      defaultOutputId: () => real.defaultOutputId(),
      setMuted: (id: string, muted: boolean) => real.setMuted(id, muted),
      listOutputs: () => {
        if (++reads === 2) m.defaultOutput = "headphones";
        return real.listOutputs();
      },
    };
    const i = await ready(m, { lid: { audio } });
    const closed = await simulateClose(i);
    expect(closed.results.find((r) => r.action === "mute")).toMatchObject({
      outcome: "failed",
      reason: "not_applied",
    });
    expect(m.log.filter((e) => e.what.startsWith("audio:"))).toEqual([]);
    expect(m.devices.map((d) => d.muted)).toEqual([false, false]);
    expect(pending(m)).not.toContain("lid.mute");
  });

  it("default-only adapter: a default switched while the lid is closed leaves the muted output muted with a PENDING entry that the next launch retries, and nothing else is touched", async () => {
    const m = new Machine();
    m.defaultOnly = true;
    m.devices = [
      { id: "builtin", muted: false },
      { id: "headphones", muted: false },
    ];
    const first = await ready(m);
    await simulateClose(first);
    expect(m.devices.map((d) => d.muted)).toEqual([true, false]);
    m.defaultOutput = "headphones";
    const opened = await simulateOpen(first);
    expect(opened.results.find((r) => r.action === "mute")).toMatchObject({
      outcome: "undo_failed",
      reason: "output_changed",
    });
    // The user is never muted silently: the entry is still there, with what undo needs.
    const entry = parseJournal(m.fs.read(JOURNAL) ?? "").pending.find((e) => e.kind === "lid.mute");
    expect(entry?.undo).toMatchObject({ default_name: "Speakers", default_prior: false });
    expect(m.log.filter((e) => e.what === "audio:headphones:false")).toEqual([]);
    expect(m.devices.map((d) => d.muted)).toEqual([true, false]);
    // The next launch retries from the journal alone: still refused while the default is another output ...
    m.procs.die(SELF_PID);
    m.table = m.table.filter((p) => p.pid !== SELF_PID);
    const second = await boot(m, { pid: 9000, lid: IDLE });
    expect(pending(m)).toContain("lid.mute");
    expect(m.devices.map((d) => d.muted)).toEqual([true, false]);
    // ... and completed once the muted output is the default again.
    m.defaultOutput = "builtin";
    await second.services().recovery.undo();
    expect(m.devices.map((d) => d.muted)).toEqual([false, false]);
    expect(pending(m)).not.toContain("lid.mute");
  });
});

describe("App Nap", () => {
  const BUNDLE = "com.example.Agent";
  const NAP = {
    lid_actions: {
      app_nap: true,
      app_nap_apps: [BUNDLE],
      display: false,
      freeze_apps: false,
      mute: false,
      low_power: false,
    },
  };

  it("prior ABSENT: written for the lid, then DELETED again on open", async () => {
    const m = new Machine();
    const i = await ready(m, { config: NAP });
    await simulateClose(i);
    expect(m.defaults.get(BUNDLE)).toBe("1");
    expect(m.commands).toContain(`/usr/bin/defaults write ${BUNDLE} NSAppSleepDisabled -bool YES`);
    await simulateOpen(i);
    expect(m.defaults.has(BUNDLE)).toBe(false);
    expect(m.commands).toContain(`/usr/bin/defaults delete ${BUNDLE} NSAppSleepDisabled`);
    expect(m.commands.filter((c) => c.includes("-bool NO"))).toEqual([]);
  });

  it("prior SET to NO: restored to NO, not deleted", async () => {
    const m = new Machine();
    m.defaults.set(BUNDLE, "0");
    const i = await ready(m, { config: NAP });
    await simulateClose(i);
    expect(m.defaults.get(BUNDLE)).toBe("1");
    await simulateOpen(i);
    expect(m.defaults.get(BUNDLE)).toBe("0");
    expect(m.commands.filter((c) => c.includes("delete"))).toEqual([]);
  });

  it("prior already YES: not Phoenix's change, so neither written nor undone", async () => {
    const m = new Machine();
    m.defaults.set(BUNDLE, "1");
    const i = await ready(m, { config: NAP });
    const closed = await simulateClose(i);
    expect(closed.results.find((r) => r.action === "app_nap")).toMatchObject({
      outcome: "skipped",
      reason: "no_targets",
    });
    expect(m.commands.filter((c) => c.startsWith("/usr/bin/defaults write"))).toEqual([]);
    await simulateOpen(i);
    expect(m.defaults.get(BUNDLE)).toBe("1");
  });

  it("the prior value is journalled BEFORE the first write, and the write targets only the validated bundle id", async () => {
    const m = new Machine();
    const i = await ready(m, {
      config: { lid_actions: { ...NAP.lid_actions, app_nap_apps: [BUNDLE, "x; rm -rf ~"] } },
    });
    m.log.length = 0;
    await simulateClose(i);
    const entry = m.log.findIndex((e) => e.what === "journal:lid.app_nap");
    const write = m.log.findIndex((e) => e.what.startsWith("run:/usr/bin/defaults write"));
    expect(entry).toBeGreaterThanOrEqual(0);
    expect(entry).toBeLessThan(write);
    expect(m.commands.some((c) => c.includes("rm -rf"))).toBe(false);
  });

  it("a tampered journal entry cannot make the undo run defaults for an invalid bundle id", async () => {
    const m = new Machine();
    const i = await ready(m, { config: NAP });
    await i.services().recovery.change(
      "lid.app_nap",
      { apps: [] },
      {
        apps: [
          { bundle: "x; rm -rf ~", prior: "absent" },
          { bundle: BUNDLE, prior: "weird" },
        ],
      },
      () => Promise.resolve(),
      null,
    );
    await i.services().recovery.undo();
    expect(m.commands.filter((c) => c.startsWith("/usr/bin/defaults"))).toEqual([]);
  });

  it("an app whose prior value cannot be read is left alone", async () => {
    const m = new Machine();
    const base = m.script;
    m.script = (file, args) =>
      file === "/usr/bin/defaults" && args[0] === "read"
        ? { code: 2, stdout: "", stderr: "boom" }
        : base(file, args);
    const i = await ready(m, { config: NAP });
    const closed = await simulateClose(i);
    expect(closed.results.find((r) => r.action === "app_nap")).toMatchObject({
      outcome: "skipped",
    });
    expect(m.commands.filter((c) => c.startsWith("/usr/bin/defaults write"))).toEqual([]);
  });
});

describe("Docker Desktop freeze", () => {
  const DOCKER = {
    lid_actions: {
      docker_freeze: true,
      display: false,
      freeze_apps: false,
      mute: false,
      low_power: false,
    },
  };

  it("is OFF by default", async () => {
    const m = new Machine();
    const i = await ready(m, { lid: { dockerIdle: () => Promise.resolve("idle") } });
    await simulateClose(i);
    expect(m.sent("SIGSTOP")).not.toContain(600);
  });

  it("freezes only Docker Desktop's own processes (not the docker CLI) when idle", async () => {
    const m = new Machine();
    const i = await ready(m, {
      config: DOCKER,
      lid: { dockerIdle: () => Promise.resolve("idle") },
    });
    await simulateClose(i);
    expect(m.sent("SIGSTOP").sort()).toEqual([600, 601]);
    await simulateOpen(i);
    expect(m.sent("SIGCONT").sort()).toEqual([600, 601]);
  });

  it("never freezes while containers run or when the state is unknown, and says so", async () => {
    for (const state of ["busy", "unknown"] as const) {
      const m = new Machine();
      const i = await ready(m, {
        config: DOCKER,
        lid: { dockerIdle: () => Promise.resolve(state) },
      });
      const closed = await simulateClose(i);
      expect(closed.results.find((r) => r.action === "docker_freeze")).toMatchObject({
        outcome: "skipped",
        reason: state === "busy" ? "docker_busy" : "docker_unknown",
      });
      expect(m.signals).toEqual([]);
    }
  });

  it("a Docker capability that throws counts as unknown; the default seam (no wiring) is unknown", async () => {
    const m = new Machine();
    const thrown = await ready(m, {
      config: DOCKER,
      lid: { dockerIdle: () => Promise.reject(new Error("socket")) },
    });
    await simulateClose(thrown);
    expect(m.signals).toEqual([]);
    const m2 = new Machine();
    const bare = await boot(m2, { config: DOCKER, lid: IDLE });
    await startSession(bare);
    await simulateClose(bare);
    expect(m2.signals).toEqual([]);
  });

  it("a container that starts between plan and apply stops the freeze", async () => {
    const m = new Machine();
    let n = 0;
    const i = await ready(m, {
      config: DOCKER,
      lid: { dockerIdle: () => Promise.resolve(++n > 1 ? "busy" : "idle") },
    });
    await simulateClose(i);
    expect(m.signals).toEqual([]);
  });

  it("Docker is not frozen when it is protected by name (a user addition)", async () => {
    const m = new Machine();
    const i = await ready(m, {
      config: { lid_actions: { ...DOCKER.lid_actions, protected_extra: ["docker"] } },
      lid: { dockerIdle: () => Promise.resolve("idle") },
    });
    await simulateClose(i);
    expect(m.signals).toEqual([]);
  });
});

describe("display", () => {
  it("dims through the brightness tool when present and restores each display's brightness", async () => {
    const m = new Machine();
    const i = await ready(m, {
      config: { lid_actions: { freeze_apps: false, mute: false, low_power: false } },
    });
    const closed = await simulateClose(i);
    expect(closed.results.find((r) => r.action === "display")?.notes).toEqual([
      "keyboard_backlight_unsupported",
    ]);
    expect(m.commands).toContain("/opt/homebrew/bin/brightness -d 0 0");
    expect(m.commands).toContain("/usr/bin/pmset displaysleepnow");
    await simulateOpen(i);
    expect(m.commands).toContain("/opt/homebrew/bin/brightness -d 0 0.6");
  });

  it("without the brightness tool only the display sleep happens, and the notice says so", async () => {
    const m = new Machine();
    m.brightness = null;
    const i = await ready(m, {
      config: { lid_actions: { freeze_apps: false, mute: false, low_power: false } },
    });
    const closed = await simulateClose(i);
    expect(closed.results.find((r) => r.action === "display")).toMatchObject({
      outcome: "applied",
      notes: ["keyboard_backlight_unsupported", "brightness_tool_missing"],
    });
    expect(m.commands.filter((c) => c.includes("brightness -d"))).toEqual([]);
    expect(m.commands).toContain("/usr/bin/pmset displaysleepnow");
    await simulateOpen(i);
    expect(pending(m)).toEqual([]);
  });

  it("a tampered tool path in the journal is never run", async () => {
    const m = new Machine();
    const i = await ready(m, {
      config: { lid_actions: { freeze_apps: false, mute: false, low_power: false } },
    });
    await i
      .services()
      .recovery.change(
        "lid.display",
        { dim: false, tool: null },
        { tool: "/tmp/evil", displays: [{ index: 0, level: 0.5 }] },
        () => Promise.resolve(),
        null,
      );
    await i.services().recovery.undo();
    expect(m.commands.filter((c) => c.includes("evil"))).toEqual([]);
  });
});

describe("events and status carry no process names", () => {
  it("applied events hold the action id, counts and table keys only", async () => {
    const m = new Machine();
    const i = await ready(m);
    await simulateClose(i);
    const all = JSON.stringify(
      i.fake.events.filter((e) => e.event_type.startsWith("awake.lid_action.")),
    );
    for (const secret of ["Slack Helper", "/Applications", "WhatsApp.app", "Terminal"])
      expect(all).not.toContain(secret);
    expect(
      i.events("awake.lid_action.applied").find((e) => e.action === "freeze_apps"),
    ).toMatchObject({ count: 4, targets: ["slack", "whatsapp", "discord"] });
  });

  it("status says what is on, what is unsupported and the protected list; it changes nothing", async () => {
    const m = new Machine();
    m.brightness = null;
    const i = await ready(m);
    m.commands.length = 0;
    const status = (await i.call("lid_actions.status")) as {
      actions: { id: string; enabled: boolean; supported?: boolean; limits?: string[] }[];
      protected: { built_in: string[]; extra: string[] };
      freeze_list: string[];
    };
    expect(status.actions.map((a) => a.id)).toEqual([
      "app_nap",
      "freeze_apps",
      "docker_freeze",
      "mute",
      "low_power",
      "display",
    ]);
    expect(status.actions.find((a) => a.id === "docker_freeze")).toEqual({
      id: "docker_freeze",
      enabled: false,
    });
    expect(status.actions.find((a) => a.id === "display")?.limits).toContain(
      "brightness_tool_missing",
    );
    expect(status.protected.built_in).toEqual(
      expect.arrayContaining(["Phoenix", "Terminal", "Visual Studio Code", "claude"]),
    );
    expect(status.freeze_list).toEqual(["slack", "whatsapp", "discord"]);
    // Only reads: `brightness -l`, `sudo -l`.
    expect(m.commands.every((c) => c.includes("brightness -l") || c.includes("sudo -n -l"))).toBe(
      true,
    );
    expect(m.signals).toEqual([]);
  });
});

function pending(machine: Machine): string[] {
  return parseJournal(machine.fs.read(JOURNAL) ?? "").pending.map((e) => e.kind);
}
