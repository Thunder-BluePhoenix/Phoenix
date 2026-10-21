// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  isProtected,
  parseProtectedExtra,
  protectedReason,
  type ProtectedContext,
} from "../../src/lid-actions/protected";
import type { ProcInfo } from "../../src/lid-actions/types";
import { SELF_PID, proc } from "./rig";

function ctx(table: ProcInfo[], extra: string[] = [], agents: number[] = []): ProtectedContext {
  return {
    selfPid: SELF_PID,
    agentPids: new Set(agents),
    table: new Map(table.map((p) => [p.pid, p])),
    extra: new Set(extra),
  };
}

const SLACK = "/Applications/Slack.app/Contents/MacOS/Slack";

describe("isProtected: a table of who may never be frozen", () => {
  const launchd = proc(1, 0, "/sbin/launchd");
  const rows: {
    name: string;
    table: ProcInfo[];
    pid: number;
    extra?: string[];
    agents?: number[];
    why: string | null;
  }[] = [
    { name: "an ordinary chat app", table: [launchd, proc(10, 1, SLACK)], pid: 10, why: null },
    {
      name: "Phoenix's own pid, even with a chat-app path",
      table: [launchd, proc(SELF_PID, 1, SLACK)],
      pid: SELF_PID,
      why: "self",
    },
    {
      name: "a child of Phoenix",
      table: [launchd, proc(SELF_PID, 1, "/x/phoenix"), proc(10, SELF_PID, SLACK)],
      pid: 10,
      why: "self_tree",
    },
    {
      name: "a process Phoenix was launched from",
      table: [launchd, proc(7, 1, "/Applications/Launcher"), proc(SELF_PID, 7, "/x/phoenix")],
      pid: 7,
      why: "self_tree",
    },
    {
      name: "Terminal",
      table: [
        launchd,
        proc(10, 1, "/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal"),
      ],
      pid: 10,
      why: "built_in",
    },
    {
      name: "iTerm2",
      table: [launchd, proc(10, 1, "/Applications/iTerm.app/Contents/MacOS/iTerm2")],
      pid: 10,
      why: "built_in",
    },
    {
      name: "Ghostty",
      table: [launchd, proc(10, 1, "/Applications/Ghostty.app/Contents/MacOS/ghostty")],
      pid: 10,
      why: "built_in",
    },
    {
      name: "Alacritty, WezTerm, kitty, Warp",
      table: [launchd, proc(10, 1, "/Applications/WezTerm.app/Contents/MacOS/wezterm-gui")],
      pid: 10,
      why: "built_in",
    },
    {
      name: "VS Code (its Electron helper)",
      table: [
        launchd,
        proc(
          10,
          1,
          "/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper",
        ),
      ],
      pid: 10,
      why: "built_in",
    },
    {
      name: "Cursor",
      table: [launchd, proc(10, 1, "/Applications/Cursor.app/Contents/MacOS/Cursor")],
      pid: 10,
      why: "built_in",
    },
    {
      name: "Zed",
      table: [launchd, proc(10, 1, "/Applications/Zed.app/Contents/MacOS/zed")],
      pid: 10,
      why: "built_in",
    },
    {
      name: "a JetBrains IDE",
      table: [launchd, proc(10, 1, "/Applications/IntelliJ IDEA CE.app/Contents/MacOS/idea")],
      pid: 10,
      why: "built_in",
    },
    {
      name: "Xcode",
      table: [launchd, proc(10, 1, "/Applications/Xcode.app/Contents/MacOS/Xcode")],
      pid: 10,
      why: "built_in",
    },
    {
      name: "Sublime Text",
      table: [launchd, proc(10, 1, "/Applications/Sublime Text.app/Contents/MacOS/sublime_text")],
      pid: 10,
      why: "built_in",
    },
    {
      name: "Neovim",
      table: [launchd, proc(10, 1, "/opt/homebrew/bin/nvim")],
      pid: 10,
      why: "built_in",
    },
    {
      name: "a coding agent Phoenix tracks (pid), whatever its name",
      table: [launchd, proc(10, 1, "/usr/local/bin/node")],
      pid: 10,
      agents: [10],
      why: "agent",
    },
    {
      name: "a child of a tracked agent",
      table: [launchd, proc(10, 1, "/usr/local/bin/node"), proc(11, 10, SLACK)],
      pid: 11,
      agents: [10],
      why: "agent",
    },
    {
      name: "claude by name",
      table: [launchd, proc(10, 1, "/Users/u/.local/bin/claude")],
      pid: 10,
      why: "built_in",
    },
    {
      name: "codex, aider, gemini by name",
      table: [launchd, proc(10, 1, "/opt/homebrew/bin/aider")],
      pid: 10,
      why: "built_in",
    },
    {
      name: "a meeting app (Zoom)",
      table: [launchd, proc(10, 1, "/Applications/zoom.us.app/Contents/MacOS/zoom.us")],
      pid: 10,
      why: "built_in",
    },
    {
      name: "a chat app started from a terminal",
      table: [
        launchd,
        proc(5, 1, "/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal"),
        proc(10, 5, SLACK),
      ],
      pid: 10,
      why: "built_in",
    },
    {
      name: "something the user added",
      table: [launchd, proc(10, 1, "/Applications/My Tool.app/Contents/MacOS/mytool")],
      pid: 10,
      extra: ["my tool"],
      why: "user_added",
    },
    {
      name: "a name that only CONTAINS a protected word",
      table: [launchd, proc(10, 1, "/Applications/Slack.app/Contents/MacOS/cursor-notes")],
      pid: 10,
      why: null,
    },
  ];
  for (const row of rows) {
    it(row.name, () => {
      const target = row.table.find((p) => p.pid === row.pid);
      if (!target) throw new Error("bad row");
      const c = ctx(row.table, row.extra, row.agents);
      expect(protectedReason(target, c)).toBe(row.why);
      expect(isProtected(target, c)).toBe(row.why !== null);
    });
  }

  it("a process in a parent loop does not hang the check", () => {
    const table = [proc(10, 11, SLACK), proc(11, 10, "/x/y")];
    expect(isProtected(table[0] as ProcInfo, ctx(table))).toBe(false);
  });
});

describe("user additions can only add", () => {
  it("keeps valid names lower-cased and de-duplicated and drops the rest, counting them", () => {
    const parsed = parseProtectedExtra([
      "My Tool",
      "my tool",
      "x; rm -rf /",
      "../etc",
      "",
      5,
      "ok-name",
    ]);
    expect(parsed.names).toEqual(["my tool", "ok-name"]);
    expect(parsed.dropped).toBe(4);
  });

  it("an extra list never makes a built-in unprotected (there is no way to remove)", () => {
    const table = [
      proc(1, 0, "/sbin/launchd"),
      proc(10, 1, "/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal"),
    ];
    expect(isProtected(table[1] as ProcInfo, ctx(table, []))).toBe(true);
    expect(isProtected(table[1] as ProcInfo, ctx(table, ["something else"]))).toBe(true);
  });
});
