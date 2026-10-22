// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A pretend machine for the port radar: a process table and a set of listeners that the fake
// Runner prints in the formats lsof, ps, ss, netstat and tasklist document. Nothing here reads the
// real machine or signals a real process.
import type {
  PortsEnv,
  Platform,
  RunOptions,
  RunResult,
  SignalOutcome,
  StopSignal,
} from "../src/types";

export const T0 = Date.parse("2026-10-20T12:00:00Z");
export const HOME = "/Users/ada";
export const CORE_PID = 4000;
export const CORE_PPID = 3900;
export const CORE_PGID = 3900;
export const UID = 501;

export interface FakeProc {
  pid: number;
  ppid: number;
  pgid: number;
  uid: number;
  cpu: number;
  rssKb: number;
  /** Seconds the process has run at T0. */
  ageSeconds: number;
  command: string;
  cwd?: string;
  /** Survives SIGTERM (but not SIGKILL). */
  ignoresTerm?: boolean;
}

export interface FakeListener {
  pid: number;
  port: number;
  address: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** `lstart` as `ps` prints it with TZ=UTC LC_ALL=C. */
export function lstart(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, " ")} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${d.getUTCFullYear()}`;
}

export function etime(seconds: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}-${pad(h)}:${pad(m)}:${pad(s)}`;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

export const proc = (over: Partial<FakeProc> & Pick<FakeProc, "pid" | "command">): FakeProc => ({
  ppid: 1,
  pgid: over.pid,
  uid: UID,
  cpu: 0.1,
  rssKb: 50_000,
  ageSeconds: 600,
  ...over,
});

export interface Call {
  file: string;
  args: readonly string[];
}

export class FakeMachine {
  platform: Platform = "darwin";
  now = T0;
  procs: FakeProc[] = [];
  listeners: FakeListener[] = [];
  /** Paths that "exist" (for the .git walk). */
  paths = new Set<string>();
  runs: Call[] = [];
  signals: { pid: number; signal: StopSignal }[] = [];
  /** Sleeps asked for, in order. Time advances by the requested amount. */
  sleeps: number[] = [];
  failCommands = new Set<string>();
  signalOutcome: SignalOutcome | undefined;
  signalThrows = false;
  /** Called after every signal, to mutate the machine. */
  onSignal: ((pid: number, signal: StopSignal) => void) | undefined;
  /** Dump format for tool listing; "ss" makes lsof fail so the Linux fallback is used. */
  lsofFails = false;
  /** Replaces the whole-table `ps` output (to plant a forged or broken row). */
  rawPs: string | undefined;
  /** Replaces the `ps -p <pid>` output. */
  rawPsOne: ((pid: number) => string) | undefined;
  /** Replaces the `ss` output. */
  rawSs: string | undefined;
  /** Pids asked for with `ps -p`, in order. */
  psOneCalls: number[] = [];

  constructor() {
    this.procs.push(
      proc({ pid: 1, ppid: 0, pgid: 1, uid: 0, command: "/sbin/launchd" }),
      proc({
        pid: CORE_PPID,
        ppid: 1,
        pgid: CORE_PGID,
        command: "/Applications/Phoenix.app/Contents/MacOS/phoenix",
      }),
      proc({
        pid: CORE_PID,
        ppid: CORE_PPID,
        pgid: CORE_PGID,
        command: `${HOME}/.phoenix/bin/phoenix-core`,
      }),
    );
  }

  add(p: FakeProc, listen?: { port: number; address?: string }): FakeProc {
    this.procs.push(p);
    if (listen)
      this.listeners.push({ pid: p.pid, port: listen.port, address: listen.address ?? "*" });
    return p;
  }

  remove(pid: number): void {
    this.procs = this.procs.filter((p) => p.pid !== pid);
    this.listeners = this.listeners.filter((l) => l.pid !== pid);
  }

  get(pid: number): FakeProc {
    const found = this.procs.find((p) => p.pid === pid);
    if (!found) throw new Error(`no fake process ${pid}`);
    return found;
  }

  startOf(p: FakeProc): string {
    return lstart(T0 - p.ageSeconds * 1000);
  }

  private psText(procs: readonly FakeProc[] = this.procs): string {
    return procs
      .map(
        (p) =>
          `${String(p.pid).padStart(5)} ${String(p.ppid).padStart(5)} ${String(p.pgid).padStart(5)} ${String(p.uid).padStart(4)} ${p.cpu.toFixed(1).padStart(5)} ${String(p.rssKb).padStart(7)} ${etime(p.ageSeconds).padStart(11)} ${lstart(T0 - p.ageSeconds * 1000)} ${p.command}`,
      )
      .join("\n");
  }

