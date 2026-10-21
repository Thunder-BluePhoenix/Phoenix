// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The lid simulation. The real Awake capability, the real Recovery module (journal, lock,
// reconcile) and the real lid-actions module run on a FAKE machine: processes are a table, signals
// are log lines, audio and `defaults` are maps. This is a SIMULATION: no lid was ever closed and no
// process was ever frozen for real.
import { describe, expect, it } from "vitest";
import { parseJournal } from "../../src/power/format";
import { JOURNAL } from "../power/fixtures";
import {
  Machine,
  SELF_PID,
  boot,
  flush,
  outcomes,
  proc,
  simulateClose,
  simulateOpen,
  startSession,
  T1,
} from "./rig";

const ALL_ON = {
  lid_actions: { docker_freeze: true, app_nap: true, app_nap_apps: ["com.example.Agent"] },
};

function pending(machine: Machine): string[] {
  return parseJournal(machine.fs.read(JOURNAL) ?? "").pending.map((e) => e.kind);
}

describe("close, then open", () => {
  it("with a session active: exactly the enabled actions run, then everything is undone", async () => {
    const m = new Machine();
    m.table.push(proc(900, 1, "/Applications/Slack.app/Contents/MacOS/Slack Helper", T1, "T"));
    const i = await boot(m, {
      lid: { dockerIdle: () => Promise.resolve("idle"), protectedState: () => "idle" },
    });
    await startSession(i);
    // Defaults: freeze apps, mute, display, Low Power Mode. Not Docker, not App Nap.
    const closed = await simulateClose(i);
    expect(outcomes(closed)).toEqual({
      freeze_apps: "applied",
      mute: "applied",
      low_power: "applied",
      display: "applied",
    });
    expect(m.sent("SIGSTOP").sort()).toEqual([100, 101, 110, 120]);
    expect(m.devices.map((d) => d.muted)).toEqual([true, true]);
    expect(pending(m).sort()).toEqual([
      "lid.display",
      "lid.freeze",
      "lid.mute",
      "pmset.lowpowermode",
    ]);
    expect(m.defaults.size).toBe(0);

    const opened = await simulateOpen(i);
    expect(outcomes(opened)).toEqual({
      freeze_apps: "undone",
      mute: "undone",
      low_power: "undone",
      display: "undone",
    });
    expect(m.sent("SIGCONT").sort()).toEqual([100, 101, 110, 120]);
    expect(m.stopped.size).toBe(0);
    expect(m.devices.map((d) => d.muted)).toEqual([false, false]);
    expect(m.commands).toContain("/usr/bin/sudo -n /usr/bin/pmset -a lowpowermode 0");
    expect(m.commands).toContain("/opt/homebrew/bin/brightness -d 0 0.6");
    expect(pending(m)).toEqual([]);
    expect(i.services().canQuit().ok).toBe(true);
    expect(i.types()).toEqual(
      expect.arrayContaining(["awake.lid_action.applied", "awake.lid_action.undone"]),
    );
  });

  it("with everything switched on, all six actions run and are undone (App Nap exactly)", async () => {
    const m = new Machine();
    m.defaults.set("com.example.Agent", "0");
    const i = await boot(m, {
      config: ALL_ON,
      lid: { dockerIdle: () => Promise.resolve("idle"), protectedState: () => "idle" },
    });
    await startSession(i);
    const closed = await simulateClose(i);
    expect(outcomes(closed)).toEqual({
      app_nap: "applied",
      freeze_apps: "applied",
      docker_freeze: "applied",
      mute: "applied",
      low_power: "applied",
      display: "applied",
    });
    expect(m.sent("SIGSTOP").sort()).toEqual([100, 101, 110, 120, 600, 601]);
    expect(m.defaults.get("com.example.Agent")).toBe("1");
    const opened = await simulateOpen(i);
    expect(Object.values(outcomes(opened)).every((o) => o === "undone")).toBe(true);
    expect(m.defaults.get("com.example.Agent")).toBe("0");
    expect(m.stopped.size).toBe(0);
    expect(pending(m)).toEqual([]);
  });

  it("the lid observer drives it: a real close/open transition (ioreg) runs and undoes the actions", async () => {
    const m = new Machine();
    const i = await boot(m, { lid: { protectedState: () => "idle" } });
    await startSession(i);
    await i.tick(); // first reading: open
    m.lid = "Yes";
    await i.tick();
    await flush();
    expect(m.sent("SIGSTOP").length).toBeGreaterThan(0);
    expect(pending(m)).toContain("lid.freeze");
    m.lid = "No";
    await i.tick();
    await flush();
    expect(m.stopped.size).toBe(0);
    expect(pending(m)).toEqual([]);
  });

  it("closing twice for the same session does not journal or freeze twice", async () => {
    const m = new Machine();
    const i = await boot(m, { lid: { protectedState: () => "idle" } });
    await startSession(i);
    await simulateClose(i);
    const before = m.signals.length;
    await simulateClose(i);
    expect(m.signals.length).toBe(before);
    expect(pending(m).filter((k) => k === "lid.freeze")).toHaveLength(1);
  });

  it("without a session nothing happens at all", async () => {
    const m = new Machine();
    const i = await boot(m, { lid: { protectedState: () => "idle" } });
    await expect(i.call("lid_actions.simulate_close")).rejects.toMatchObject({
      kind: "no_session",
    });
    expect(m.effects()).toEqual([]);
    expect(m.fs.read(JOURNAL)).toBeUndefined();
  });
});

