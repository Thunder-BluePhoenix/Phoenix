#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// MANUAL real-browser check for "Send page to Phoenix" (Phase 89). Not a vitest test: it starts a real
// Chromium-family browser, a real Core and a local web server, and it is never run by CI.
//
//   PHOENIX_REAL_BROWSER_CHECK=1 node apps/extension/scripts/real-browser-check.mjs \
//     [--browser "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"] \
//     [--out docs/evidence/phase-89-real-browser-extension-<date>-raw.json]
//
// What it does (three scenarios, each with its own FRESH throwaway browser profile):
//   A  host manifest allows this extension's id            -> a real click-equivalent reaches Core
//   B  host manifest lists a DIFFERENT extension id        -> the browser must refuse to connect
//   C  no host manifest at all                             -> the browser must say the host is not found
//
// SAFETY RULES this script enforces and never relaxes:
//   1. It never attaches to, kills or reuses a running browser. Every browser it starts gets
//      `--user-data-dir=<fresh mkdtemp dir under /tmp>` (without that flag the binary would hand the
//      new window to the running instance), `--no-first-run`, `--no-default-browser-check`, and is
//      driven over `--remote-debugging-pipe` (no TCP debugging port exists at all).
//   2. The native-messaging host manifest is written ONLY into `<that temp dir>/NativeMessagingHosts/`
//      (Chromium reads the user-data-dir's folder first). `install-host.js` is NOT run: it only
//      targets the real per-user folder. This script imports its `buildManifest` (so the manifest is
//      the installer's own) and writes the manifest and a launcher by hand; the launcher differs from
//      the installer's only by exporting PHOENIX_DATA_DIR and logging `pid ppid` before `exec`.
//   3. Core is a child `core/runtime/src/main.ts` with a temp PHOENIX_DATA_DIR on port 0 (a free
//      loopback port). It never touches 47821/47822 or ~/.phoenix.
//   4. The page sent is a local page on 127.0.0.1 with a distinct path, query and fragment.
//   5. Only processes started here are signalled (by pid / process group, never by name). On exit it
//      verifies the browsers that were running before are still running with the same start time, and
//      that no browser process of ours is left. Temp dirs are deleted.
//
// What it cannot do: a real mouse click on the toolbar button. It uses the browser's own
// `Extensions.triggerAction` DevTools command (needs `--enable-unsafe-extension-debugging`), which
// runs the extension's default action for a tab. That is NOT a human user gesture, and the script
// says so in its output.
//
// Dependencies: Node 22 built-ins only (global WebSocket is not needed: the pipe transport is used).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { HOST_NAME, buildManifest, launcherScript } from "./install-host.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(HERE, "..");
const REPO = resolve(EXT, "..", "..");
const DEFAULT_BROWSER = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OTHER_ID = "p".repeat(32); // a syntactically valid id that is not this extension's
const PAGE_PATH = "/notes/page1";
const PAGE_QUERY = "?token=zzz&utm=distinct";
const PAGE_FRAGMENT = "#frag-distinct";
const PAGE_TITLE = "Phoenix real-browser test page";
const SELECTED = "Selected sentence for Phoenix.";

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export function pathDerivedExtensionId(absolutePath) {
  // Chromium: first 16 bytes of SHA-256(path) as hex, each hex digit mapped to a..p.
  const hex = createHash("sha256").update(absolutePath).digest("hex").slice(0, 32);
  return [...hex]
    .map((c) => String.fromCharCode("a".charCodeAt(0) + Number.parseInt(c, 16)))
    .join("");
}

function psTable() {
  const out = spawnSync("ps", ["-axo", "pid=,ppid=,lstart=,command="], { encoding: "utf8" }).stdout;
  return out
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(\w{3} \w{3}\s+\d+ [\d:]+ \d{4})\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), started: m[3], command: m[4] }));
}

function descendants(rootPid, table) {
  const found = new Set([rootPid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const row of table) {
      if (found.has(row.ppid) && !found.has(row.pid)) {
        found.add(row.pid);
        grew = true;
      }
    }
  }
  return found;
}

