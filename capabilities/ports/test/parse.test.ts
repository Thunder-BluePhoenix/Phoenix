// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The parsers against fixtures written from the tools' documented output formats (lsof(8) field
// output, ss(8), netstat, tasklist, ps(1)). The macOS ps and lsof samples are shaped from a real
// capture; the Linux and Windows samples are from documentation, NOT a real capture.
import { describe, expect, it } from "vitest";
import {
  parseEtime,
  parseHostPort,
  parseLsofCwd,
  parseLsofListeners,
  parseLstart,
  parseNetstat,
  parsePsLine,
  parsePsTable,
  parseSs,
  parseTasklist,
  reachableOnIpv4Loopback,
} from "../src/parse";

describe("lsof field output (-F pcnL)", () => {
  it("one listener per socket name, with the owning pid and command", () => {
    const text = [
      "p615",
      "crapportd",
      "Lada",
      "f11",
      "n*:49316",
      "f12",
      "n*:49316",
      "p4242",
      "cnode",
      "Lada",
      "f19",
      "n127.0.0.1:3000",
      "f20",
      "n[::1]:3000",
      "",
    ].join("\n");
    expect(parseLsofListeners(text)).toEqual([
      { pid: 615, port: 49316, address: "*", name: "rapportd" },
      { pid: 615, port: 49316, address: "*", name: "rapportd" },
      { pid: 4242, port: 3000, address: "127.0.0.1", name: "node" },
      { pid: 4242, port: 3000, address: "::1", name: "node" },
    ]);
  });

  it("decodes \\x escapes, strips control and bidi characters from the name, and skips malformed sockets", () => {
    const text = [
      "p77",
      "cMy\\x20Server\\x0a\u202Eevil",
      "f1",
      "n*:99999",
      "f2",
      "n*:8080",
      "f3",
      "nnot-a-socket",
    ].join("\n");
    const [only, ...rest] = parseLsofListeners(text);
    expect(rest).toEqual([]);
    expect(only).toEqual({ pid: 77, port: 8080, address: "*", name: "My Serverevil" });
  });

  it("ignores sockets that come before any process line", () => {
    expect(parseLsofListeners("f1\nn*:80\n")).toEqual([]);
  });

  it("cwd output maps pid to the first working directory", () => {
    expect(
      parseLsofCwd("p10\nfcwd\nn/Users/ada/app\np11\nfcwd\nn/\np12\nfcwd\nnrelative\n"),
    ).toEqual(
      new Map([
        [10, "/Users/ada/app"],
        [11, "/"],
      ]),
    );
  });
});

describe("ss -ltnpH (documented format, not a real Linux capture)", () => {
  it("reads address, port, pid and name; skips rows with no visible owner", () => {
    const text = [
      'LISTEN 0      511        127.0.0.1:3000       0.0.0.0:*    users:(("node",pid=1234,fd=19))',
      'LISTEN 0      4096               *:5432             *:*    users:(("postgres",pid=900,fd=6),("postgres",pid=901,fd=6))',
      "LISTEN 0      128             [::]:22             [::]:*",
      'LISTEN 0      128          [::1]:8000          [::]:*    users:(("python3",pid=55,fd=3))',
      'ESTAB  0      0         10.0.0.2:5555      10.0.0.9:443  users:(("curl",pid=9,fd=3))',
    ].join("\n");
    // `ss -l` never prints an ESTAB row, so one is "not what was asked for": dropped and counted.
    expect(parseSs(text)).toEqual({
      warnings: 1,
      listeners: [
        { pid: 1234, port: 3000, address: "127.0.0.1", name: "node" },
        { pid: 900, port: 5432, address: "*", name: "postgres" },
        { pid: 901, port: 5432, address: "*", name: "postgres" },
        { pid: 55, port: 8000, address: "::1", name: "python3" },
      ],
    });
  });

  it("a process name with a line break forges no row: the broken lines are dropped and counted", () => {
    // The name of pid 7 is `a\nLISTEN 0 511 127.0.0.1:22 0.0.0.0:* users:(("sshd",pid=1,fd=3))\nb`.
    const forged = 'LISTEN 0      511    127.0.0.1:22   0.0.0.0:*   users:(("sshd",pid=1,fd=3))';
    const text = [
      'LISTEN 0      511    127.0.0.1:3000   0.0.0.0:*   users:(("node",pid=1234,fd=19))',
      'LISTEN 0      511    127.0.0.1:8080   0.0.0.0:*   users:(("a',
      forged,
      'b",pid=7,fd=3))',
    ].join("\n");
    const { listeners, warnings } = parseSs(text);
    // The forged line is itself a well-formed row, so it is the two broken halves around it that
    // prove the output is not trustworthy: they are dropped and counted, never joined or guessed.
    expect(listeners.map((l) => l.pid)).not.toContain(7);
    expect(warnings).toBe(2);
  });
});

