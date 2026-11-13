// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Manual harness entry for Phase 58 (not a vitest test). Bundled by run-in-container.sh and run
// inside a container with a real X server: it calls the PRODUCTION `focuserFor("linux", exec)`
// with the production `execFocus` (wrapped only to record each call), for the project path given
// as argv[2], and prints one JSON line: { title, ok, method?, error?, ms, calls }.
import { execFocus, focuserFor, windowTitle, type FocusExec } from "../../src/terminal-focus";

const project = process.argv[2] ?? "";
const calls: { file: string; argv: readonly string[]; code: number | null; stdout: string }[] = [];
const recording: FocusExec = async (file, argv, env) => {
  const r = await execFocus(file, argv, env);
  calls.push({ file, argv, code: r.code, stdout: r.stdout.slice(0, 200) });
  return r;
};

const started = performance.now();
const base = { title: windowTitle(project) };
try {
  const r = await focuserFor("linux", recording).focus({ project });
  const ms = Math.round(performance.now() - started);
  console.log(JSON.stringify({ ...base, ok: true, method: r.method, ms, calls }));
} catch (e) {
  const ms = Math.round(performance.now() - started);
  console.log(JSON.stringify({ ...base, ok: false, error: (e as Error).message, ms, calls }));
}
