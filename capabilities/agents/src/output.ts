// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What a coding agent prints, kept for the user to read and nothing else. The text is hostile
// input: it can contain terminal escape sequences, enormous lines, credentials and JSON that
// looks like Phoenix events. This ring buffer keeps a bounded tail of lines that are stripped
// of control characters and redacted BEFORE they are stored. It never parses anything, and its
// content is never put into an event.
import { StringDecoder } from "node:string_decoder";
import { redact } from "@phoenix/logging";

export const DEFAULT_MAX_LINES = 500;
export const DEFAULT_MAX_LINE_CHARS = 2_000;
/** Raw characters read for one line before the rest of it is thrown away. */
const RAW_LINE_FACTOR = 2;
/**
 * A cut line loses its last characters too: a credential that straddles the cut would otherwise
 * show a prefix too short for the redaction patterns to recognise.
 */
const CUT_MARGIN = 64;

const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g;
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]?/g;
const OTHER_ESCAPE = /\u001b[@-Z\\-_]?/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/** Removes terminal escape sequences and control characters; keeps printable text and tabs. */
export function sanitizeLine(raw: string): string {
  return raw
    .replace(OSC, "")
    .replace(CSI, "")
    .replace(OTHER_ESCAPE, "")
    .replace(/\t/g, " ")
    .replace(CONTROL, "");
}

export interface OutputStats {
  /** Lines currently held. */
  lines: number;
  /** Lines pushed out of the ring (or never kept) because it was full. */
  dropped_lines: number;
  /** Lines cut because they were longer than the line limit. */
  truncated_lines: number;
  /** Bytes read from the process, retained or not. */
  bytes_seen: number;
}

export interface OutputRingOptions {
  maxLines?: number;
  maxLineChars?: number;
}

export class OutputRing {
  private readonly maxLines: number;
  private readonly maxLineChars: number;
  private readonly decoder = new StringDecoder("utf8");
  private readonly held: string[] = [];
  private pending = "";
  private pendingCut = false;
  private dropped = 0;
  private cut = 0;
  private seen = 0;

  constructor(options: OutputRingOptions = {}) {
    this.maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
    this.maxLineChars = options.maxLineChars ?? DEFAULT_MAX_LINE_CHARS;
  }

  /** Takes a chunk of process output; returns the lines it completed (sanitised and redacted). */
  feed(chunk: Buffer | string): string[] {
    this.seen += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
    const text = this.decoder.write(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    const completed: string[] = [];
    const parts = text.split(/\r\n|\n|\r/);
    for (const [i, part] of parts.entries()) {
      this.accumulate(part);
      if (i < parts.length - 1) completed.push(this.finishLine());
    }
    return completed;
  }

  /** Ends the stream: a final line without a newline is kept. Returns it, if any. */
  end(): string | undefined {
    this.accumulate(this.decoder.end());
    if (this.pending.length === 0 && !this.pendingCut) return undefined;
    return this.finishLine();
  }

  /** The last `n` lines, oldest first. */
  tail(n: number): string[] {
    return n <= 0 ? [] : this.held.slice(-n);
  }

  stats(): OutputStats {
    return {
      lines: this.held.length,
      dropped_lines: this.dropped,
      truncated_lines: this.cut,
      bytes_seen: this.seen,
    };
  }

  /** Forgets everything held (the session is gone). */
  clear(): void {
    this.held.length = 0;
    this.pending = "";
    this.pendingCut = false;
  }

  private accumulate(part: string): void {
    const room = this.maxLineChars * RAW_LINE_FACTOR - this.pending.length;
    if (part.length > room) this.pendingCut = true;
    if (room > 0) this.pending += part.slice(0, room);
  }

  private finishLine(): string {
    let line = redact(sanitizeLine(this.pending)) as string;
    if (this.pendingCut || line.length > this.maxLineChars) {
      line = `${line.slice(0, Math.max(0, this.maxLineChars - CUT_MARGIN))}…[cut]`;
      this.cut++;
    }
    this.pending = "";
    this.pendingCut = false;
    this.held.push(line);
    if (this.held.length > this.maxLines) {
      this.held.shift();
      this.dropped++;
    }
    return line;
  }
}
