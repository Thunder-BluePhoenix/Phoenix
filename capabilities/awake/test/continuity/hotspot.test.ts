// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  MAX_PREVIOUS_NETWORK_BYTES,
  PREVIOUS_NETWORK_FILE,
  isUsablePassword,
  isValidSsid,
  parseContinuityConfig,
  parseCurrentNetwork,
  parseWifiDevice,
} from "../../src/continuity";
import type { RunResult } from "../../src/system";
import { DATA_DIR, continuityRig, fakePassword, statusOf, types, type RigOptions } from "./rig";

const PORTS = [
  "Hardware Port: Ethernet Adapter (en4)",
  "Device: en4",
  "Ethernet Address: aa:bb",
  "",
  "Hardware Port: Wi-Fi",
  "Device: en0",
  "Ethernet Address: cc:dd",
  "",
].join("\n");

const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });

function wifiScript(
  current: string,
  opts: { joinStdout?: string; ports?: string } = {},
): RigOptions["script"] {
  return (file, args) => {
    if (file !== "/usr/sbin/networksetup") return undefined;
    if (args[0] === "-listallhardwareports") return ok(opts.ports ?? PORTS);
    if (args[0] === "-getairportnetwork") return ok(current);
    if (args[0] === "-setairportnetwork") return ok(opts.joinStdout ?? "");
    return undefined;
  };
}

const config = (hotspot: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  continuity: {
    network_watch: { enabled: true, hosts: ["example.test"] },
    hotspot: { enabled: true, ssid: "Pocket Net", ...hotspot },
    ...extra,
  },
});

const writes = (r: { sys: { runs: { file: string; args: readonly string[] }[] } }) =>
  r.sys.runs.filter(
    (x) => x.file === "/usr/sbin/networksetup" && x.args[0] === "-setairportnetwork",
  );

describe("parsers and validators", () => {
  it("finds the Wi-Fi device and ignores other ports and odd names", () => {
    expect(parseWifiDevice(PORTS)).toBe("en0");
    expect(parseWifiDevice(PORTS.replace("Device: en0", "Device: en0; rm -rf"))).toBeNull();
    expect(parseWifiDevice("Hardware Port: Wi-Fi\nDevice: ../en0\n")).toBeNull();
    expect(parseWifiDevice("")).toBeNull();
  });

  it("reads the current network or 'not associated'", () => {
    expect(parseCurrentNetwork("Current Wi-Fi Network: Home\n")).toBe("Home");
    expect(parseCurrentNetwork("You are not associated with an AirPort network.\n")).toBeNull();
    expect(parseCurrentNetwork("garbage")).toBeUndefined();
  });

  it("rejects SSIDs that could act as options or hide text", () => {
    expect(isValidSsid("Pocket Net")).toBe(true);
    for (const bad of ["", "-x", "a\nb", "a\u202eb", "x".repeat(33), 5])
      expect(isValidSsid(bad)).toBe(false);
    expect(parseContinuityConfig({ hotspot: { ssid: "-evil" } }).hotspot.ssid).toBeNull();
  });

  it("only accepts passwords that cannot be read as an option", () => {
    expect(isUsablePassword(fakePassword())).toBe(true);
    for (const bad of ["short", "-abcdefgh", "abc\ndefghi", "x".repeat(64)])
      expect(isUsablePassword(bad)).toBe(false);
  });
});

