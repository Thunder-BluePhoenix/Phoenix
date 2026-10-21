// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Crash recovery with fakes: a "second instance" is a new manager on the same fake disk and process
// table as a first one that was dropped without undoing anything.
import { describe, expect, it } from "vitest";
import { encodeLine, parseJournal } from "../../src/power/format";
import { JournalWriteError, NotAppliedError } from "../../src/power/journal";
import { FakeProcesses, JOURNAL, LOCK, MemFs, OFF, ON, instance } from "./fixtures";

const DISABLE = "pmset.disablesleep";

async function journalled(fs: MemFs, procs: FakeProcesses, session: string | null = "awk_1") {
  const a = instance(fs, procs);
  const applied: string[] = [];
  await a.manager.change(
    DISABLE,
    ON,
    OFF,
    () => {
      applied.push("disablesleep 1");
      return Promise.resolve();
    },
    session,
  );
  return { a, applied };
}

describe("journal before change", () => {
  it("has the entry on disk BEFORE the change is made", async () => {
    const fs = new MemFs();
    const a = instance(fs, new FakeProcesses(100));
    let seen = "";
    await a.manager.change(
      DISABLE,
      ON,
      OFF,
      () => {
        seen = fs.read(JOURNAL) ?? "";
        return Promise.resolve();
      },
      "awk_1",
    );
    const during = parseJournal(seen);
    expect(during.pending.map((e) => e.kind)).toEqual([DISABLE]);
    expect(during.pending[0]?.applied).toBe(false);
    expect(parseJournal(fs.read(JOURNAL) ?? "").pending[0]?.applied).toBe(true);
  });

  it("does NOT make the change when the journal cannot be written", async () => {
    const fs = new MemFs();
    fs.failAppend = true;
    const a = instance(fs, new FakeProcesses(100));
    let applied = false;
    const result = await a.manager
      .change(
        DISABLE,
        ON,
        OFF,
        () => {
          applied = true;
          return Promise.resolve();
        },
        "awk_1",
      )
      .catch((e: unknown) => e);
    expect(result).toBeInstanceOf(JournalWriteError);
    expect(applied).toBe(false);
    expect(a.manager.canQuit().ok).toBe(true);
  });

  it("records the owner, the session and both the apply and undo data", async () => {
    const fs = new MemFs();
    await journalled(fs, new FakeProcesses(100), "awk_9");
    const entry = parseJournal(fs.read(JOURNAL) ?? "").pending[0];
    expect(entry).toMatchObject({
      kind: DISABLE,
      apply: ON,
      undo: OFF,
      session: "awk_9",
      owner: { pid: 100 },
    });
  });

  it("closes the entry when the change provably did not happen, and keeps it when it may have", async () => {
    const fs = new MemFs();
    const a = instance(fs, new FakeProcesses(100));
    await a.manager
      .change(DISABLE, ON, OFF, () => Promise.reject(new NotAppliedError("sudo said no")), "s")
      .catch(() => undefined);
    expect(parseJournal(fs.read(JOURNAL) ?? "").pending).toEqual([]);
    expect(a.manager.canQuit().ok).toBe(true);
    await a.manager
      .change(DISABLE, ON, OFF, () => Promise.reject(new Error("timed out")), "s")
      .catch(() => undefined);
    expect(parseJournal(fs.read(JOURNAL) ?? "").pending).toHaveLength(1);
    expect(a.manager.canQuit().ok).toBe(false);
  });
});