describe("the journal always comes first", () => {
  it("every Runner / Signaler / audio effect of a kind is preceded by that kind's journal entry", async () => {
    const m = new Machine();
    m.defaults.set("com.example.Agent", "0");
    const i = await boot(m, {
      config: ALL_ON,
      lid: { dockerIdle: () => Promise.resolve("idle"), protectedState: () => "idle" },
    });
    await startSession(i);
    m.log.length = 0;
    await simulateClose(i);
    const effects = m.log.filter((e) => !e.what.startsWith("journal:"));
    expect(effects.length).toBeGreaterThan(8);
    for (const kind of [
      "lid.app_nap",
      "lid.freeze",
      "lid.docker_freeze",
      "lid.mute",
      "pmset.lowpowermode",
      "lid.display",
    ]) {
      const first = m.log.findIndex((e) => e.kind === kind && !e.what.startsWith("journal:"));
      const entry = m.log.findIndex((e) => e.what === `journal:${kind}`);
      expect(entry, `${kind} journalled`).toBeGreaterThanOrEqual(0);
      expect(entry, `${kind}: journal before first effect`).toBeLessThan(first);
    }
  });

  it("a journal that cannot be written blocks the action: nothing is run, the failure is reported", async () => {
    const m = new Machine();
    const i = await boot(m, { lid: { protectedState: () => "idle" } });
    await startSession(i);
    m.fs.failAppend = true;
    const run = await simulateClose(i);
    expect(Object.values(outcomes(run)).every((o) => o === "failed" || o === "skipped")).toBe(true);
    expect(
      run.results
        .filter((r) => r.outcome === "failed")
        .every((r) => r.reason === "journal_unwritable"),
    ).toBe(true);
    expect(m.effects()).toEqual([]);
    expect(m.signals).toEqual([]);
    expect(m.devices.map((d) => d.muted)).toEqual([false, false]);
    expect(i.events("awake.lid_action.failed").length).toBeGreaterThan(0);
  });
});

describe("a dead instance's leftovers (backstop / reconcile equivalence)", () => {
  it("a second instance on the same journal undoes everything the first left, from the journal alone", async () => {
    const m = new Machine();
    m.defaults.set("com.example.Agent", "1"); // not ours: prior "yes" is skipped, see below
    m.defaults.delete("com.example.Agent");
    const first = await boot(m, {
      config: ALL_ON,
      lid: { dockerIdle: () => Promise.resolve("idle"), protectedState: () => "idle" },
    });
    await startSession(first);
    await simulateClose(first);
    expect(pending(m).sort()).toEqual([
      "lid.app_nap",
      "lid.display",
      "lid.docker_freeze",
      "lid.freeze",
      "lid.mute",
      "pmset.lowpowermode",
    ]);
    expect(m.stopped.size).toBe(6);
    // The first Phoenix dies: no shutdown, no undo. Its pid disappears from the process table.
    m.procs.die(SELF_PID);
    m.table = m.table.filter((p) => p.pid !== SELF_PID);
    m.signals.length = 0;

    const second = await boot(m, { pid: 9000, config: {}, lid: { protectedState: () => "idle" } });
    await flush();
    await flush();
    expect(pending(m)).toEqual([]);
    expect(m.stopped.size).toBe(0);
    expect(m.sent("SIGCONT").sort()).toEqual([100, 101, 110, 120, 600, 601]);
    expect(m.devices.map((d) => d.muted)).toEqual([false, false]);
    expect(m.defaults.has("com.example.Agent")).toBe(false); // prior absent -> deleted again
    expect(m.commands).toContain("/usr/bin/sudo -n /usr/bin/pmset -a lowpowermode 0");
    expect(second.services().canQuit().ok).toBe(true);
  });

  it("the second instance honours a recorded undo even when its own config has every action OFF", async () => {
    const m = new Machine();
    const first = await boot(m, { lid: { protectedState: () => "idle" } });
    await startSession(first);
    await simulateClose(first);
    m.procs.die(SELF_PID);
    m.table = m.table.filter((p) => p.pid !== SELF_PID);
    await boot(m, { pid: 9001, config: { lid_actions: { enabled: false } } });
    await flush();
    expect(m.stopped.size).toBe(0);
    expect(pending(m)).toEqual([]);
  });

  it("an entry whose owner is still running is NOT undone by another instance", async () => {
    const m = new Machine();
    const first = await boot(m, { lid: { protectedState: () => "idle" } });
    await startSession(first);
    await simulateClose(first);
    await boot(m, { pid: 9002 });
    await flush();
    expect(m.stopped.size).toBeGreaterThan(0);
    expect(pending(m)).toContain("lid.freeze");
  });
});