describe("automatic join", () => {
  it("joins with exact argv after an outage, only while enabled AND a session is active; no password by default", async () => {
    const r = await continuityRig({
      config: config({}),
      script: wifiScript("Current Wi-Fi Network: Home\n"),
    });
    r.net.up = false;
    await r.tick(3);
    expect(types(r)).toContain("awake.hotspot.joined");
    expect(r.sys.runs.map((x) => [x.file, ...x.args])).toEqual([
      ["/usr/sbin/networksetup", "-listallhardwareports"],
      ["/usr/sbin/networksetup", "-getairportnetwork", "en0"],
      ["/usr/sbin/networksetup", "-setairportnetwork", "en0", "Pocket Net"],
    ]);
    r.shutdown();
  });

  it("does not join without an active session", async () => {
    const r = await continuityRig({
      config: config({}),
      withSession: false,
      script: wifiScript("Current Wi-Fi Network: Home\n"),
    });
    r.net.up = false;
    await r.tick(3);
    expect(types(r)).toEqual(["awake.network.down"]);
    expect(r.sys.runs).toEqual([]);
    r.shutdown();
  });

  it("does not join when hotspot failover is off", async () => {
    const r = await continuityRig({
      config: config({ enabled: false }),
      script: wifiScript("Current Wi-Fi Network: Home\n"),
    });
    r.net.up = false;
    await r.tick(3);
    expect(r.sys.runs).toEqual([]);
    r.shutdown();
  });

  it("uses the keychain password as the last argv element only when the user allowed it, and never leaks it", async () => {
    const pw = fakePassword();
    const r = await continuityRig({
      config: config({ allow_password_argv: true }),
      secret: pw,
      script: wifiScript("Current Wi-Fi Network: Home\n"),
    });
    r.net.up = false;
    await r.tick(3);
    expect(writes(r).map((x) => x.args)).toEqual([["-setairportnetwork", "en0", "Pocket Net", pw]]);
    const status = await statusOf(r);
    const everything = JSON.stringify([r.events, r.logs, status, r.module.commandSpecs]);
    expect(everything).not.toContain(pw);
    expect(everything).toContain("keychain_password");
    r.shutdown();
  });

  it("a rejected password is never passed to networksetup and never echoed", async () => {
    const bad = "-" + fakePassword();
    const r = await continuityRig({
      config: config({ allow_password_argv: true }),
      secret: bad,
      script: wifiScript("Current Wi-Fi Network: Home\n"),
    });
    r.net.up = false;
    await r.tick(3);
    expect(writes(r)).toEqual([]);
    expect(JSON.stringify([r.events, r.logs])).not.toContain(bad);
    expect(r.events.find((e) => e.event_type === "awake.hotspot.failed")?.payload).toEqual({
      reason: "bad_password",
    });
    r.shutdown();
  });

  it("without the opt-in the stored password is not even read into argv", async () => {
    const pw = fakePassword();
    const r = await continuityRig({
      config: config({}),
      secret: pw,
      script: wifiScript("Current Wi-Fi Network: Home\n"),
    });
    r.net.up = false;
    await r.tick(3);
    expect(JSON.stringify(r.sys.runs)).not.toContain(pw);
    r.shutdown();
  });

  it("refuses a Wi-Fi device name that is not enN (injection) and joins nothing", async () => {
    const r = await continuityRig({
      config: config({}),
      script: wifiScript("", { ports: "Hardware Port: Wi-Fi\nDevice: en0 -x\n" }),
    });
    r.net.up = false;
    await r.tick(3);
    expect(writes(r)).toEqual([]);
    expect(r.events.find((e) => e.event_type === "awake.hotspot.failed")?.payload).toEqual({
      reason: "no_wifi_device",
    });
    r.shutdown();
  });

  it("an SSID that fails validation in config is never used", async () => {
    const r = await continuityRig({
      config: config({ ssid: "-setairportnetwork" }),
      script: wifiScript("Current Wi-Fi Network: Home\n"),
    });
    r.net.up = false;
    await r.tick(3);
    expect(writes(r)).toEqual([]);
    r.shutdown();
  });

  it("treats networksetup's 'Failed to join' text as a failure even with exit code 0", async () => {
    const r = await continuityRig({
      config: config({}),
      script: wifiScript("Current Wi-Fi Network: Home\n", {
        joinStdout: "Failed to join network Pocket Net.\nError: -3900",
      }),
    });
    r.net.up = false;
    await r.tick(3);
    expect(types(r)).toContain("awake.hotspot.failed");
    expect(types(r)).not.toContain("awake.hotspot.joined");
    r.shutdown();
  });

  it("does nothing when already on the hotspot", async () => {
    const r = await continuityRig({
      config: config({}),
      script: wifiScript("Current Wi-Fi Network: Pocket Net\n"),
    });
    r.net.up = false;
    await r.tick(3);
    expect(writes(r)).toEqual([]);
    r.shutdown();
  });

  it("is macOS only", async () => {
    const r = await continuityRig({ config: config({}), platform: "linux" });
    r.net.up = false;
    await r.tick(3);
    expect(r.sys.runs).toEqual([]);
    expect(r.events.find((e) => e.event_type === "awake.hotspot.failed")?.payload).toEqual({
      reason: "unsupported_platform",
    });
    r.shutdown();
  });
});