describe("reconcile at launch (crash recovery)", () => {
  it("a second instance undoes what a dead first instance left", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    const { applied } = await journalled(fs, procs);
    expect(applied).toEqual(["disablesleep 1"]);
    // Instance A "dies": no undo, its process is gone.
    procs.die(100);
    const b = instance(fs, procs.as(200));
    const report = await b.manager.reconcile();
    expect(b.undoCalls).toEqual([OFF]);
    expect(report.undone.map((u) => u.kind)).toEqual([DISABLE]);
    expect(parseJournal(fs.read(JOURNAL) ?? "").pending).toEqual([]);
    expect(b.manager.canQuit().ok).toBe(true);
  });

  it("leaves a still-running other instance's change alone, and does not block quitting for it", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    await journalled(fs, procs);
    const b = instance(fs, procs.as(200));
    const report = await b.manager.reconcile();
    expect(report.heldByOther).toBe(1);
    expect(b.undoCalls).toEqual([]);
    expect(b.manager.canQuit().ok).toBe(true);
  });

  it("does not mistake a reused pid for the owner (start time differs)", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    await journalled(fs, procs);
    procs.table.set(100, "a-different-start"); // pid 100 now belongs to an unrelated process
    const b = instance(fs, procs.as(200));
    await b.manager.reconcile();
    expect(b.undoCalls).toEqual([OFF]);
  });

  it("undoes in reverse order of the changes", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    const order: string[] = [];
    const reverters = {
      "x.one": () => (order.push("one"), Promise.resolve()),
      "x.two": () => (order.push("two"), Promise.resolve()),
      "x.three": () => (order.push("three"), Promise.resolve()),
    };
    const a = instance(fs, procs, { reverters });
    for (const kind of ["x.one", "x.two", "x.three"])
      await a.manager.change(kind, {}, {}, () => Promise.resolve(), null);
    await a.manager.undo();
    expect(order).toEqual(["three", "two", "one"]);
  });
});

describe("undo", () => {
  it("is idempotent: a second call finds nothing and runs nothing", async () => {
    const fs = new MemFs();
    const { a } = await journalled(fs, new FakeProcesses(100));
    await a.manager.undo();
    await a.manager.undo();
    expect(a.undoCalls).toEqual([OFF]);
  });

  it("continues past a failing undo, reports it loudly and retries it next time", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    const ran: string[] = [];
    let fail = true;
    const reverters = {
      "x.bad": () =>
        fail ? Promise.reject(new Error("device busy")) : (ran.push("bad"), Promise.resolve()),
      "x.good": () => (ran.push("good"), Promise.resolve()),
    };
    const a = instance(fs, procs, { reverters });
    await a.manager.change("x.good", {}, {}, () => Promise.resolve(), null);
    await a.manager.change("x.bad", {}, {}, () => Promise.resolve(), null);
    const first = await a.manager.undo();
    expect(first.failed.map((f) => f.kind)).toEqual(["x.bad"]);
    expect(first.undone.map((f) => f.kind)).toEqual(["x.good"]);
    const warning = a.events.find((e) => e.type === "awake.recovery.pending");
    expect(warning).toMatchObject({ severity: "warning", payload: { count: 1, kinds: ["x.bad"] } });
    expect(a.manager.canQuit()).toMatchObject({ ok: false, pending: [{ kind: "x.bad" }] });
    fail = false;
    const second = await a.manager.undo();
    expect(second.undone.map((f) => f.kind)).toEqual(["x.bad"]);
    expect(ran).toEqual(["good", "bad"]);
    expect(a.manager.canQuit().ok).toBe(true);
  });

  it("reports an entry with no way to undo it instead of dropping it", async () => {
    const fs = new MemFs();
    const a = instance(fs, new FakeProcesses(100), { reverters: {} });
    await a.manager.change("mystery.kind", {}, {}, () => Promise.resolve(), null);
    const report = await a.manager.undo();
    expect(report.failed[0]?.error).toContain("no way to undo");
    expect(a.manager.canQuit().ok).toBe(false);
  });

  it("an entry that never confirmed and whose undo was refused (no helper) is closed, not stuck", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    const reverters = { [DISABLE]: () => Promise.reject(new NotAppliedError("no helper")) };
    const a = instance(fs, procs, { reverters });
    // Crash between journal and apply: no `applied` line.
    fs.files.set(
      JOURNAL,
      encodeLine({
        t: "change",
        id: "c1",
        kind: DISABLE,
        apply: ON,
        undo: OFF,
        at: 1,
        session: "s",
        owner: procs.self,
      }),
    );
    const report = await a.manager.undo();
    expect(report.failed).toEqual([]);
    expect(parseJournal(fs.read(JOURNAL) ?? "").pending).toEqual([]);
  });

  it("but an entry that WAS applied stays pending when its undo is refused", async () => {
    const fs = new MemFs();
    const reverters = { [DISABLE]: () => Promise.reject(new NotAppliedError("no helper")) };
    const a = instance(fs, new FakeProcesses(100), { reverters });
    await a.manager.change(DISABLE, ON, OFF, () => Promise.resolve(), "s");
    const report = await a.manager.undo();
    expect(report.failed).toHaveLength(1);
    expect(a.manager.canQuit().ok).toBe(false);
  });
});

