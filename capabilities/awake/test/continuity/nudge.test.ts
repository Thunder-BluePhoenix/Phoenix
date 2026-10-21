// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  PANE_ID,
  SessionTarget,
  TMUX_PATHS,
  TmuxPaneTarget,
  parseContinuityConfig,
  parsePaneLine,
  type AgentSessionInput,
} from "../../src/continuity";
import type { RunResult } from "../../src/system";
import { FakeSystem } from "../../testing/fakes";
import { continuityRig, type ContinuityRig, type RigOptions } from "./rig";

const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });

/** A fake tmux: panes by id → current command; ids in `inMode` report `pane_in_mode` = 1. */
function tmux(panes: Record<string, string>, inMode: readonly string[] = []): RigOptions["script"] {
  return (file, args) => {
    if (file !== "/opt/homebrew/bin/tmux") return undefined;
    if (args[0] === "display-message") {
      const id = args[3] ?? "";
      const command = Object.hasOwn(panes, id) ? panes[id] : undefined;
      return command === undefined
        ? { code: 1, stdout: "", stderr: "can't find pane" }
        : ok(`${id} ${inMode.includes(id) ? 1 : 0} ${command}\n`);
    }
    return ok();
  };
}

const config = (nudge: Record<string, unknown>) => ({
  continuity: {
    network_watch: { enabled: true, hosts: ["example.test"] },
    nudge: { enabled: true, panes: ["%3"], allowed_commands: ["claude"], ...nudge },
  },
});

const tmuxRuns = (r: ContinuityRig) =>
  r.sys.runs.filter((x) => x.file === "/opt/homebrew/bin/tmux").map((x) => x.args);

/** Goes down at tick 3, then lets `afterMs` of outage pass. */
async function outage(r: ContinuityRig, extraTicks = 8): Promise<void> {
  r.net.up = false;
  await r.tick(3 + extraTicks);
}

describe("pane id validation", () => {
  it("accepts tmux pane ids and nothing else", () => {
    for (const good of ["%0", "%3", "%12", "%999999"]) expect(PANE_ID.test(good)).toBe(true);
    const bad = [
      "%1; rm",
      "$(x)",
      "%1 ",
      " %1",
      "%",
      "",
      "%1234567",
      "%-1",
      "%1\n",
      "1",
      "%a",
      "%1;ls",
      "`x`",
    ];
    for (const value of bad) expect(PANE_ID.test(value)).toBe(false);
  });

  it("drops invalid panes from config and counts them", () => {
    const c = parseContinuityConfig({
      nudge: { enabled: true, panes: ["%1", "%1; rm", "$(x)", "", 5, "%2"] },
    });
    expect(c.nudge.panes).toEqual(["%1", "%2"]);
    expect(c.dropped).toBe(4);
  });

  it("a target built with a bad id never reaches tmux", async () => {
    const sys = new FakeSystem();
    for (const bad of ["%1; rm", "$(x)", "a b", ""]) {
      const t = new TmuxPaneTarget(bad, sys.env.run, new Set(["claude"]), () => true);
      expect(await t.deliver(true)).toBe("invalid_target");
    }
    expect(sys.runs).toEqual([]);
  });

  it("parses the display-message answer strictly", () => {
    expect(parsePaneLine("%3 0 claude\n")).toEqual({
      paneId: "%3",
      inMode: false,
      command: "claude",
    });
    expect(parsePaneLine("%3 1 claude\n")).toEqual({
      paneId: "%3",
      inMode: true,
      command: "claude",
    });
    expect(parsePaneLine("%3 0 my tool\n")).toEqual({
      paneId: "%3",
      inMode: false,
      command: "my tool",
    });
    for (const bad of [
      "%3\n",
      "%3 claude\n",
      "x 0 claude",
      "%3 2 claude",
      "%3 0 ",
      "%3  claude",
      "",
    ])
      expect(parsePaneLine(bad)).toBeNull();
  });
});

