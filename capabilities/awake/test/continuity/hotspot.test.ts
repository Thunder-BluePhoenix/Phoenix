// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  isUsablePassword,
  isValidSsid,
  parseContinuityConfig,
  parseCurrentNetwork,
  parseWifiDevice,
} from "../../src/continuity";
import type { RunResult } from "../../src/system";
import { continuityRig, fakePassword, statusOf, types, type RigOptions } from "./rig";

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
  r.sys.runs.filter((x) => x.file === "/usr/sbin/networksetup" && x.args[0] === "-setairportnetwork");

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

describe("previous network", () => {
  it("is remembered before the join and rejoined by the confirmed command, without a password", async () => {
    const pw = fakePassword();
    const r = await continuityRig({
      config: config({ allow_password_argv: true }),
      secret: pw,
      script: wifiScript("Current Wi-Fi Network: Home\n"),
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
    r.shutdown();
  });

  it("a later join from 'not associated' or an unreadable Wi-Fi keeps the saved real network", async () => {
    for (const second of [
      "You are not associated with an AirPort network.\n",
      "something unparseable\n",
    ]) {
      let wifi = "Current Wi-Fi Network: Home\n";
      const r = await continuityRig({
        config: config({}),
        script: (file, args) => wifiScript(wifi)?.(file, args),
      });
      expect(await r.call("hotspot.join_now")).toMatchObject({ joined: true });
      wifi = second;
      expect(await r.call("hotspot.join_now")).toMatchObject({ joined: true });
      expect(await r.call("hotspot.rejoin_previous")).toMatchObject({ joined: true });
      expect(writes(r).at(-1)?.args).toEqual(["-setairportnetwork", "en0", "Home"]);
      r.shutdown();
    }
  });

  it("a different real network replaces the saved one (the user moved)", async () => {
    let wifi = "Current Wi-Fi Network: Home\n";
    const r = await continuityRig({
      config: config({}),
      script: (file, args) => wifiScript(wifi)?.(file, args),
    });
    await r.call("hotspot.join_now");
    wifi = "Current Wi-Fi Network: Office\n";
    await r.call("hotspot.join_now");
    await r.call("hotspot.rejoin_previous");
    expect(writes(r).at(-1)?.args).toEqual(["-setairportnetwork", "en0", "Office"]);
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