// ---- Chrome DevTools Protocol over --remote-debugging-pipe (NUL-delimited JSON on fds 3 and 4) ----
class Cdp {
  constructor(child) {
    this.child = child;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = [];
    let buffer = "";
    child.stdio[4].on("data", (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf("\0"); i >= 0; i = buffer.indexOf("\0")) {
        const message = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (message.id !== undefined) this.pending.get(message.id)?.(message);
        else for (const listener of this.listeners) listener(message);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((done) => {
      this.pending.set(id, done);
      this.child.stdio[3].write(
        `${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`,
      );
    });
  }
  on(listener) {
    this.listeners.push(listener);
  }
}

async function evaluate(cdp, sessionId, expression) {
  const reply = await cdp.send(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (reply.error) return { error: reply.error };
  if (reply.result?.exceptionDetails)
    return {
      exception:
        reply.result.exceptionDetails.text +
        " " +
        (reply.result.exceptionDetails.exception?.description ?? ""),
    };
  return { value: reply.result?.result?.value };
}

async function waitFor(label, fn, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await sleep(250);
  }
}

// ---- Core ----
async function startCore(dataDir) {
  const tsx = join(REPO, "node_modules", ".bin", "tsx");
  const child = spawn(tsx, ["core/runtime/src/main.ts"], {
    cwd: REPO,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PHOENIX_DATA_DIR: dataDir, PHOENIX_PORT: "0", PHOENIX_ENV: "dev" },
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const info = await waitFor(
    "core.json",
    () => {
      try {
        return JSON.parse(readFileSync(join(dataDir, "core.json"), "utf8"));
      } catch {
        return null;
      }
    },
    90_000,
  );
  const token = readFileSync(join(dataDir, "session.token"), "utf8").trim();
  const base = info.url;
  await waitFor(
    "health",
    async () => (await fetch(`${base}/api/health`).catch(() => null))?.ok,
    30_000,
  );
  const api = async (path) => {
    const res = await fetch(base + path, { headers: { authorization: `Bearer ${token}` } });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { child, base, api, log: () => log };
}

function killGroup(child) {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}

// ---- Local test page ----
async function startPageServer() {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(
      `<!doctype html><html><head><title>${PAGE_TITLE}</title></head><body><h1>Test</h1><p id="p">${SELECTED} More text that is not selected.</p></body></html>`,
    );
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return { server, port: server.address().port };
}

// ---- One scenario ----
async function scenario({
  name,
  browserPath,
  manifestMode,
  extensionIdForManifest,
  core,
  page,
  hostLog,
}) {
  const profile = mkdtempSync("/tmp/p89-profile-");
  const report = { name, manifestMode, profileUnderTmp: true };
  const nmDir = join(profile, "NativeMessagingHosts");
  const launcher = join(profile, "phoenix-host-launcher.sh");
  const args = [
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-pipe",
    "--enable-unsafe-extension-debugging",
    "--window-size=700,500",
    "about:blank",
  ];
  report.args = args.map((a) => a.replace(profile, "<temp profile>"));
  let child;
  try {
    child = spawn(browserPath, args, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    const cdp = new Cdp(child);
    report.browserPid = child.pid;
    const version = await waitFor(
      "Browser.getVersion",
      async () => {
        const r = await cdp.send("Browser.getVersion");
        return r.result ?? null;
      },
      30_000,
    );
    report.browserVersion = version.product;

    const load = await cdp.send("Extensions.loadUnpacked", { path: EXT });
    report.loadUnpacked = load;
    const extensionId = load.result?.id;
    if (!extensionId) throw new Error(`loadUnpacked failed: ${JSON.stringify(load)}`);
    report.extensionId = extensionId;
    report.pathDerivedId = pathDerivedExtensionId(EXT);
    report.idMatchesPathDerivation = report.pathDerivedId === extensionId;
    report.manifestHasKey = "key" in JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8"));

    // The host manifest goes into the throwaway profile only. Written after the id is known.
    if (manifestMode !== "none") {
      mkdirSync(nmDir, { recursive: true });
      const hostPath = join(EXT, "host", "main.js");
      const base = launcherScript(process.execPath, hostPath).split("\n");
      const wrapper = [
        base[0],
        `export PHOENIX_DATA_DIR='${core.dataDir}'`,
        `{ echo "pid=$$ ppid=$PPID args=$*"; ps -o pid=,ppid=,command= -p "$PPID"; } >> '${hostLog}' 2>&1`,
        base[1],
        "",
      ].join("\n");
      writeFileSync(launcher, wrapper, { mode: 0o755 });
      chmodSync(launcher, 0o755);
      const manifest = buildManifest("chrome", launcher, {
        chrome: extensionIdForManifest(extensionId),
      });
      writeFileSync(join(nmDir, `${HOST_NAME}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
      report.hostManifest = { ...manifest, path: "<temp profile>/phoenix-host-launcher.sh" };
      report.launcher = wrapper
        .replaceAll(core.dataDir, "<core data dir>")
        .replaceAll(process.execPath, "<node>")
        .replaceAll(EXT, "<apps/extension>");
    }

    // Open the test page and select the sentence (a script-made selection, see notes).
    const url = `http://127.0.0.1:${page.port}${PAGE_PATH}${PAGE_QUERY}${PAGE_FRAGMENT}`;
    report.pageUrlOpened = url.replace(String(page.port), "<port>");
    const created = await cdp.send("Target.createTarget", { url: "about:blank" });
    const targetId = created.result.targetId;
    await cdp.send("Target.activateTarget", { targetId });
    const attached = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const pageSession = attached.result.sessionId;
    report.pageNavigate = await cdp.send("Page.navigate", { url }, pageSession);
    await waitFor(
      "page load",
      async () =>
        (await evaluate(cdp, pageSession, "document.readyState")).value === "complete" &&
        (await evaluate(cdp, pageSession, "document.title")).value === PAGE_TITLE,
      20_000,
    );
    await evaluate(
      cdp,
      pageSession,
      `(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById("p").firstChild); r.setEnd(document.getElementById("p").firstChild, ${SELECTED.length}); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return String(s); })()`,
    );
    report.pageSelectionBeforeClick = (
      await evaluate(cdp, pageSession, "String(getSelection())")
    ).value;

    // Extension service worker target.
    const workerTarget = await waitFor(
      "extension service worker",
      async () => {
        const t = (await cdp.send("Target.getTargets")).result.targetInfos;
        return t.find(
          (x) =>
            x.type === "service_worker" && x.url.startsWith(`chrome-extension://${extensionId}/`),
        );
      },
      15_000,
    );
    const swSession = (
      await cdp.send("Target.attachToTarget", { targetId: workerTarget.targetId, flatten: true })
    ).result.sessionId;
    const swEvents = [];
    cdp.on((m) => {
      if (
        m.sessionId === swSession &&
        (m.method === "Runtime.exceptionThrown" ||
          m.method === "Runtime.consoleAPICalled" ||
          m.method === "Log.entryAdded")
      )
        swEvents.push({ method: m.method, params: m.params });
    });
    await cdp.send("Runtime.enable", {}, swSession);
    await cdp.send("Log.enable", {}, swSession);
    report.serviceWorkerUrl = workerTarget.url.replace(extensionId, "<id>");

    // Manifest errors / warnings as chrome://extensions shows them.
    const mgmt = await cdp.send("Target.createTarget", { url: "chrome://extensions" });
    const mgmtSession = (
      await cdp.send("Target.attachToTarget", { targetId: mgmt.result.targetId, flatten: true })
    ).result.sessionId;
    await sleep(2000);
    const info = await evaluate(
      cdp,
      mgmtSession,
      `chrome.developerPrivate.getExtensionsInfo({includeDisabled:true,includeTerminated:true}).then(l => JSON.stringify(l.filter(e => e.id === ${JSON.stringify(extensionId)}).map(e => ({ name: e.name, version: e.version, state: e.state, location: e.location, disableReasons: e.disableReasons, manifestErrors: e.manifestErrors, runtimeErrors: e.runtimeErrors, installWarnings: e.installWarnings, permissions: e.permissions?.simplePermissions?.map(p => p.message), runtimeHostPermissions: e.runtimeHostPermissions?.hosts, pinnedToToolbar: e.pinnedToToolbar }))))`,
    );
    report.extensionsPageInfo = info.value ? JSON.parse(info.value) : info;
    await cdp.send("Target.closeTarget", { targetId: mgmt.result.targetId });
    await cdp.send("Target.activateTarget", { targetId });

    // Trigger the action. NOT a human gesture.
    const processesBeforeClick = new Set(psTable().map((r) => r.pid));
    // triggerAction needs the TAB target of the page (type "tab"), not its "page" target.
    const tabTarget = (
      await cdp.send("Target.getTargets", { filter: [{ type: "tab" }] })
    ).result.targetInfos.find(
      (t) => t.type === "tab" && t.url.startsWith(`http://127.0.0.1:${page.port}${PAGE_PATH}`),
    );
    report.tabTarget = tabTarget
      ? { type: tabTarget.type, url: tabTarget.url.replace(String(page.port), "<port>") }
      : null;
    const trigger = await cdp.send("Extensions.triggerAction", {
      id: extensionId,
      targetId: tabTarget?.targetId,
    });
    report.triggerAction = trigger;
    report.clickWasRealUserGesture = false;

    const readBadge = async () => {
      const r = await evaluate(
        cdp,
        swSession,
        `chrome.tabs.query({}).then(async tabs => JSON.stringify(await Promise.all(tabs.map(async t => ({ id: t.id, badge: await chrome.action.getBadgeText({tabId: t.id}), title: await chrome.action.getTitle({tabId: t.id}) })))))`,
      );
      return r.value ? JSON.parse(r.value) : [];
    };
    const outcome = await waitFor(
      "badge text",
      async () => {
        const tabs = await readBadge();
        return tabs.find((t) => t.badge !== "") ?? null;
      },
      manifestMode === "none" ? 8_000 : 20_000,
    ).catch(() => null);
    report.badgeAfterAction = outcome;
    report.allTabsBadge = await readBadge();

    // The exact browser error, via the same API the extension uses (never sends a page in B and C
    // because the browser refuses before any host runs).
    if (manifestMode !== "allowed") {
      const direct = await evaluate(
        cdp,
        swSession,
        `new Promise(res => chrome.runtime.sendNativeMessage(${JSON.stringify(HOST_NAME)}, { kind: "page", url: "http://127.0.0.1/", title: "control" }, r => res({ response: r ?? null, lastError: chrome.runtime.lastError?.message ?? null })))`,
      );
      report.directSendNativeMessage = direct.value ?? direct;
    }
    report.serviceWorkerEvents = swEvents;
    // Chrome's own updater logs verbose lines to this stderr; they are not about the extension.
    report.browserStderrNonUpdater = stderr
      .split("\n")
      .filter((l) => l.trim() !== "" && !/GoogleUpdater|updater\.cc|event_history/.test(l));

    const table = psTable();
    const mine = descendants(child.pid, table);
    report.browserProcessCount = mine.size;
    report.processesStartedByClick = table
      .filter(
        (r) =>
          mine.has(r.ppid) &&
          !processesBeforeClick.has(r.pid) &&
          /phoenix-host-launcher|extension\/host\/main/.test(r.command),
      )
      .map((r) => ({
        pid: r.pid,
        ppid: r.ppid,
        command: r.command
          .replaceAll(profile, "<temp profile>")
          .replaceAll(EXT, "<apps/extension>"),
      }));
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await waitFor(
        "browser exit",
        () => child.exitCode !== null || child.signalCode !== null,
        15_000,
      ).catch(() => child.kill("SIGKILL"));
    }
    await sleep(500);
    rmSync(profile, { recursive: true, force: true });
    report.profileRemoved = !existsSync(profile);
  }
  return report;
}

async function main() {
  if (process.env.PHOENIX_REAL_BROWSER_CHECK !== "1") {
    console.error(
      "Refusing to run: set PHOENIX_REAL_BROWSER_CHECK=1. This starts a real browser, a real Core and a web server.",
    );
    return 2;
  }
  if (process.platform !== "darwin" && process.platform !== "linux") {
    console.error(
      "Only macOS and Linux profiles read <user-data-dir>/NativeMessagingHosts; not run elsewhere.",
    );
    return 2;
  }
  const { values } = parseArgs({
    options: { browser: { type: "string" }, out: { type: "string" } },
  });
  const browserPath = values.browser ?? DEFAULT_BROWSER;
  // The main process of an already running browser is the row whose command is exactly the binary.
  const mainRows = () => psTable().filter((r) => r.command === browserPath);
  const runningBefore = mainRows();
  const result = {
    date: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    browserPath,
    scenarios: [],
  };

  const coreDir = mkdtempSync("/tmp/p89-core-");
  const hostLog = `/tmp/p89-host-${process.pid}.log`;
  let core;
  const page = await startPageServer();
  try {
    core = await startCore(coreDir);
    core.dataDir = coreDir;
    result.coreUrl = core.base.replace(/:\d+$/, ":<port>");
    const expectedUrl = `http://127.0.0.1:${page.port}${PAGE_PATH}`;
    const notes = async () => (await core.api("/api/companion/pages")).json?.pages ?? [];
    const runOne = async (name, manifestMode, idFn) => {
      const notesBefore = (await notes()).length;
      const hostLogBefore = existsSync(hostLog) ? readFileSync(hostLog, "utf8") : "";
      const r = await scenario({
        name,
        browserPath,
        manifestMode,
        extensionIdForManifest: idFn,
        core,
        page,
        hostLog,
      });
      const hostLogAfter = existsSync(hostLog) ? readFileSync(hostLog, "utf8") : "";
      r.hostLogNewLines = hostLogAfter
        .slice(hostLogBefore.length)
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => l.replace(/chrome-extension:\/\/[a-p]{32}/g, "chrome-extension://<id>"));
      const after = await notes();
      r.noteCountBefore = notesBefore;
      r.noteCountAfter = after.length;
      r.newNotes = after
        .slice(0, after.length - notesBefore)
        .map((n) => ({ ...n, url: n.url.replace(String(page.port), "<port>") }));
      r.newNoteUrlIsOriginAndPathOnly =
        r.newNotes.length > 0
          ? r.newNotes.every((n) => n.url === expectedUrl.replace(String(page.port), "<port>"))
          : null;
      r.newNotesContainQueryOrFragment = r.newNotes
        .map((n) => JSON.stringify(n))
        .some((s) => /token=zzz|utm=distinct|frag-distinct/.test(s));
      result.scenarios.push(r);
    };
    await runOne("A: host manifest allows this extension id", "allowed", (id) => id);
    await runOne(
      "B: host manifest lists a different extension id (negative control)",
      "different",
      () => OTHER_ID,
    );
    await runOne("C: no host manifest installed (negative control)", "none", () => OTHER_ID);

    const audit = (await core.api("/api/audit?limit=200")).json?.entries ?? [];
    result.auditRowsCompanion = audit
      .filter((e) => String(e.action ?? "").startsWith("companion."))
      .map((e) => JSON.parse(JSON.stringify(e).replace(String(page.port), "<port>")));
    result.auditStatus = (await core.api("/api/audit?limit=200")).status;
    result.settingsListApi = {
      route: "GET /api/companion/pages",
      ...(await (async () => {
        const r = await core.api("/api/companion/pages");
        return {
          status: r.status,
          body: JSON.parse(JSON.stringify(r.json).replace(String(page.port), "<port>")),
        };
      })()),
    };
    result.coreLogTail = core.log().split("\n").slice(-5);
  } finally {
    if (core) killGroup(core.child);
    await sleep(1500);
    if (core && core.child.exitCode === null && core.child.signalCode === null) {
      try {
        process.kill(-core.child.pid, "SIGKILL");
      } catch {
        /* gone */
      }
    }
    await new Promise((done) => page.server.close(done));
    rmSync(coreDir, { recursive: true, force: true });
    rmSync(hostLog, { force: true });
    result.coreDirRemoved = !existsSync(coreDir);
  }

  await sleep(1000);
  const runningAfter = mainRows();
  const key = (r) => `${r.pid}|${r.started}`;
  const afterKeys = new Set(runningAfter.map(key));
  result.cleanup = {
    preexistingStillRunningUnchanged: runningBefore.every((r) => afterKeys.has(key(r))),
    preexistingMainProcesses: runningBefore.map((r) => ({ pid: r.pid, started: r.started })),
    leftoverProcessesWithOurProfile: psTable().filter((r) => r.command.includes("p89-profile-"))
      .length,
    leftoverMainProcessesFromUs: runningAfter.filter(
      (r) => !runningBefore.some((b) => key(b) === key(r)),
    ).length,
  };
  const outPath = values.out ?? null;
  if (outPath) writeFileSync(resolve(outPath), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main();
}