describe("a damaged journal", () => {
  it("tolerates a torn last line and still undoes the complete entries before it", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    await journalled(fs, procs);
    fs.files.set(JOURNAL, (fs.read(JOURNAL) ?? "") + '{"v":1,"sum":"abc","rec":{"t":"cha');
    expect(parseJournal(fs.read(JOURNAL) ?? "")).toMatchObject({ partialTail: true, untrusted: 0 });
    procs.die(100);
    const b = instance(fs, procs.as(200));
    const report = await b.manager.reconcile();
    expect(b.undoCalls).toEqual([OFF]);
    expect(report.partialTail).toBe(true);
  });

  it("reports a checksum mismatch and never acts on it", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    // A forged entry: well-formed, but its checksum is wrong (an attacker edited the undo data).
    const forged = encodeLine({
      t: "change",
      id: "evil",
      kind: DISABLE,
      apply: ON,
      undo: { argv: ["/bin/sh", "-c", "reboot"] },
      at: 1,
      session: "s",
      owner: { pid: 4242, started: "x" },
    }).replace("reboot", "reboot ");
    fs.files.set(JOURNAL, forged);
    const b = instance(fs, procs);
    const report = await b.manager.reconcile();
    expect(report.untrusted).toBe(1);
    expect(report.undone).toEqual([]);
    expect(b.undoCalls).toEqual([]);
    const event = b.events.find((e) => e.type === "awake.recovery.reconciled");
    expect(event).toMatchObject({ severity: "warning", payload: { untrusted: 1 } });
  });

  it("counts garbage lines as untrusted, keeps good ones", () => {
    const good = encodeLine({
      t: "change",
      id: "c1",
      kind: DISABLE,
      apply: ON,
      undo: OFF,
      at: 1,
      session: null,
      owner: { pid: 1, started: "" },
    });
    const parsed = parseJournal(`not json\n${good}{"v":2}\n[]\n`);
    expect(parsed.untrusted).toBe(3);
    expect(parsed.pending).toHaveLength(1);
  });

  it("rejects a change with a bad kind, owner or session", () => {
    const base = {
      t: "change" as const,
      id: "c1",
      apply: ON,
      undo: OFF,
      at: 1,
      session: null,
      owner: { pid: 1, started: "" },
    };
    const lines = [
      encodeLine({ ...base, kind: "Bad Kind" }),
      encodeLine({ ...base, kind: DISABLE, owner: { pid: 0, started: "" } }),
      encodeLine({ ...base, kind: DISABLE, id: "x".repeat(200) }),
    ];
    expect(parseJournal(lines.join("")).untrusted).toBe(3);
  });
});

