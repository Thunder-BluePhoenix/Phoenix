// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Length-prefixed JSON frames between the Stream Deck plugin and its local host (the same wire
// format as the "Send page to Phoenix" native-messaging host, apps/extension/host/host.js): a
// 4-byte length in the machine's byte order, then UTF-8 JSON. The plugin bundle must be
// self-contained once copied into Stream Deck's plugin folder, so this is a small copy, not an import.
import { endianness } from "node:os";

const LITTLE = endianness() === "LE";

/** One frame: a 4-byte length, then the JSON body. */
export function encodeFrame(value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const head = Buffer.alloc(4);
  if (LITTLE) head.writeUInt32LE(body.length, 0);
  else head.writeUInt32BE(body.length, 0);
  return Buffer.concat([head, body]);
}

/**
 * Reads exactly one frame from a readable stream. Rejects (with a `code`) for a length over the cap
 * before reading the body, for a stream that ends early and for JSON that does not parse.
 */
export function readFrame(input, maxBytes) {
  return new Promise((resolveFrame, reject) => {
    const chunks = [];
    let have = 0;
    let need = -1;
    const fail = (code) => {
      cleanup();
      reject(Object.assign(new Error(code), { code }));
    };
    const finish = (buffer) => {
      cleanup();
      try {
        resolveFrame(JSON.parse(buffer.toString("utf8")));
      } catch {
        reject(Object.assign(new Error("bad_json"), { code: "bad_json" }));
      }
    };
    const onData = (chunk) => {
      chunks.push(chunk);
      have += chunk.length;
      const all = Buffer.concat(chunks);
      if (need < 0 && have >= 4) {
        need = LITTLE ? all.readUInt32LE(0) : all.readUInt32BE(0);
        if (need > maxBytes) return fail("frame_too_large");
      }
      if (need >= 0 && have >= 4 + need) finish(all.subarray(4, 4 + need));
    };
    const onEnd = () => fail(need < 0 ? "no_message" : "truncated");
    const onError = () => fail("stream_error");
    const cleanup = () => {
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("error", onError);
      input.pause?.();
    };
    input.on("data", onData);
    input.on("end", onEnd);
    input.on("error", onError);
  });
}