/** A Wi-Fi that follows `-setairportnetwork`, as a real one does: after a join it is on that network. */
function followingWifi(
  start: string | null,
): RigOptions["script"] & { on: string | null; unreadable: boolean } {
  const wifi = (file: string, args: readonly string[]) => {
    if (file !== "/usr/sbin/networksetup") return undefined;
    if (args[0] === "-listallhardwareports") return ok(PORTS);
    if (args[0] === "-getairportnetwork") {
      if (wifi.unreadable) return ok("something unparseable\n");
      return ok(
        wifi.on === null
          ? "You are not associated with an AirPort network.\n"
          : `Current Wi-Fi Network: ${wifi.on}\n`,
      );
    }
    if (args[0] === "-setairportnetwork") {
      wifi.on = args[2] ?? null;
      return ok();
    }
    return undefined;
  };
  wifi.on = start;
  wifi.unreadable = false;
  return wifi;
}

describe("previous network", () => {
  it("is remembered before the join and rejoined by the confirmed command, without a password", async () => {
    const pw = fakePassword();
    const r = await continuityRig({
      config: config({ allow_password_argv: true }),
      secret: pw,
      script: followingWifi("Home"),
    });
    r.net.up = false;
    await r.tick(3);
    expect((await statusOf(r)).hotspot.previous_network_saved).toBe(true);
    await r.call("hotspot.rejoin_previous");
    expect(writes(r).at(-1)?.args).toEqual(["-setairportnetwork", "en0", "Home"]);
    expect(JSON.stringify(writes(r).at(-1))).not.toContain(pw);
    expect((await statusOf(r)).hotspot.previous_network_saved).toBe(false);
    r.shutdown();
  });

  it("is not saved when the Mac was on no network, so there is nothing to rejoin", async () => {
    const r = await continuityRig({
      config: config({}),
      script: wifiScript("You are not associated with an AirPort network.\n"),
    });
    r.net.up = false;
    await r.tick(3);
    expect(await r.call("hotspot.rejoin_previous")).toMatchObject({ joined: false });
    expect(r.fs.files.size).toBe(0);
    r.shutdown();
  });

  it("a later join from 'not associated' or an unreadable Wi-Fi keeps the saved real network", async () => {
    for (const second of ["not_associated", "unreadable"]) {
      const wifi = followingWifi("Home");
      const r = await continuityRig({ config: config({}), script: wifi });
      expect(await r.call("hotspot.join_now")).toMatchObject({ joined: true });
      if (second === "unreadable") wifi.unreadable = true;
      else wifi.on = null;
      expect(await r.call("hotspot.join_now")).toMatchObject({ joined: true });
      wifi.unreadable = false;
      wifi.on = "Pocket Net";
      expect(await r.call("hotspot.rejoin_previous")).toMatchObject({ joined: true });
      expect(writes(r).at(-1)?.args).toEqual(["-setairportnetwork", "en0", "Home"]);
      r.shutdown();
    }
  });

  it("a different real network replaces the saved one (the user moved)", async () => {
    const wifi = followingWifi("Home");
    const r = await continuityRig({ config: config({}), script: wifi });
    await r.call("hotspot.join_now");
    wifi.on = "Office";
    await r.call("hotspot.join_now");
    await r.call("hotspot.rejoin_previous");
    expect(writes(r).at(-1)?.args).toEqual(["-setairportnetwork", "en0", "Office"]);
    r.shutdown();
  });

  it("does not ask the Mac to join a network it is already on, and forgets the record", async () => {
    const wifi = followingWifi("Home");
    const r = await continuityRig({ config: config({}), script: wifi });
    await r.call("hotspot.join_now");
    wifi.on = "Home";
    const before = writes(r).length;
    expect(await r.call("hotspot.rejoin_previous")).toEqual({
      joined: true,
      mode: "known_network",
      already: true,
    });
    expect(writes(r)).toHaveLength(before);
    expect((await statusOf(r)).hotspot.previous_network_saved).toBe(false);
    expect(r.fs.files.size).toBe(0);
    r.shutdown();
  });

  it("keeps the record when the rejoin fails, so it can be tried again", async () => {
    const wifi = followingWifi("Home");
    const r = await continuityRig({ config: config({}), script: wifi });
    await r.call("hotspot.join_now");
    r.sys.script = (file, args) =>
      args[0] === "-setairportnetwork" ? ok("Failed to join network.\n") : wifi(file, args);
    expect(await r.call("hotspot.rejoin_previous")).toEqual({
      joined: false,
      reason: "join_failed",
    });
    expect((await statusOf(r)).hotspot.previous_network_saved).toBe(true);
    expect(r.fs.files.has(RECORD)).toBe(true);
    r.shutdown();
  });
});

