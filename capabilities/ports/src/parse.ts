// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Pure parsers for the output of the OS tools the radar reads. Every function takes text and
// returns data; none touches the machine. Output is untrusted: process names come from whoever
// started the process, so they are decoded, stripped of control and format characters and clipped
// before anything else sees them.
//
// The formats are from the tools' documentation (lsof(8) "OUTPUT FOR OTHER PROGRAMS", ss(8),
// netstat and tasklist docs, ps(1)), not from a real capture on Linux or Windows.
import type { ProcRow, RawListener } from "./types";

export const MAX_NAME_CHARS = 120;
export const MAX_COMMAND_CHARS = 1024;
export const MAX_LISTENERS = 2000;

/** Control, format (bidi, zero-width) and line characters out; the rest clipped. */
export function cleanText(raw: string, max = MAX_NAME_CHARS): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .trim()
    .slice(0, max);
}

/** lsof prints unprintable bytes in names as `\xHH` (and spaces as `\x20`). */
function unescapeLsof(raw: string): string {
  return raw.replace(/\\x([0-9a-fA-F]{2})/g, (_m, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

export interface HostPort {
  address: string;
  port: number;
}

/**
 * `*:3000`, `127.0.0.1:3000`, `[::1]:3000`, `0.0.0.0:80`, `[::]:22`, `127.0.0.53%lo:53`,
 * `::1.3000`-style is NOT accepted (a format none of the three tools prints with -n/-P).
 */
export function parseHostPort(text: string): HostPort | undefined {
  const at = text.lastIndexOf(":");
  if (at <= 0) return undefined;
  const portText = text.slice(at + 1);
  if (!/^\d{1,5}$/.test(portText)) return undefined;
  const port = Number(portText);
  if (port < 1 || port > 65535) return undefined;
  let address = text.slice(0, at);
  if (address.startsWith("[") && address.endsWith("]")) address = address.slice(1, -1);
  const zone = address.indexOf("%");
  if (zone >= 0) address = address.slice(0, zone);
  if (address === "" || !/^[0-9A-Za-z.:*]+$/.test(address)) return undefined;
  return { address, port };
}

/**
 * True when `http://127.0.0.1:<port>/` reaches a socket bound to `address`: a wildcard or exactly
 * `127.0.0.1`. Another 127.x address (`127.0.0.2`) is a different socket that a connection to
 * `127.0.0.1` does not reach, and a socket bound to `::1` only is not reachable that way either, so
 * no link is offered for them. `::` is taken as dual-stack, the default on macOS and Linux (an
 * assumption: a socket with IPV6_V6ONLY would get a link that does not connect, which is harmless).
 */
export function reachableOnIpv4Loopback(address: string): boolean {
  return address === "*" || address === "0.0.0.0" || address === "::" || address === "127.0.0.1";
}

/** True when `address` is bound to loopback only (nothing else on the network can connect). */
export function loopbackOnly(address: string): boolean {
  if (address === "::1") return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address)) return true;
  return /^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/i.test(address);
}

/** True when `address` accepts connections on every interface. */
export function isWildcard(address: string): boolean {
  return address === "*" || address === "0.0.0.0" || address === "::";
}

/**
 * `lsof -nP -iTCP -sTCP:LISTEN -F pcnL`: one `p<pid>` line starts a process set (then `c`, `L`),
 * `f<fd>` starts a file set, `n<name>` names the socket. Field lines of other letters and sockets
 * with an unreadable name are skipped.
 */
export function parseLsofListeners(text: string): RawListener[] {
  const out: RawListener[] = [];
  let pid = 0;
  let name = "";
  for (const line of text.split("\n")) {
    if (line.length < 2) continue;
    const tag = line[0];
    const value = line.slice(1).replace(/\r$/, "");
    if (tag === "p") {
      const n = Number(value);
      pid = /^\d+$/.test(value) && Number.isSafeInteger(n) ? n : 0;
      name = "";
    } else if (tag === "c") {
      name = cleanText(unescapeLsof(value));
    } else if (tag === "n" && pid > 0) {
      // "*:3000", or "127.0.0.1:3000 (LISTEN)" if a tool version appends the state.
      const hp = parseHostPort(value.replace(/\s*\(LISTEN\)\s*$/, ""));
      if (hp) out.push({ pid, port: hp.port, address: hp.address, name });
    }
    if (out.length >= MAX_LISTENERS) break;
  }
  return out;
}

/** `lsof -a -d cwd -Fpn`: `p<pid>`, `fcwd`, `n<path>`. Returns pid -> working directory. */
export function parseLsofCwd(text: string): Map<number, string> {
  const out = new Map<number, string>();
  let pid = 0;
  for (const line of text.split("\n")) {
    if (line.length < 2) continue;
    const tag = line[0];
    const value = line.slice(1).replace(/\r$/, "");
    if (tag === "p") {
      const n = Number(value);
      pid = /^\d+$/.test(value) && Number.isSafeInteger(n) ? n : 0;
    } else if (tag === "n" && pid > 0 && value.startsWith("/") && !out.has(pid)) {
      out.set(pid, unescapeLsof(value));
    }
  }
  return out;
}

const SS_OWNER = String.raw`\("(?:[^"\\]|\\.)*",pid=\d+,fd=\d+\)`;
const SS_OWNER_FIELDS = /\("((?:[^"\\]|\\.)*)",pid=(\d+),fd=\d+\)/g;
/** The whole line or nothing: a socket row whose name smuggled in a line break does not match. */
const SS_LINE = new RegExp(
  String.raw`^LISTEN\s+\d+\s+\d+\s+(\S+)\s+\S+(?:\s+users:\((${SS_OWNER}(?:,${SS_OWNER})*)\))?$`,
);