describe("tmux nudge", () => {
  it("after 90 s of outage verifies the pane, then types `continue` literally and does NOT press Enter", async () => {
    const r = await continuityRig({
      config: config({}),
      script: tmux({ "%3": "claude" }),
      withSession: false,
    });
    await outage(r);
    expect(tmuxRuns(r)).toEqual([
      ["display-message", "-p", "-t", "%3", "#{pane_id} #{pane_in_mode} #{pane_current_command}"],
      ["send-keys", "-t", "%3", "-l", "continue"],
    ]);
    r.shutdown();
  });

  it("sends nothing before the delay has passed", async () => {
    const r = await continuityRig({
      config: config({}),
      script: tmux({ "%3": "claude" }),
      withSession: false,
    });
    r.net.up = false;
    await r.tick(3); // down is declared at ~45 s; first failure was at 15 s
    await r.tick(3);
    expect(tmuxRuns(r)).toEqual([]);
    await r.tick(2);
    expect(tmuxRuns(r)).toHaveLength(2);
    r.shutdown();
  });

  it("presses Enter as a SEPARATE send-keys only when the user enabled it", async () => {
    const r = await continuityRig({
      config: config({ enter: true }),
      script: tmux({ "%3": "claude" }),
      withSession: false,
    });
    await outage(r);
    expect(tmuxRuns(r).slice(1)).toEqual([
      ["send-keys", "-t", "%3", "-l", "continue"],
      ["send-keys", "-t", "%3", "Enter"],
    ]);
    r.shutdown();
  });

  it("refuses every pane when the allow-list is empty (the default)", async () => {
    const r = await continuityRig({
      config: config({ allowed_commands: [] }),
      script: tmux({ "%3": "claude" }),
      withSession: false,
    });
    await outage(r);
    expect(tmuxRuns(r)).toEqual([]);
    expect(r.events.find((e) => e.event_type === "awake.nudge.result")?.payload).toMatchObject({
      outcome: "command_not_allowed",
    });
    r.shutdown();
  });

  it("refuses a pane whose current command is not on the allow-list (a shell prompt)", async () => {
    const r = await continuityRig({
      config: config({}),
      script: tmux({ "%3": "zsh" }),
      withSession: false,
    });
    await outage(r);
    expect(tmuxRuns(r).filter((a) => a[0] === "send-keys")).toEqual([]);
    expect(r.events.find((e) => e.event_type === "awake.nudge.result")?.payload).toMatchObject({
      outcome: "command_not_allowed",
    });
    r.shutdown();
  });

  it("refuses a pane in copy/view mode (keys would drive the mode) and types nothing", async () => {
    const r = await continuityRig({
      config: config({ enter: true }),
      script: tmux({ "%3": "claude" }, ["%3"]),
      withSession: false,
    });
    await outage(r);
    expect(tmuxRuns(r)).toEqual([
      ["display-message", "-p", "-t", "%3", "#{pane_id} #{pane_in_mode} #{pane_current_command}"],
    ]);
    expect(r.events.find((e) => e.event_type === "awake.nudge.result")?.payload).toEqual({
      target: "%3",
      kind: "tmux",
      outcome: "pane_in_mode",
    });
    r.shutdown();
  });

  it("skips a pane that no longer exists", async () => {
    const r = await continuityRig({ config: config({}), script: tmux({}), withSession: false });
    await outage(r);
    expect(tmuxRuns(r).filter((a) => a[0] === "send-keys")).toEqual([]);
    expect(r.events.find((e) => e.event_type === "awake.nudge.result")?.payload).toMatchObject({
      outcome: "gone",
    });
    r.shutdown();
  });

  it("refuses when tmux answers about a different pane than the one asked for", async () => {
    const r = await continuityRig({
      config: config({}),
      script: (file, args) =>
        file === "/opt/homebrew/bin/tmux" && args[0] === "display-message"
          ? ok("%9 0 claude\n")
          : ok(),
      withSession: false,
    });
    await outage(r);
    expect(tmuxRuns(r).filter((a) => a[0] === "send-keys")).toEqual([]);
    r.shutdown();
  });

  it("nudges each pane at most once per outage, even if the outage goes on for hours", async () => {
    const r = await continuityRig({
      config: config({ panes: ["%3", "%4"] }),
      script: tmux({ "%3": "claude", "%4": "claude" }),
      withSession: false,
    });
    await outage(r, 400);
    const sends = tmuxRuns(r).filter((a) => a[0] === "send-keys");
    expect(sends).toEqual([
      ["send-keys", "-t", "%3", "-l", "continue"],
      ["send-keys", "-t", "%4", "-l", "continue"],
    ]);
    r.shutdown();
  });

  it("a pause for a meeting between two panes resumes with the second pane only, never re-typing the first", async () => {
    const r = await continuityRig({
      config: config({ panes: ["%3", "%4"] }),
      script: (file, args) => {
        if (file === "/opt/homebrew/bin/tmux" && args[0] === "display-message")
          return ok(`${args[3]} 0 claude\n`);
        // The meeting starts while the first pane is being typed into.
        if (file === "/opt/homebrew/bin/tmux" && args[0] === "send-keys" && args[2] === "%3")
          void r.feed.publish("dictation.listening", {});
        return ok();
      },
      withSession: false,
    });
    await outage(r);
    expect(tmuxRuns(r).filter((a) => a[0] === "send-keys")).toEqual([
      ["send-keys", "-t", "%3", "-l", "continue"],
    ]);
    await r.feed.publish("dictation.idle", {});
    await r.tick(3);
    expect(tmuxRuns(r).filter((a) => a[0] === "send-keys")).toEqual([
      ["send-keys", "-t", "%3", "-l", "continue"],
      ["send-keys", "-t", "%4", "-l", "continue"],
    ]);
    r.shutdown();
  });

  it("a second outage nudges again, once", async () => {
    const r = await continuityRig({
      config: config({}),
      script: tmux({ "%3": "claude" }),
      withSession: false,
    });
    await outage(r);
    r.net.up = true;
    await r.tick(2);
    await outage(r, 300);
    expect(tmuxRuns(r).filter((a) => a[0] === "send-keys")).toHaveLength(2);
    r.shutdown();
  });

  it("does not nudge when the network comes back before the delay", async () => {
    const r = await continuityRig({
      config: config({}),
      script: tmux({ "%3": "claude" }),
      withSession: false,
    });
    r.net.up = false;
    await r.tick(4);
    r.net.up = true;
    await r.tick(10);
    expect(tmuxRuns(r)).toEqual([]);
    r.shutdown();
  });

  it("never types during a meeting or dictation, and nudges once it is over", async () => {
    const r = await continuityRig({
      config: config({}),
      script: tmux({ "%3": "claude" }),
      withSession: false,
    });
    await r.feed.publish("kage.meeting.recording", {});
    await outage(r);
    expect(tmuxRuns(r)).toEqual([]);
    await r.feed.publish("kage.capture.finished", {});
    await r.tick(3);
    expect(tmuxRuns(r).filter((a) => a[0] === "send-keys")).toHaveLength(1);
    r.shutdown();
  });

  it("dictation blocks too, and without an event feed it fails closed", async () => {
    const dictating = await continuityRig({
      config: config({}),
      script: tmux({ "%3": "claude" }),
      withSession: false,
    });
    await dictating.feed.publish("dictation.listening", {});
    await outage(dictating);
    expect(tmuxRuns(dictating)).toEqual([]);
    const blind = await continuityRig({
      config: config({}),
      script: tmux({ "%3": "claude" }),
      withSession: false,
      noFeed: true,
    });
    await outage(blind);
    expect(tmuxRuns(blind)).toEqual([]);
    dictating.shutdown();
    blind.shutdown();
  });

  it("enforces the 30 s minimum delay and defaults to 90 s", () => {
    expect(parseContinuityConfig({ nudge: { after_seconds: 5 } }).nudge.afterSeconds).toBe(90);
    expect(parseContinuityConfig({ nudge: { after_seconds: 30 } }).nudge.afterSeconds).toBe(30);
    expect(parseContinuityConfig({ nudge: {} }).nudge.afterSeconds).toBe(90);
  });

  it("audits the pane id and outcome only, never the text, command or output", async () => {
    const r = await continuityRig({
      config: config({}),
      script: tmux({ "%3": "claude" }),
      withSession: false,
    });
    await outage(r);
    const audit = r.events.find((e) => e.event_type === "awake.nudge.result");
    expect(audit?.payload).toEqual({ target: "%3", kind: "tmux", outcome: "sent" });
    expect(JSON.stringify(audit)).not.toContain("continue");
    r.shutdown();
  });

  it("does nothing when nudging is switched off, even with panes listed", async () => {
    const r = await continuityRig({
      config: config({ enabled: false }),
      script: tmux({ "%3": "claude" }),
      withSession: false,
    });
    await outage(r, 50);
    expect(tmuxRuns(r)).toEqual([]);
    r.shutdown();
  });
});