/** Spelled out, not imported: a changed limit must fail the test. */
const DAY_MS = 24 * 60 * 60_000;
const RECORD = `${DATA_DIR}/awake/${PREVIOUS_NETWORK_FILE}`;

describe("previous network across a Core restart", () => {
  it("is written on join, owner-only, with the SSID and device but no password", async () => {
    const pw = fakePassword();
    const r = await continuityRig({
      config: config({ allow_password_argv: true }),
      secret: pw,
      script: followingWifi("Home"),
    });
    await r.call("hotspot.join_now");
    const text = r.fs.files.get(RECORD) ?? "";
    expect(JSON.parse(text)).toEqual({
      v: 1,
      ssid: "Home",
      device: "en0",
      at: r.sys.clock.now(),
    });
    expect(text).not.toContain(pw);
    expect(text).not.toContain("Pocket Net");
    expect(r.fs.modes.get(RECORD)).toBe(0o600);
    expect(r.fs.modes.get(`${DATA_DIR}/awake`)).toBe(0o700);
    expect(JSON.stringify([r.events, r.logs])).not.toContain("Home");
    r.shutdown();
  });

  it("a fresh module on the same file system can still rejoin; the rejoin clears the file", async () => {
    const wifi = followingWifi("Home");
    const first = await continuityRig({ config: config({}), script: wifi });
    await first.call("hotspot.join_now");
    first.shutdown();

    const second = await continuityRig({ config: config({}), restartOf: first, script: wifi });
    expect((await statusOf(second)).hotspot.previous_network_saved).toBe(true);
    expect(await second.call("hotspot.rejoin_previous")).toEqual({
      joined: true,
      mode: "known_network",
      already: false,
    });
    expect(writes(second).at(-1)?.args).toEqual(["-setairportnetwork", "en0", "Home"]);
    expect(second.fs.files.has(RECORD)).toBe(false);
    expect((await statusOf(second)).hotspot.previous_network_saved).toBe(false);
    second.shutdown();

    const third = await continuityRig({ config: config({}), restartOf: first, script: wifi });
    expect(await third.call("hotspot.rejoin_previous")).toMatchObject({
      joined: false,
      reason: "no_hotspot_configured",
    });
    third.shutdown();
  });

  it("the restarted module still asks for confirmation (rejoin is an execute command)", async () => {
    const r = await continuityRig({ config: config({}) });
    expect(
      r.module.commandSpecs.find((s) => s.name === "hotspot.rejoin_previous")?.side_effect,
    ).toBe("execute");
    r.shutdown();
  });

  it("a record older than 24 hours is ignored, deleted and never rejoined", async () => {
    const wifi = followingWifi("Home");
    const first = await continuityRig({ config: config({}), script: wifi });
    await first.call("hotspot.join_now");
    first.shutdown();

    first.sys.clock.current += DAY_MS - 1;
    const young = await continuityRig({ config: config({}), restartOf: first, script: wifi });
    expect((await statusOf(young)).hotspot.previous_network_saved).toBe(true);
    young.shutdown();

    first.sys.clock.current += 1;
    const old = await continuityRig({ config: config({}), restartOf: first, script: wifi });
    const before = writes(old).length;
    expect((await statusOf(old)).hotspot.previous_network_saved).toBe(false);
    expect(await old.call("hotspot.rejoin_previous")).toMatchObject({ joined: false });
    expect(writes(old)).toHaveLength(before);
    expect(old.fs.files.has(RECORD)).toBe(false);
    old.shutdown();
  });

  it("a record that expires while Core keeps running is dropped too", async () => {
    const wifi = followingWifi("Home");
    const r = await continuityRig({ config: config({}), script: wifi });
    await r.call("hotspot.join_now");
    r.sys.clock.current += DAY_MS;
    expect((await statusOf(r)).hotspot.previous_network_saved).toBe(false);
    expect(r.fs.files.has(RECORD)).toBe(false);
    r.shutdown();
  });

  const now = Date.parse("2026-10-20T09:00:00Z");
  const good = { v: 1, ssid: "Home", device: "en0", at: now };
  const hostile: [string, string][] = [
    ["not JSON", "{not json"],
    ["an array", "[]"],
    ["a null", "null"],
    ["an unknown key", JSON.stringify({ ...good, password: "x" })],
    ["a BSSID", JSON.stringify({ ...good, bssid: "aa:bb:cc:dd:ee:ff" })],
    ["a missing field", JSON.stringify({ v: 1, ssid: "Home", device: "en0" })],
    ["another version", JSON.stringify({ ...good, v: 2 })],
    ["an SSID with a control character", JSON.stringify({ ...good, ssid: "Ho\u0007me" })],
    ["an SSID starting with a dash", JSON.stringify({ ...good, ssid: "-Home" })],
    ["an SSID over 32 bytes", JSON.stringify({ ...good, ssid: "h".repeat(33) })],
    ["an empty SSID", JSON.stringify({ ...good, ssid: "" })],
    ["a null SSID", JSON.stringify({ ...good, ssid: null })],
    ["a device that is not enN", JSON.stringify({ ...good, device: "en0; reboot" })],
    ["a string time", JSON.stringify({ ...good, at: "2026-10-20T09:00:00Z" })],
    ["a negative time", JSON.stringify({ ...good, at: -1 })],
    ["a time in the future", JSON.stringify({ ...good, at: now + 3_600_000 })],
    ["an oversized file", JSON.stringify({ ...good, pad: "x".repeat(MAX_PREVIOUS_NETWORK_BYTES) })],
  ];
  for (const [name, text] of hostile) {
    it(`ignores and deletes a file with ${name}`, async () => {
      const seed = await continuityRig({ config: config({}) });
      seed.fs.files.set(RECORD, text);
      const wifi = followingWifi("Office");
      const r = await continuityRig({ config: config({}), restartOf: seed, script: wifi });
      expect((await statusOf(r)).hotspot.previous_network_saved).toBe(false);
      expect(await r.call("hotspot.rejoin_previous")).toMatchObject({ joined: false });
      expect(writes(r)).toEqual([]);
      expect(r.fs.files.has(RECORD)).toBe(false);
      r.shutdown();
    });
  }

  it("accepts exactly a good record (guards the hostile cases above)", async () => {
    const seed = await continuityRig({ config: config({}) });
    seed.fs.files.set(RECORD, JSON.stringify(good));
    const r = await continuityRig({ config: config({}), restartOf: seed });
    expect((await statusOf(r)).hotspot.previous_network_saved).toBe(true);
    r.shutdown();
  });

  it("an oversized file is deleted without being read", async () => {
    const seed = await continuityRig({ config: config({}) });
    seed.fs.files.set(RECORD, "x".repeat(MAX_PREVIOUS_NETWORK_BYTES + 1));
    let reads = 0;
    const read = seed.fs.read.bind(seed.fs);
    seed.fs.read = (path) => {
      reads += 1;
      return read(path);
    };
    const r = await continuityRig({ config: config({}), restartOf: seed });
    await statusOf(r);
    expect(reads).toBe(0);
    expect(r.fs.files.has(RECORD)).toBe(false);
    r.shutdown();
  });

  it("turning hotspot failover off forgets the remembered network", async () => {
    const wifi = followingWifi("Home");
    const first = await continuityRig({ config: config({}), script: wifi });
    await first.call("hotspot.join_now");
    first.shutdown();
    expect(first.fs.files.has(RECORD)).toBe(true);
    const off = await continuityRig({
      config: config({ enabled: false }),
      restartOf: first,
      script: wifi,
    });
    expect(first.fs.files.has(RECORD)).toBe(false);
    expect((await statusOf(off)).hotspot.previous_network_saved).toBe(false);
    off.shutdown();
  });

  it("a disk that cannot be written still lets this run rejoin, and reports no SSID", async () => {
    const wifi = followingWifi("Home");
    const r = await continuityRig({ config: config({}), script: wifi });
    r.fs.failReplace = true;
    await r.call("hotspot.join_now");
    expect(JSON.stringify(r.logs)).toContain("write_failed");
    expect(JSON.stringify(r.logs)).not.toContain("Home");
    expect((await statusOf(r)).hotspot.previous_network_saved).toBe(true);
    expect(await r.call("hotspot.rejoin_previous")).toMatchObject({ joined: true });
    r.shutdown();
  });

  it("an unreadable file is treated as no record", async () => {
    const seed = await continuityRig({ config: config({}) });
    seed.fs.files.set(RECORD, JSON.stringify(good));
    seed.fs.read = () => {
      throw new Error("EIO");
    };
    const r = await continuityRig({ config: config({}), restartOf: seed });
    expect((await statusOf(r)).hotspot.previous_network_saved).toBe(false);
    r.shutdown();
  });
});