export interface SsParse {
  listeners: RawListener[];
  /** Lines that did not parse completely and were dropped. */
  warnings: number;
}

/**
 * `ss -ltnpH`: `LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=1234,fd=19))`.
 * Sockets whose owner is hidden (another user's, without root) have no `users:` and are skipped.
 * Strict: a line that does not match completely (a process name with a line break splits one row
 * into two) is DROPPED and counted in `warnings`; nothing is guessed from half a line.
 */
export function parseSs(text: string): SsParse {
  const listeners: RawListener[] = [];
  let warnings = 0;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "") continue;
    const m = SS_LINE.exec(line.trim());
    const local = m ? parseHostPort(m[1] ?? "") : undefined;
    if (!m || !local) {
      warnings++;
      continue;
    }
    for (const owner of (m[2] ?? "").matchAll(SS_OWNER_FIELDS)) {
      const pid = Number(owner[2]);
      if (!Number.isSafeInteger(pid) || pid < 1) continue;
      listeners.push({
        pid,
        port: local.port,
        address: local.address,
        name: cleanText((owner[1] ?? "").replace(/\\(.)/g, "$1")),
      });
    }
    if (listeners.length >= MAX_LISTENERS) break;
  }
  return { listeners, warnings };
}

/**
 * `netstat -ano -p TCP`. A listener is a TCP row whose foreign address has port 0 (the state
 * column is localized, so "LISTENING" is not matched). Names are filled in from tasklist later.
 */
export function parseNetstat(text: string): RawListener[] {
  const out: RawListener[] = [];
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 5 || fields[0]?.toUpperCase() !== "TCP") continue;
    const local = parseHostPort(fields[1] ?? "");
    const foreignText = fields[2] ?? "";
    const foreignPort = foreignText.slice(foreignText.lastIndexOf(":") + 1);
    const pidText = fields.at(-1) ?? "";
    if (!local || foreignPort !== "0" || !/^\d+$/.test(pidText)) continue;
    const pid = Number(pidText);
    if (!Number.isSafeInteger(pid) || pid < 1) continue;
    out.push({ pid, port: local.port, address: local.address, name: "" });
    if (out.length >= MAX_LISTENERS) break;
  }
  return out;
}

/** `tasklist /FO CSV /NH`: `"Image Name","PID","Session Name","Session#","Mem Usage"`. pid -> image. */
export function parseTasklist(text: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of text.split("\n")) {
    const m = /^"((?:[^"]|"")*)","(\d+)"/.exec(line.trim());
    if (!m) continue;
    const pid = Number(m[2]);
    if (Number.isSafeInteger(pid) && pid > 0)
      out.set(pid, cleanText((m[1] ?? "").replace(/""/g, '"')));
  }
  return out;
}