describe("ending the session, disabling, shutting down", () => {
  it("the session ending undoes the actions (and marks the session ended for the backstop)", async () => {
    const m = new Machine();
    const i = await boot(m, { lid: { protectedState: () => "idle" } });
    await startSession(i);
    await simulateClose(i);
    await i.call("end");
    await i.advance(5_000);
    await flush();
    expect(m.stopped.size).toBe(0);
    expect(pending(m)).toEqual([]);
    const journal = parseJournal(m.fs.read(JOURNAL) ?? "");
    expect(journal.endedSessions.size).toBe(1);
  });

  it("disable undoes everything", async () => {
    const m = new Machine();
    const i = await boot(m, { lid: { protectedState: () => "idle" } });
    await startSession(i);
    await simulateClose(i);
    await i.disable();
    await flush();
    expect(m.stopped.size).toBe(0);
    expect(m.devices.map((d) => d.muted)).toEqual([false, false]);
    expect(pending(m)).toEqual([]);
  });

  it("the kill switch undoes everything", async () => {
    const m = new Machine();
    const i = await boot(m, { lid: { protectedState: () => "idle" } });
    await startSession(i);
    await simulateClose(i);
    await i.feed.publish("security.kill_switch.engaged");
    await flush();
    expect(m.stopped.size).toBe(0);
    expect(pending(m)).toEqual([]);
  });
});

describe("failures are independent", () => {
  it("one failing action neither blocks the others nor the undo of the others", async () => {
    const m = new Machine();
    m.setMutedFails.add("headphones");
    const i = await boot(m, { lid: { protectedState: () => "idle" } });
    await startSession(i);
    const closed = await simulateClose(i);
    expect(outcomes(closed)).toMatchObject({
      mute: "failed",
      freeze_apps: "applied",
      display: "applied",
      low_power: "applied",
    });
    expect(m.sent("SIGSTOP").length).toBe(4);
    // The failed mute may have half happened: its entry stays so it is undone.
    m.setMutedFails.clear();
    const opened = await simulateOpen(i);
    expect(outcomes(opened)).toMatchObject({
      freeze_apps: "undone",
      display: "undone",
      low_power: "undone",
      mute: "undone",
    });
    expect(m.stopped.size).toBe(0);
    expect(m.devices.map((d) => d.muted)).toEqual([false, false]);
  });

  it("an undo that fails stays pending (and is reported) while the other undos still run", async () => {
    const m = new Machine();
    const i = await boot(m, { lid: { protectedState: () => "idle" } });
    await startSession(i);
    await simulateClose(i);
    m.signalFails.add(100);
    const opened = await simulateOpen(i);
    expect(outcomes(opened)).toMatchObject({
      freeze_apps: "undo_failed",
      mute: "undone",
      display: "undone",
      low_power: "undone",
    });
    expect(pending(m)).toEqual(["lid.freeze"]);
    expect(i.services().canQuit().ok).toBe(false);
    expect(i.events("awake.lid_action.failed").some((e) => e.phase === "undo")).toBe(true);
    // Tried again later (reconcile / undo_now): works once the signal can be sent.
    m.signalFails.clear();
    await i.services().recovery.undo();
    expect(pending(m)).toEqual([]);
    expect(m.stopped.size).toBe(0);
  });

  it("a process table that cannot be read freezes nothing and says why", async () => {
    const m = new Machine();
    const i = await boot(m, {
      lid: {
        protectedState: () => "idle",
        processes: () => Promise.reject(new Error("ps failed")),
      },
    });
    await startSession(i);
    const closed = await simulateClose(i);
    expect(closed.results.find((r) => r.action === "freeze_apps")).toMatchObject({
      outcome: "skipped",
      reason: "process_list_unavailable",
    });
    expect(m.signals).toEqual([]);
  });
});