describe("hotspot.join_now", () => {
  it("is an execute command with confirmation, refused while the feature is off", async () => {
    const r = await continuityRig({ config: config({ enabled: false }) });
    expect(r.module.commandSpecs.find((s) => s.name === "hotspot.join_now")?.side_effect).toBe(
      "execute",
    );
    await expect(r.call("hotspot.join_now")).rejects.toMatchObject({ kind: "unavailable" });
    expect(r.sys.runs).toEqual([]);
    r.shutdown();
  });

  it("joins even without a keep-awake session (the user asked) and rejects input", async () => {
    const r = await continuityRig({
      config: config({}),
      withSession: false,
      script: wifiScript("Current Wi-Fi Network: Home\n"),
    });
    await expect(r.call("hotspot.join_now", { ssid: "x" })).rejects.toMatchObject({
      kind: "invalid",
    });
    expect(await r.call("hotspot.join_now")).toMatchObject({ joined: true });
    expect(writes(r)).toHaveLength(1);
    r.shutdown();
  });

  it("with the password opt-in, its result, events, logs and status never contain the password", async () => {
    const pw = fakePassword();
    const r = await continuityRig({
      config: config({ allow_password_argv: true }),
      secret: pw,
      script: wifiScript("Current Wi-Fi Network: Home\n"),
    });
    const result = await r.call("hotspot.join_now");
    expect(result).toEqual({ joined: true, mode: "keychain_password", already: false });
    expect(writes(r).at(-1)?.args.at(-1)).toBe(pw);
    expect(JSON.stringify([result, r.events, r.logs, await statusOf(r)])).not.toContain(pw);
    r.shutdown();
  });

  it("declares the secret and its disclosure", async () => {
    const r = await continuityRig({ config: {} });
    expect(r.module.secrets?.map((s) => s.name)).toEqual(["hotspot_password"]);
    expect(r.module.secrets?.[0]?.description).toMatch(/command line/);
    r.shutdown();
  });
});
