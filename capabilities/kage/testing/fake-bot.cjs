// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Prints the same progress lines as Kage's bot/bot.js, without Chrome or audio.
// FAKE_BOT_EXIT sets the exit code; FAKE_BOT_HOLD_MS keeps it "recording" that long.
const key = process.env.KAGE_API_KEY;
if (!key || process.argv.some((a) => a.includes(key))) {
  console.error("API key must arrive via KAGE_API_KEY, not argv");
  process.exit(3);
}
console.log(`KAGE bot: joining ${process.argv[2]} as "KAGE Bot"`);
console.log("admitted — starting audio capture");
console.log("recording (will stop on meeting end, or after 120min)...");
setTimeout(
  () => {
    const code = Number(process.env.FAKE_BOT_EXIT ?? 0);
    if (code) console.error("upload failed: 500 boom");
    else console.log("done — meeting id 42, check the KAGE dashboard");
    process.exit(code);
  },
  Number(process.env.FAKE_BOT_HOLD_MS ?? 50),
);
