// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Runs extension.js (the thin VS Code shell) against a STUB of the `vscode` module and a real
// in-process Phoenix Core. This proves the wiring (activation, registration, task and diagnostics
// notifications → Core → Fawkes) but NOT that VS Code itself loads the extension: the stub is
// written from the documented API and may differ from the real one.
import { createRequire } from "node:module";
import Module from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCore, TOKEN } from "../../../core/runtime/test/helpers";

type Listener<T> = (e: T) => void;
function emitter<T>() {
  const listeners: Listener<T>[] = [];
  return {
    event: (l: Listener<T>) => {
      listeners.push(l);
      return { dispose: () => listeners.splice(listeners.indexOf(l), 1) };
    },
    fire: (e: T) => listeners.forEach((l) => l(e)),
  };
}

interface Execution {
  task: { name: string; source: string; definition: { type: string } };
}

function makeVscode(coreUrl: string) {
  const start = emitter<{ execution: Execution }>();
  const end = emitter<{ execution: Execution; exitCode: number | undefined }>();
  const diag = emitter<unknown>();
  let diagnostics: [string, { severity: number }[]][] = [];
  const messages: string[] = [];
  const commands: Record<string, () => void> = {};
  const api = {
    window: {
      createOutputChannel: () => ({ appendLine: () => {}, dispose: () => {} }),
      showWarningMessage: (m: string) => void messages.push(m),
      showInformationMessage: (m: string) => void messages.push(m),
    },
    workspace: {
      name: "phoenix-test",
      isTrusted: true,
      workspaceFolders: [{ uri: { fsPath: "/private/path/that/must/not/leak" } }],
      getConfiguration: () => ({ get: () => coreUrl }),
    },
    tasks: { onDidStartTaskProcess: start.event, onDidEndTaskProcess: end.event },
    languages: {
      onDidChangeDiagnostics: diag.event,
      getDiagnostics: () => diagnostics,
    },
    commands: {
      registerCommand: (id: string, fn: () => void) => {
        commands[id] = fn;
        return { dispose: () => {} };
      },
    },
  };
  return {
    api,
    start,
    end,
    diag,
    messages,
    commands,
    setDiagnostics: (d: typeof diagnostics) => (diagnostics = d),
  };
}

const require = createRequire(import.meta.url);
type ModuleLoad = (request: string, parent: unknown, isMain: boolean) => unknown;
const internals = Module as unknown as { _load: ModuleLoad };
const originalLoad = internals._load;
let stops: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  internals._load = originalLoad;
  for (const stop of stops.splice(0).reverse()) await stop();
  vi.useRealTimers();
});

async function activate(coreUrl: string, stub = makeVscode(coreUrl)) {
  internals._load = (request, parent, isMain) =>
    request === "vscode" ? stub.api : originalLoad(request, parent, isMain);
  process.env.PHOENIX_SESSION_TOKEN = TOKEN;
  stops.push(() => void delete process.env.PHOENIX_SESSION_TOKEN);
  const path = require.resolve("../extension.js");
  delete require.cache[path];
  const extension = require(path) as {
    activate(ctx: { subscriptions: unknown[] }): Promise<void>;
    deactivate(): Promise<void>;
  };
  await extension.activate({ subscriptions: [] });
  stops.push(() => extension.deactivate());
  return stub;
}

describe("extension.js with a stubbed vscode API and a real Core", () => {
  it("registers the editor capability and reports tasks and the workspace once enabled", async () => {
    const core = await startCore();
    stops.push(() => core.runtime.stop());
    const vs = await activate(core.base);
    expect((await core.api("GET", "/api/capabilities/editor")).json).toMatchObject({
      kind: "external",
      status: "installed",
    });

    await core.api("POST", "/api/capabilities/editor/enable", {});
    const exec: Execution = {
      task: { name: "build", source: "Workspace", definition: { type: "shell" } },
    };
    await vi.waitFor(async () => {
      vs.start.fire({ execution: exec });
      expect((await core.api("GET", "/api/pet/state")).json).toMatchObject({
        state: "WORKING",
        explanation: "Task build running",
      });
    });
    vs.end.fire({ execution: exec, exitCode: 1 });
    await vi.waitFor(async () =>
      expect((await core.api("GET", "/api/pet/state")).json).toMatchObject({
        state: "ERROR",
        explanation: "Task build failed",
      }),
    );
  });

  it("sends diagnostics as counts only, after the quiet period", async () => {
    const core = await startCore();
    stops.push(() => core.runtime.stop());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const vs = await activate(core.base);
    await core.api("POST", "/api/capabilities/editor/enable", {});
    vs.setDiagnostics([
      ["file:///private/path/secret.ts", [{ severity: 0 }, { severity: 0 }, { severity: 1 }]],
    ]);
    vs.diag.fire({});
    await vi.advanceTimersByTimeAsync(3_100);
    vi.useRealTimers();
    await vi.waitFor(async () => {
      const events = (await core.api("GET", "/api/events?source=editor&limit=50")).json.events as {
        event: { event_type: string; payload: unknown };
      }[];
      const e = events.find((x) => x.event.event_type === "editor.diagnostics.changed");
      expect(e?.event.payload).toEqual({
        errors: 2,
        warnings: 1,
        previous_errors: 0,
        previous_warnings: 0,
      });
    });
    const all = JSON.stringify((await core.api("GET", "/api/events?limit=200")).json);
    expect(all).not.toContain("secret.ts");
    expect(all).not.toContain("/private/path");
  });

  it("refuses a non-loopback Core URL and never contacts it", async () => {
    const vs = makeVscode("http://203.0.113.9:4870");
    const fetched = vi.spyOn(globalThis, "fetch");
    stops.push(() => fetched.mockRestore());
    await activate("http://203.0.113.9:4870", vs);
    expect(vs.messages.join(" ")).toMatch(/loopback/);
    expect(fetched).not.toHaveBeenCalled();
  });

  it("starts quietly when Core is not running and the status command says why", async () => {
    const vs = await activate("http://127.0.0.1:1");
    vs.commands["phoenix.showStatus"]!();
    expect(vs.messages.join(" ")).toMatch(/not connected: Phoenix Core is not running/);
  });
});