  private lsofListenText(): string {
    const byPid = new Map<number, FakeListener[]>();
    for (const l of this.listeners) byPid.set(l.pid, [...(byPid.get(l.pid) ?? []), l]);
    let out = "";
    for (const [pid, ls] of byPid) {
      const p = this.procs.find((x) => x.pid === pid);
      const name = p ? (p.command.split("/").pop() ?? "") : "unknown";
      out += `p${pid}\nc${name}\nL${p?.uid === UID ? "ada" : "root"}\n`;
      ls.forEach((l, i) => {
        out += `f${10 + i}\nn${l.address.includes(":") && l.address !== "*" ? `[${l.address}]` : l.address}:${l.port}\n`;
      });
    }
    return out;
  }

  private lsofCwdText(args: readonly string[]): string {
    const wanted = new Set((args[args.indexOf("-p") + 1] ?? "").split(",").map((v) => Number(v)));
    return this.procs
      .filter((p) => wanted.has(p.pid) && p.cwd !== undefined)
      .map((p) => `p${p.pid}\nfcwd\nn${p.cwd}\n`)
      .join("");
  }

  private ssText(): string {
    if (this.rawSs !== undefined) return this.rawSs;
    return this.listeners
      .map((l) => {
        const p = this.procs.find((x) => x.pid === l.pid);
        const name = p ? (p.command.split("/").pop() ?? "") : "";
        const local =
          l.address === "*" ? "*" : l.address.includes(":") ? `[${l.address}]` : l.address;
        return `LISTEN 0      511    ${local}:${l.port}      0.0.0.0:*    users:(("${name}",pid=${l.pid},fd=19))`;
      })
      .join("\n");
  }

  private netstatText(): string {
    const head =
      "Active Connections\n\n  Proto  Local Address          Foreign Address        State           PID\n";
    return (
      head +
      this.listeners
        .map((l) => {
          const local =
            l.address === "*" ? "0.0.0.0" : l.address.includes(":") ? `[${l.address}]` : l.address;
          return `  TCP    ${local}:${l.port}           0.0.0.0:0              LISTENING       ${l.pid}`;
        })
        .join("\n")
    );
  }

  private tasklistText(): string {
    return this.procs
      .map((p) => `"${p.command.split(/[\\/]/).pop()}","${p.pid}","Console","1","10,000 K"`)
      .join("\n");
  }

  run = (file: string, args: readonly string[], _opts?: RunOptions): Promise<RunResult> => {
    this.runs.push({ file, args });
    const ok = (stdout: string): Promise<RunResult> =>
      Promise.resolve({ code: 0, stdout, stderr: "" });
    const fail = (): Promise<RunResult> =>
      Promise.resolve({ code: null, stdout: "", stderr: "exec_failed" });
    if (this.failCommands.has(file)) return fail();
    if (file === "/usr/bin/env") {
      const dash = args.indexOf("-p");
      if (dash < 0) return ok(this.rawPs ?? this.psText());
      // `ps -o ... -p <pid>`: that pid only; nothing printed and exit 1 when it does not exist.
      const pid = Number(args[dash + 1]);
      this.psOneCalls.push(pid);
      if (this.rawPsOne) return ok(this.rawPsOne(pid));
      const mine = this.procs.filter((p) => p.pid === pid);
      if (mine.length === 0) return Promise.resolve({ code: 1, stdout: "", stderr: "" });
      return ok(this.psText(mine));
    }
    if (file.endsWith("lsof")) {
      if (this.lsofFails) return fail();
      return ok(args.includes("cwd") ? this.lsofCwdText(args) : this.lsofListenText());
    }
    if (file.endsWith("/ss")) return ok(this.ssText());
    if (file.endsWith("netstat.exe")) return ok(this.netstatText());
    if (file.endsWith("tasklist.exe")) return ok(this.tasklistText());
    return fail();
  };

  env(over: Partial<PortsEnv> = {}): PortsEnv {
    return {
      platform: this.platform,
      uid: UID,
      pid: CORE_PID,
      ppid: CORE_PPID,
      home: HOME,
      vars: { SystemRoot: "C:\\Windows" },
      run: this.run,
      kill: (pid, signal) => {
        if (this.signalThrows) throw new Error("boom");
        this.signals.push({ pid, signal });
        if (this.signalOutcome) return this.signalOutcome;
        const p = this.procs.find((x) => x.pid === pid);
        if (!p) return "gone";
        this.onSignal?.(pid, signal);
        if (signal === "SIGKILL" || p.ignoresTerm !== true) this.remove(pid);
        return "sent";
      },
      fs: { exists: (path) => Promise.resolve(this.paths.has(path)) },
      now: () => this.now,
      sleep: (ms) => {
        this.sleeps.push(ms);
        this.now += ms;
        return Promise.resolve();
      },
      ...over,
    };
  }
}
