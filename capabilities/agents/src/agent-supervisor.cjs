// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Runs one coding agent on behalf of Phoenix Core and makes sure neither it nor anything it
// started can outlive Core or a stop request.
//
// Channels (set up by Core, see sessions.ts):
//   stdin  - the prompt and later messages; forwarded to the agent's stdin unchanged.
//   stdout / stderr - the agent's output, passed through to Core.
//   fd 3   - a lifeline. Core never writes to it. When Core dies (crash, kill -9) the operating
//            system closes it, we see end-of-file and stop the agent.
//
// The agent runs in its OWN process group, so a stop reaches the whole tree: SIGTERM to the group,
// then SIGKILL to the group after the grace period. A SIGTERM sent to this supervisor means
// "stop" as well. When the agent's leader exits, the group is swept with SIGKILL so a helper it
// left behind does not survive.
//
// Usage: node agent-supervisor.cjs <graceMs> <executable> [fixed args...]
// The prompt is never an argument. The environment is whatever Core passed (an allow-list).
const { spawn } = require("node:child_process");
const net = require("node:net");

const [graceArg, executable, ...args] = process.argv.slice(2);
const graceMs = Number(graceArg);
if (!executable || !Number.isFinite(graceMs) || graceMs < 0) {
  console.error("agent-supervisor: usage: agent-supervisor.cjs <graceMs> <executable> [args...]");
  process.exit(2);
}

const child = spawn(executable, args, {
  stdio: ["pipe", "inherit", "inherit"],
  detached: true,
});
const groupId = child.pid;

let stopping = false;
function signalGroup(signal) {
  if (groupId === undefined) return;
  try {
    process.kill(-groupId, signal);
  } catch {
    // the group is already gone
  }
}

function stop() {
  if (stopping) return;
  stopping = true;
  signalGroup("SIGTERM");
  setTimeout(() => signalGroup("SIGKILL"), graceMs).unref();
}

// A broken pipe to an agent that exited without reading its prompt is not our failure.
child.stdin.on("error", () => {});
process.stdin.on("error", () => {});
process.stdin.pipe(child.stdin);

const lifeline = new net.Socket({ fd: 3, readable: true, writable: false });
lifeline.on("end", stop);
lifeline.on("close", stop);
lifeline.on("error", stop);
lifeline.resume();

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, stop);

child.on("error", (err) => {
  console.error(`agent-supervisor: could not start the agent: ${err.code || err.message}`);
  process.exit(127);
});
child.on("close", (code, signal) => {
  // Anything the agent left behind goes with it.
  signalGroup("SIGKILL");
  process.exit(code ?? (signal ? 128 + (require("node:os").constants.signals[signal] || 0) : 1));
});
