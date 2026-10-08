// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Runs Kage's bot on behalf of Phoenix Core and makes sure it cannot outlive Core.
//
// Why: the bot records a meeting. If Core is killed (crash, kill -9, power loss) a plain child
// process is re-parented to init and keeps recording for up to two hours, while the restarted
// Core shows no recording indicator. Core talks to this process over a stdin pipe it never
// writes to; when Core dies the operating system closes that pipe, we see end-of-file, and we
// stop the bot. A stop request (SIGTERM from Core's disable / emergency stop) is forwarded too,
// and a bot that ignores it is killed after a grace period.
//
// Usage: node bot-supervisor.cjs <bot.js> [bot args...]   (KAGE_API_KEY is inherited)
const { spawn } = require("node:child_process");

const [botPath, ...botArgs] = process.argv.slice(2);
if (!botPath) {
  console.error("bot-supervisor: missing bot path");
  process.exit(2);
}
const graceMs = Number(process.env.KAGE_BOT_GRACE_MS) || 5000;

const child = spawn(process.execPath, [botPath, ...botArgs], {
  stdio: ["ignore", "inherit", "inherit"],
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), graceMs).unref();
}

process.stdin.on("end", stop);
process.stdin.on("error", stop);
process.stdin.resume();
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, stop);

child.on("error", (err) => {
  console.error(err.message);
  process.exit(1);
});
child.on("close", (code) => process.exit(code ?? 1));
