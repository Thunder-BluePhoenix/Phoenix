// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The Claude Code statusLine wrapper (Phase 58 usage relay) installed by the Phase 57 installer:
// the user's command survives install, uninstall and repair exactly, and the command Phoenix
// writes really runs the previous command through the real statusline.ts.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HookInstaller } from "../src/relay/installer";
import { posixUnquote } from "../src/relay/statusline-hook";
import { rig, type Rig } from "./relay-rig";

const ID = "claude-code";
const ODD = [
  "echo 'it'\\''s' \"$HOME/my dir\" | tr a-z A-Z",
  "~/bin/status line --flag=\"a b\" ü€✓ \\ trailing  ",
  "printf '%s' \"$(date)\" # comment ' \"",
  "'",
  "a'b'c",
];

const seed = (statusLine: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ theme: "dark", ...extra, statusLine }, null, 2) + "\n";
const installed = (r: Rig) => r.installer.apply("install", ID, r.installer.preview("install", ID).hash);
const statusLine = (r: Rig) => (JSON.parse(readFileSync(r.path, "utf8")) as { statusLine?: Record<string, unknown> }).statusLine;

describe("statusLine wrapper", () => {
  it.each(ODD)("wraps %j with --then and uninstall restores the file byte for byte", (command) => {
    const original = seed({ type: "command", command, padding: 2 });
    const r = rig(ID, original);
    const preview = r.installer.preview("install", ID);
    expect(preview.diff).toContain("statusline.ts");
    r.installer.apply("install", ID, preview.hash);
    const line = statusLine(r)!;
    expect(line.padding).toBe(2);
    expect(line.type).toBe("command");
    expect(String(line.command)).toContain(" --then ");
    expect(posixUnquote(String(line.command).split(" --then ")[1]!)).toBe(command);
    r.installer.apply("uninstall", ID, r.installer.preview("uninstall", ID).hash);
    expect(readFileSync(r.path, "utf8")).toBe(original);
  });

  it("with no previous statusLine adds a Phoenix-only one, and uninstall removes it again", () => {
    const original = JSON.stringify({ theme: "dark" }, null, 2) + "\n";
    const r = rig(ID, original);
    installed(r);
    expect(String(statusLine(r)!.command)).toMatch(/statusline\.ts'$/);
    expect(String(statusLine(r)!.command)).not.toContain("--then");
    r.installer.apply("uninstall", ID, r.installer.preview("uninstall", ID).hash);
    expect(readFileSync(r.path, "utf8")).toBe(original);
  });

  it("is idempotent and never nests: a second install, and repair, leave one wrapper", () => {
    const r = rig(ID, seed({ type: "command", command: "my status" }));
    installed(r);
    const once = readFileSync(r.path, "utf8");
    expect(r.installer.preview("install", ID).changed).toBe(false);
    writeFileSync(r.path, once.replace('"theme": "dark"', '"theme": "dark", "x": 1'));
    r.installer.apply("repair", ID, r.installer.preview("repair", ID).hash);
    const command = String(statusLine(r)!.command);
    expect(command.match(/statusline\.ts/g)).toHaveLength(1);
    expect(posixUnquote(command.split(" --then ")[1]!)).toBe("my status");
  });

  it("uninstall after the user edited the statusLine back keeps their later edit and unwraps ours", () => {
    const r = rig(ID, seed({ type: "command", command: "mine" }));
    installed(r);
    const doc = JSON.parse(readFileSync(r.path, "utf8")) as Record<string, unknown>;
    doc.theme = "light";
    writeFileSync(r.path, JSON.stringify(doc, null, 2) + "\n");
    r.installer.apply("uninstall", ID, r.installer.preview("uninstall", ID).hash);
    expect(JSON.parse(readFileSync(r.path, "utf8"))).toMatchObject({ theme: "light", statusLine: { command: "mine" } });
  });

  it("health notices a removed or replaced statusLine and repair re-wraps the new one", () => {
    const r = rig(ID, seed({ type: "command", command: "mine" }));
    installed(r);
    expect(r.installer.list().find((a) => a.id === ID)!.state).toBe("installed");

    const doc = JSON.parse(readFileSync(r.path, "utf8")) as Record<string, unknown>;
    delete doc.statusLine;
    writeFileSync(r.path, JSON.stringify(doc, null, 2) + "\n");
    expect(r.installer.list().find((a) => a.id === ID)).toMatchObject({ state: "needs_repair", missing: ["statusLine"] });

    doc.statusLine = { type: "command", command: "their new one" };
    writeFileSync(r.path, JSON.stringify(doc, null, 2) + "\n");
    expect(r.installer.list().find((a) => a.id === ID)!.missing).toEqual(["statusLine"]);
    r.installer.apply("repair", ID, r.installer.preview("repair", ID).hash);
    expect(posixUnquote(String(statusLine(r)!.command).split(" --then ")[1]!)).toBe("their new one");
    expect(r.installer.list().find((a) => a.id === ID)!.state).toBe("installed");
  });

  it("leaves a statusLine it cannot wrap alone (not a command, or no command string)", () => {
    for (const odd of [{ type: "other", command: "x" }, { type: "command" }, "string"]) {
      const original = seed(odd);
      const r = rig(ID, original);
      installed(r);
      expect(statusLine(r)).toEqual(odd);
      r.installer.apply("uninstall", ID, r.installer.preview("uninstall", ID).hash);
      expect(readFileSync(r.path, "utf8")).toBe(original);
    }
  });

  it("does not wrap on Windows (shell quoting there is unverified)", () => {
    const original = seed({ type: "command", command: "mine" });
    const r = rig(ID, original);
    const win = new HookInstaller({
      home: r.home, env: { PATH: "" }, platform: "win32", backupDir: r.backupDir, commands: { root: "C:\\phoenix" },
    });
    win.apply("install", ID, win.preview("install", ID).hash);
    expect(statusLine(r)).toEqual({ type: "command", command: "mine" });
  });
});

describe("the written command really runs (real statusline.ts, real shell)", () => {
  it.each(ODD.slice(0, 2).concat(["printf 'ü€✓ %s' \"$(cat | wc -c | tr -d ' ')\""]))(
    "prints the previous command's stdout byte for byte: %j",
    async (previous) => {
      const dir = mkdtempSync(join(tmpdir(), "phx-sl-"));
      try {
        const home = join(dir, "home");
        mkdirSync(join(home, ".claude"), { recursive: true });
        writeFileSync(join(home, ".claude", "settings.json"), seed({ type: "command", command: previous }));
        // no `commands` option: the command points at this checkout's real statusline.ts
        const inst = new HookInstaller({ home, env: { PATH: "" }, backupDir: join(dir, "b") });
        inst.apply("install", ID, inst.preview("install", ID).hash);
        const command = String((JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8")) as { statusLine: { command: string } }).statusLine.command);

        const stdin = JSON.stringify({ model: { display_name: "x" } });
        const run = (cmd: string) => {
          const child = spawn("/bin/sh", ["-c", cmd], { env: { ...process.env, PHOENIX_RELAY_SOCKET: join(dir, "none.sock"), PHOENIX_CORE_URL: "http://127.0.0.1:1", PHOENIX_SESSION_TOKEN: "x", HOME: home } });
          const out: Buffer[] = [];
          child.stdout.on("data", (c: Buffer) => out.push(c));
          child.stdin.end(stdin);
          return new Promise<{ code: number | null; out: Buffer }>((resolve) => child.on("close", (code) => resolve({ code, out: Buffer.concat(out) })));
        };
        const direct = await run(previous);
        const wrapped = await run(command);
        expect(wrapped.code).toBe(direct.code);
        expect(wrapped.out.toString("hex")).toBe(direct.out.toString("hex"));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