describe("tmux resolution", () => {
  async function deliverWith(exists: (path: string) => boolean, enter = true) {
    const sys = new FakeSystem();
    sys.script = (_file, args) => (args[0] === "display-message" ? ok("%3 0 claude\n") : ok());
    const target = new TmuxPaneTarget("%3", sys.env.run, new Set(["claude"]), exists);
    const outcome = await target.deliver(enter);
    return { sys, outcome };
  }

  it("lists the fixed absolute locations in order", () => {
    expect(TMUX_PATHS).toEqual(["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"]);
  });

  it("runs every tmux call by the absolute path, with exact argv", async () => {
    for (const path of TMUX_PATHS) {
      const { sys, outcome } = await deliverWith((p) => p === path);
      expect(outcome).toBe("sent");
      expect(sys.runs.map((x) => [x.file, ...x.args])).toEqual([
        [
          path,
          "display-message",
          "-p",
          "-t",
          "%3",
          "#{pane_id} #{pane_in_mode} #{pane_current_command}",
        ],
        [path, "send-keys", "-t", "%3", "-l", "continue"],
        [path, "send-keys", "-t", "%3", "Enter"],
      ]);
    }
  });

  it("the first existing path wins", async () => {
    const { sys } = await deliverWith((p) => p !== TMUX_PATHS[0]);
    expect(new Set(sys.runs.map((x) => x.file))).toEqual(new Set(["/usr/local/bin/tmux"]));
    const both = await deliverWith(() => true);
    expect(new Set(both.sys.runs.map((x) => x.file))).toEqual(new Set([TMUX_PATHS[0]]));
  });

  it("no tmux at any fixed path is 'unavailable' and nothing is run (a PATH-only tmux is never used)", async () => {
    const checked: string[] = [];
    const { sys, outcome } = await deliverWith((p) => {
      checked.push(p);
      return false;
    });
    expect(outcome).toBe("unavailable");
    expect(sys.runs).toEqual([]);
    expect(checked).toEqual([...TMUX_PATHS]);
  });

  it("is resolved at deliver time, so tmux appearing later is picked up", async () => {
    let present = false;
    const sys = new FakeSystem();
    sys.script = (_file, args) => (args[0] === "display-message" ? ok("%3 0 claude\n") : ok());
    const target = new TmuxPaneTarget("%3", sys.env.run, new Set(["claude"]), () => present);
    expect(await target.deliver(false)).toBe("unavailable");
    present = true;
    expect(await target.deliver(false)).toBe("sent");
  });

  it("through the module: no tmux means an 'unavailable' report and no run", async () => {
    const r = await continuityRig({
      config: config({}),
      withSession: false,
      options: { fileExists: () => false },
    });
    await outage(r);
    expect(r.sys.runs).toEqual([]);
    expect(r.events.find((e) => e.event_type === "awake.nudge.result")?.payload).toEqual({
      target: "%3",
      kind: "tmux",
      outcome: "unavailable",
    });
    r.shutdown();
  });
});

describe("tracked agent sessions", () => {
  const sid = "ph-0123456789abcdef";

  it("delivers through the injected session seam, honouring Enter-off", async () => {
    const sent: [string, string, boolean][] = [];
    const input: AgentSessionInput = {
      send: (id, text, enter) => {
        sent.push([id, text, enter]);
        return Promise.resolve(true);
      },
    };
    const r = await continuityRig({
      config: config({ panes: [], sessions: [sid, "ph-bad; rm"] }),
      withSession: false,
      options: { sessionInput: input },
    });
    await outage(r);
    expect(sent).toEqual([[sid, "continue", false]]);
    expect(r.sys.runs).toEqual([]);
    r.shutdown();
  });

  it("reports 'unavailable' when no delivery mechanism is wired (the documented gap)", async () => {
    expect(await new SessionTarget(sid, undefined).deliver(false)).toBe("unavailable");
    expect(
      await new SessionTarget("nope", { send: () => Promise.resolve(true) }).deliver(false),
    ).toBe("invalid_target");
    const thrower = new SessionTarget(sid, { send: () => Promise.reject(new Error("x")) });
    expect(await thrower.deliver(false)).toBe("failed");
  });
});