describe("netstat -ano -p TCP and tasklist /FO CSV /NH (documented formats, not a real Windows capture)", () => {
  const netstat = [
    "",
    "Active Connections",
    "",
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1012",
    "  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       8812",
    "  TCP    [::]:445               [::]:0                 LISTENING       4",
    "  TCP    127.0.0.1:5173         127.0.0.1:50321        ESTABLISHED     8812",
    "  TCP    192.168.1.5:50000      52.1.2.3:443           ESTABLISHED     7000",
  ].join("\r\n");

  it("a listener is a row whose foreign port is 0, whatever language the state column is in", () => {
    expect(parseNetstat(netstat.replaceAll("LISTENING", "ÉCOUTE"))).toEqual([
      { pid: 1012, port: 135, address: "0.0.0.0", name: "" },
      { pid: 8812, port: 5173, address: "127.0.0.1", name: "" },
      { pid: 4, port: 445, address: "::", name: "" },
    ]);
  });

  it("tasklist maps pid to image name, with quoted names intact", () => {
    const text = [
      '"System Idle Process","0","Services","0","8 K"',
      '"node.exe","8812","Console","1","85,000 K"',
      '"My ""App"".exe","77","Console","1","1,000 K"',
      "garbage",
    ].join("\r\n");
    expect(parseTasklist(text)).toEqual(
      new Map([
        [8812, "node.exe"],
        [77, 'My "App".exe'],
      ]),
    );
  });
});

