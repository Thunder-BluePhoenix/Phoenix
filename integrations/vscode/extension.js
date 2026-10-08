// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phoenix for VS Code: a thin shell around the modules in ./src, which hold all the logic and
// are tested without an editor. This file only connects VS Code's notifications to them.
//
// It reports the workspace name, task start/end with exit codes, and the NUMBER of errors and
// warnings. It never reads or sends file paths, file contents, diagnostic messages or task
// command lines, and it talks only to Phoenix Core on this machine.
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const vscode = require("vscode");
const { resolveCoreUrl, resolveSessionToken } = require("./src/core-discovery");
const { countDiagnostics, createDiagnosticsReporter } = require("./src/diagnostics");
const {
  buildManifest,
  createTaskTracker,
  diagnosticsChanged,
  workspaceOpened,
} = require("./src/events");
const { createPhoenixClient } = require("./src/phoenix-client");

const RECONCILE_MS = 15_000;

/** @type {{ dispose(): void }[]} */
let disposables = [];
/** @type {ReturnType<typeof createPhoenixClient> | undefined} */
let client;

/** @param {string} file */
function readIfExists(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/** @param {vscode.ExtensionContext} context */
async function activate(context) {
  const output = vscode.window.createOutputChannel("Phoenix");
  const log = (/** @type {string} */ message) => output.appendLine(message);
  disposables = [output];
  context.subscriptions.push({ dispose: deactivate });

  // A token file inside a workspace folder is only trusted once the user trusts the workspace.
  const folders = () =>
    vscode.workspace.isTrusted
      ? (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)
      : [];
  /** @type {string} */
  let coreUrl;
  try {
    coreUrl = resolveCoreUrl({
      setting: vscode.workspace.getConfiguration("phoenix").get("coreUrl"),
      env: process.env,
    });
  } catch (err) {
    log(String(err instanceof Error ? err.message : err));
    void vscode.window.showWarningMessage(
      "Phoenix: the Core URL setting must be a loopback address (http://127.0.0.1:4870).",
    );
    return;
  }

  client = createPhoenixClient({
    coreUrl,
    manifest: buildManifest(),
    sessionToken: () =>
      resolveSessionToken({
        env: process.env,
        workspaceFolders: folders(),
        home: os.homedir(),
        readFile: readIfExists,
      }),
    log,
    onEnable: () => {
      if (client?.registered) announce();
    },
  });
  await client.listen();

  const send = (/** @type {Record<string, unknown>} */ event) => {
    void client?.emit(event).then((r) => {
      if (!r.sent) log(`not sent: ${event.event_type} (${r.reason})`);
    });
  };

  function announce() {
    send(
      workspaceOpened({
        name: vscode.workspace.name,
        folderCount: vscode.workspace.workspaceFolders?.length ?? 0,
      }),
    );
  }

  const tasks = createTaskTracker();
  const info = (/** @type {vscode.Task} */ task) => ({
    name: task.name,
    source: task.source,
    type: task.definition.type,
  });
  const diagnostics = createDiagnosticsReporter({
    read: () => countDiagnostics(vscode.languages.getDiagnostics()),
    report: (change) => send(diagnosticsChanged(change)),
  });

  disposables.push(
    vscode.tasks.onDidStartTaskProcess((e) =>
      send(tasks.started(e.execution, info(e.execution.task))),
    ),
    vscode.tasks.onDidEndTaskProcess((e) =>
      send(tasks.ended(e.execution, e.exitCode, info(e.execution.task))),
    ),
    vscode.languages.onDidChangeDiagnostics(() => diagnostics.changed()),
    { dispose: () => diagnostics.dispose() },
    vscode.commands.registerCommand("phoenix.showStatus", () => {
      const state = client?.registered
        ? client.enabled
          ? "connected and enabled"
          : "connected; enable the Editor capability in Phoenix (Settings → Capabilities)"
        : `not connected: ${client?.problem ?? "unknown"}`;
      void vscode.window.showInformationMessage(`Phoenix: ${state}`);
    }),
  );

  let wasRegistered = false;
  const reconcile = async () => {
    const ok = await client?.reconcile();
    if (ok && !wasRegistered && client?.enabled) announce();
    if (!ok && client?.problem) log(`waiting for Phoenix Core: ${client.problem}`);
    wasRegistered = ok === true;
  };
  await reconcile();
  const timer = setInterval(() => void reconcile(), RECONCILE_MS);
  disposables.push({ dispose: () => clearInterval(timer) });
}

async function deactivate() {
  for (const d of disposables.splice(0)) d.dispose();
  await client?.close();
  client = undefined;
}

module.exports = { activate, deactivate };