describe("nothing runs when disabled or unsupported", () => {
  it("every action off: zero effects, zero journal, zero signals", async () => {
    const m = new Machine();
    const i = await boot(m, {
      config: {
        lid_actions: { display: false, freeze_apps: false, mute: false, low_power: false },
      },
    });
    await startSession(i);
    m.commands.length = 0;
    const closed = await simulateClose(i);
    expect(closed.results).toEqual([]);
    expect(m.commands).toEqual([]);
    expect(m.signals).toEqual([]);
    expect(m.fs.read(JOURNAL)).toBeUndefined();
  });

  it("the master switch off beats every per-action switch", async () => {
    const m = new Machine();
    const i = await boot(m, { config: { lid_actions: { enabled: false, docker_freeze: true } } });
    await startSession(i);
    m.commands.length = 0;
    expect((await simulateClose(i)).results).toEqual([]);
    expect(m.commands).toEqual([]);
  });

  it("an empty freeze list or empty App Nap list leaves those actions off", async () => {
    const m = new Machine();
    const i = await boot(m, {
      config: {
        lid_actions: {
          display: false,
          mute: false,
          low_power: false,
          freeze_apps_list: [],
          app_nap: true,
        },
      },
    });
    await startSession(i);
    m.commands.length = 0;
    expect((await simulateClose(i)).results).toEqual([]);
    expect(m.commands).toEqual([]);
  });

  it("on Linux every action is unsupported: no signal, no command, no journal", async () => {
    const m = new Machine();
    const i = await boot(m, { platform: "linux", lid: { protectedState: () => "idle" } });
    await startSession(i);
    m.commands.length = 0;
    const closed = await simulateClose(i);
    expect(
      closed.results.every((r) => r.outcome === "skipped" && r.reason === "unsupported_platform"),
    ).toBe(true);
    expect(m.commands.filter((c) => !c.includes("ioreg"))).toEqual([]);
    expect(m.signals).toEqual([]);
    expect(m.fs.read(JOURNAL)).toBeUndefined();
  });

  it("Low Power Mode without the helper is skipped with a visible notice", async () => {
    const m = new Machine();
    m.helperInstalled = false;
    const i = await boot(m, { lid: { protectedState: () => "idle" } });
    await startSession(i);
    const closed = await simulateClose(i);
    expect(closed.results.find((r) => r.action === "low_power")).toMatchObject({
      outcome: "skipped",
      reason: "helper_unavailable",
    });
    expect(i.events("awake.lid_action.failed")).toContainEqual(
      expect.objectContaining({ action: "low_power", reason: "helper_unavailable" }),
    );
    expect(pending(m)).not.toContain("pmset.lowpowermode");
    expect(outcomes(closed).freeze_apps).toBe("applied");
  });

  it("Low Power Mode already journalled by the battery floor is not journalled twice", async () => {
    const m = new Machine();
    const i = await boot(m, { lid: { protectedState: () => "idle" } });
    await startSession(i);
    await i
      .services()
      .recovery.change(
        "pmset.lowpowermode",
        { argv: ["/usr/bin/pmset", "-a", "lowpowermode", "1"] },
        { argv: ["/usr/bin/pmset", "-a", "lowpowermode", "0"] },
        () => Promise.resolve(),
        i.deps().session.active()?.id ?? null,
      );
    const closed = await simulateClose(i);
    expect(closed.results.find((r) => r.action === "low_power")).toMatchObject({
      outcome: "skipped",
      reason: "already_on",
    });
    await simulateOpen(i);
    // The floor's entry is not ours: opening the lid leaves it for the floor logic.
    expect(pending(m)).toEqual(["pmset.lowpowermode"]);
  });
});

describe("simulation commands are a test seam", () => {
  it("are absent unless allowSimulation is true", async () => {
    const { createLidActionsModule } = await import("../../src/lid-actions");
    const off = createLidActionsModule();
    expect(Object.keys(off.commands)).toEqual(["lid_actions.status"]);
    expect(off.commandSpecs.map((s) => s.name)).toEqual(["lid_actions.status"]);
    const on = createLidActionsModule({ allowSimulation: true });
    expect(Object.keys(on.commands).sort()).toEqual([
      "lid_actions.simulate_close",
      "lid_actions.simulate_open",
      "lid_actions.status",
    ]);
  });

  it("the production capability exposes no simulation command", async () => {
    const { createAwakeCapability } = await import("../../src");
    const names = createAwakeCapability().manifest.commands.map((c) => c.name);
    expect(names).toContain("lid_actions.status");
    expect(names).not.toContain("lid_actions.simulate_close");
    expect(names).not.toContain("lid_actions.simulate_open");
  });
});