describe("ps columns", () => {
  const line =
    " 4242  4000  4000  501  12.5  204800 1-02:03:04 Mon Oct 19 09:56:56 2026 /Users/ada/.nvm/bin/node";

  it("parses a macOS-shaped row (lstart in UTC, etime with days, full path command)", () => {
    expect(parsePsLine(line)).toEqual({
      pid: 4242,
      ppid: 4000,
      pgid: 4000,
      uid: 501,
      cpu: 12.5,
      rssKb: 204800,
      etimeSeconds: 86400 + 2 * 3600 + 3 * 60 + 4,
      start: "Mon Oct 19 09:56:56 2026",
      startMs: Date.UTC(2026, 9, 19, 9, 56, 56),
      command: "/Users/ada/.nvm/bin/node",
    });
  });

  it("keeps a command with spaces whole and collapses the padded day in lstart", () => {
    const row = parsePsLine(
      "  9 1 9 501 0.0 100 00:05 Thu Oct  1 08:00:00 2026 /Applications/My App/bin/server",
    );
    expect(row?.start).toBe("Thu Oct 1 08:00:00 2026");
    expect(row?.command).toBe("/Applications/My App/bin/server");
  });

  it("drops lines that are not process rows, or have a control character in the command", () => {
    expect(parsePsLine("PID PPID PGID UID %CPU RSS ELAPSED STARTED COMMAND")).toBeUndefined();
    expect(parsePsLine("")).toBeUndefined();
    expect(parsePsLine(line.replace("node", "no\u0007de"))).toBeUndefined();
    expect(parsePsTable(`${line}\nnope\n`).rows).toHaveLength(1);
  });

  it("drops rows whose name carries format, line or paragraph separators", () => {
    for (const bad of ["no\u202Ede", "no\u200Bde", "no\u2028de", "no\u2029de"]) {
      expect(parsePsLine(line.replace("node", bad)), JSON.stringify(bad)).toBeUndefined();
    }
  });

  describe("strict table (a process name with a newline prints a second, forged row)", () => {
    const launchd = " 1  0  1  0  0.0  100  10:00 Mon Oct 19 09:56:56 2026 /sbin/launchd";
    const forgedRow = " 1  0  1  0  0.0  100  10:00 Mon Oct 19 09:56:56 2026 /Users/ada/bin/node";

    it("a name with a line break cannot overwrite another process's row: the pid is dropped, with a warning", () => {
      // The comm of pid 4242 is "evil\n<a row claiming pid 1 is a harmless dev node>".
      const text = [launchd, line.replace("node", `evil\n${forgedRow.trim()}`)].join("\n");
      const { rows, warnings } = parsePsTable(text);
      expect(rows.some((r) => r.pid === 1)).toBe(false);
      expect(rows.find((r) => r.pid === 4242)?.command).toBe("/Users/ada/.nvm/bin/evil");
      expect(warnings).toBeGreaterThanOrEqual(1);
    });

    it("a pid claimed by two rows is dropped from the table entirely, not last-wins", () => {
      const other = line.replace("/Users/ada/.nvm/bin/node", "/usr/bin/evil");
      const { rows, warnings } = parsePsTable(`${line}\n${other}\n`);
      expect(rows).toEqual([]);
      expect(warnings).toBe(1);
    });

    it("a line that does not parse completely is dropped and counted; blank lines are not", () => {
      const { rows, warnings } = parsePsTable(`${line}\n\n garbage tail\n`);
      expect(rows).toHaveLength(1);
      expect(warnings).toBe(1);
    });
  });

  it("etime and lstart reject shapes they do not know", () => {
    expect(parseEtime("12:34")).toBe(754);
    expect(parseEtime("1:02:03")).toBe(3723);
    expect(parseEtime("3-00:00:01")).toBe(259201);
    expect(parseEtime("soon")).toBeUndefined();
    expect(parseLstart("Mon Oct 19 09:56:56 2026")).toBe(Date.UTC(2026, 9, 19, 9, 56, 56));
    expect(parseLstart("Mon Foo 19 09:56:56 2026")).toBeUndefined();
  });
});

describe("addresses", () => {
  it("host:port forms from all three tools", () => {
    expect(parseHostPort("*:3000")).toEqual({ address: "*", port: 3000 });
    expect(parseHostPort("[::1]:8080")).toEqual({ address: "::1", port: 8080 });
    expect(parseHostPort("127.0.0.53%lo:53")).toEqual({ address: "127.0.0.53", port: 53 });
    expect(parseHostPort("127.0.0.1:0")).toBeUndefined();
    expect(parseHostPort("127.0.0.1:70000")).toBeUndefined();
    expect(parseHostPort("nonsense")).toBeUndefined();
  });

  it("a connection to 127.0.0.1 reaches wildcard sockets and 127.0.0.1 itself, nothing else", () => {
    for (const ok of ["*", "0.0.0.0", "::", "127.0.0.1"]) {
      expect(reachableOnIpv4Loopback(ok), ok).toBe(true);
    }
    // 127.0.0.2 is another socket: a link to 127.0.0.1 would reach some other server (or none).
    for (const no of [
      "::1",
      "192.168.1.5",
      "10.0.0.2",
      "fe80::1",
      "127.0.0.2",
      "127.1.2.3",
      "::ffff:127.0.0.2",
    ]) {
      expect(reachableOnIpv4Loopback(no), no).toBe(false);
    }
  });
});