describe("recovery lock", () => {
  it("a live holder keeps a second instance out: it does nothing", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    await journalled(fs, procs);
    procs.die(100);
    procs.table.set(300, "start-300");
    fs.files.set(LOCK, JSON.stringify({ pid: 300, started: "start-300", at: 1_000_000 }));
    const b = instance(fs, procs.as(200));
    const report = await b.manager.reconcile();
    expect(report.locked).toBe(true);
    expect(b.undoCalls).toEqual([]);
    expect(fs.files.has(LOCK)).toBe(true);
    // The change is still unresolved, so quitting is still refused.
    expect(b.manager.canQuit().ok).toBe(false);
  });

  it("takes over a lock whose holder is dead", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    await journalled(fs, procs);
    procs.die(100);
    fs.files.set(LOCK, JSON.stringify({ pid: 300, started: "start-300", at: 1_000_000 }));
    const b = instance(fs, procs.as(200));
    const report = await b.manager.reconcile();
    expect(report.locked).toBe(false);
    expect(b.undoCalls).toEqual([OFF]);
    expect(fs.files.has(LOCK)).toBe(false);
  });

  it("takes over a lock whose pid was reused by a different process", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    await journalled(fs, procs);
    procs.die(100);
    procs.table.set(300, "a-newer-process");
    fs.files.set(LOCK, JSON.stringify({ pid: 300, started: "start-300", at: 1_000_000 }));
    const b = instance(fs, procs.as(200));
    expect((await b.manager.reconcile()).locked).toBe(false);
  });

  it("takes over a lock older than the stale limit even if its holder looks alive", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    await journalled(fs, procs);
    procs.die(100);
    procs.table.set(300, "start-300");
    fs.files.set(
      LOCK,
      JSON.stringify({ pid: 300, started: "start-300", at: 1_000_000 - 11 * 60_000 }),
    );
    const b = instance(fs, procs.as(200));
    expect((await b.manager.reconcile()).locked).toBe(false);
  });

  it("takes over an unreadable lock file, and releases its own lock afterwards", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    await journalled(fs, procs);
    procs.die(100);
    fs.files.set(LOCK, "{{{ not json");
    const b = instance(fs, procs.as(200));
    await b.manager.reconcile();
    expect(b.undoCalls).toEqual([OFF]);
    expect(fs.files.has(LOCK)).toBe(false);
  });

  it("does not take the lock at all when there is nothing to undo", async () => {
    const fs = new MemFs();
    const b = instance(fs, new FakeProcesses(200));
    await b.manager.reconcile();
    expect(fs.files.has(LOCK)).toBe(false);
    expect(fs.dirs).toEqual([]);
  });
});

describe("quit refusal", () => {
  it("refuses while a change is applied and allows once it is undone", async () => {
    const fs = new MemFs();
    const { a } = await journalled(fs, new FakeProcesses(100));
    const refused = a.manager.canQuit();
    expect(refused.ok).toBe(false);
    expect(refused.pending).toEqual([{ id: "chg_100_1", kind: DISABLE, at: 1_000_000 }]);
    await a.manager.undo();
    expect(a.manager.canQuit()).toEqual({ ok: true, pending: [] });
  });

  it("refuses from the moment the journal write succeeded, even before the change finished", async () => {
    const fs = new MemFs();
    const a = instance(fs, new FakeProcesses(100));
    let during = true;
    await a.manager.change(
      DISABLE,
      ON,
      OFF,
      () => {
        during = a.manager.canQuit().ok;
        return Promise.resolve();
      },
      "s",
    );
    expect(during).toBe(false);
  });
});

describe("size bound", () => {
  it("compacts closed entries away and keeps pending ones", async () => {
    const fs = new MemFs();
    const a = instance(fs, new FakeProcesses(100), { maxBytes: 3000 });
    await a.manager.change(DISABLE, ON, OFF, () => Promise.resolve(), "s");
    for (let i = 0; i < 30; i++) {
      await a.manager.change("pmset.disablesleep", ON, OFF, () => Promise.resolve(), "t");
      await a.manager.undo((e) => e.session === "t");
    }
    expect((fs.read(JOURNAL) ?? "").length).toBeLessThan(3500);
    const pending = parseJournal(fs.read(JOURNAL) ?? "").pending;
    expect(pending.map((e) => e.session)).toEqual(["s"]);
  });

  it("refuses new changes (fail closed) when pending entries alone fill the journal", async () => {
    const fs = new MemFs();
    const a = instance(fs, new FakeProcesses(100), { maxBytes: 700 });
    let made = 0;
    const attempt = () =>
      a.manager
        .change(DISABLE, ON, OFF, () => (made++, Promise.resolve()), "s")
        .catch((e: unknown) => e);
    const results = [await attempt(), await attempt(), await attempt(), await attempt()];
    expect(results.some((r) => r instanceof JournalWriteError)).toBe(true);
    expect(made).toBe(results.filter((r) => typeof r === "string").length);
  });
});