/** `etime`: `[[dd-]hh:]mm:ss` to seconds; undefined for anything else. */
export function parseEtime(text: string): number | undefined {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d{2})$/.exec(text);
  if (!m) return undefined;
  const [days, hours, minutes, seconds] = [m[1], m[2], m[3], m[4]].map((v) => Number(v ?? 0));
  return (days ?? 0) * 86_400 + (hours ?? 0) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0);
}

const MONTHS: Readonly<Record<string, number>> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

const LSTART = "[A-Z][a-z]{2} [A-Z][a-z]{2}\\s+\\d{1,2} \\d{2}:\\d{2}:\\d{2} \\d{4}";
export const LSTART_PATTERN = new RegExp(`^${LSTART}$`);

/** `lstart` printed with TZ=UTC (`Tue Oct 20 09:00:00 2026`) as epoch ms; undefined if malformed. */
export function parseLstart(text: string): number | undefined {
  const m = /^[A-Z][a-z]{2} ([A-Z][a-z]{2})\s+(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(
    text,
  );
  if (!m) return undefined;
  const month = MONTHS[m[1] ?? ""];
  if (month === undefined) return undefined;
  const ms = Date.UTC(Number(m[6]), month, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isFinite(ms) ? ms : undefined;
}

export const PS_COLUMNS = "pid=,ppid=,pgid=,uid=,pcpu=,rss=,etime=,lstart=,comm=";

const PS_LINE = new RegExp(
  `^\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+(?:\\.\\d+)?)\\s+(\\d+)\\s+((?:\\d+-)?(?:\\d+:)?\\d+:\\d{2})\\s+(${LSTART})\\s+(\\S.*)$`,
);

/** One `ps -o pid=,ppid=,pgid=,uid=,pcpu=,rss=,etime=,lstart=,comm=` line; anything else is undefined. */
export function parsePsLine(line: string): ProcRow | undefined {
  const m = PS_LINE.exec(line.replace(/\r$/, ""));
  if (!m) return undefined;
  const [pid, ppid, pgid, uid, rssKb] = [m[1], m[2], m[3], m[4], m[6]].map(Number);
  const cpu = Number(m[5]);
  if (
    pid === undefined ||
    ppid === undefined ||
    pgid === undefined ||
    uid === undefined ||
    rssKb === undefined ||
    ![pid, ppid, pgid, uid, rssKb, cpu].every((n) => Number.isFinite(n)) ||
    pid < 1
  ) {
    return undefined;
  }
  const start = (m[8] ?? "").replace(/\s+/g, " ");
  const command = (m[9] ?? "").trim();
  // Format, line and paragraph separators are as invisible as control characters: a name that
  // carries one could pass for another program in the prompt, so the row is not trusted at all.
  if (command === "" || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(command)) return undefined;
  return {
    pid,
    ppid,
    pgid,
    uid,
    cpu,
    rssKb,
    etimeSeconds: parseEtime(m[7] ?? "") ?? null,
    start,
    startMs: parseLstart(start) ?? null,
    command: command.slice(0, MAX_COMMAND_CHARS),
  };
}

export interface PsParse {
  rows: ProcRow[];
  /** Lines dropped (not a complete row, an invisible character in the name) or pids claimed twice. */
  warnings: number;
}

/**
 * The whole table, strictly. A process name may hold a line break and so print a second, forged
 * row; therefore a line that does not parse completely is DROPPED (counted in `warnings`), and a
 * pid claimed by two rows is dropped from the result ENTIRELY (never last-wins, never first-wins),
 * because no one can tell which of them is real. Blank lines are not warnings.
 */
export function parsePsTable(text: string): PsParse {
  const byPid = new Map<number, ProcRow>();
  const claimedTwice = new Set<number>();
  let warnings = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const row = parsePsLine(line);
    if (row === undefined) {
      warnings++;
      continue;
    }
    if (byPid.has(row.pid)) claimedTwice.add(row.pid);
    else byPid.set(row.pid, row);
  }
  for (const pid of claimedTwice) {
    byPid.delete(pid);
    warnings++;
  }
  return { rows: [...byPid.values()], warnings };
}
