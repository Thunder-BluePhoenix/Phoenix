// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A small unified diff (line based) for the installer preview. The preview is what the user
// confirms, so it must be exact: every changed line of the target file appears in it.
const CONTEXT = 3;
/** Above this many cells the middle part is shown as one replaced block instead of a minimal diff. */
const MAX_CELLS = 4_000_000;
const NO_NEWLINE = "\\ No newline at end of file\n";

interface Op {
  kind: " " | "-" | "+";
  text: string;
}

/** Splits into lines that keep their "\n", so "a" and "a\n" differ. */
function toLines(text: string): string[] {
  if (text === "") return [];
  const parts = text.split("\n");
  const last = parts.pop()!;
  const lines = parts.map((p) => p + "\n");
  if (last !== "") lines.push(last);
  return lines;
}

function lcsOps(a: string[], b: string[]): Op[] {
  if (a.length * b.length > MAX_CELLS) {
    return [
      ...a.map((text): Op => ({ kind: "-", text })),
      ...b.map((text): Op => ({ kind: "+", text })),
    ];
  }
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: " ", text: a[i]! });
      i++;
      j++;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      ops.push({ kind: "-", text: a[i++]! });
    } else {
      ops.push({ kind: "+", text: b[j++]! });
    }
  }
  while (i < a.length) ops.push({ kind: "-", text: a[i++]! });
  while (j < b.length) ops.push({ kind: "+", text: b[j++]! });
  return ops;
}

function diffOps(before: string[], after: string[]): Op[] {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }
  return [
    ...before.slice(0, head).map((text): Op => ({ kind: " ", text })),
    ...lcsOps(before.slice(head, before.length - tail), after.slice(head, after.length - tail)),
    ...before.slice(before.length - tail).map((text): Op => ({ kind: " ", text })),
  ];
}

/**
 * Unified diff from `before` to `after`. `null` means the file does not exist (shown against
 * /dev/null). Identical texts give "". Carriage returns stay in the lines, so a CRLF file keeps
 * its line endings in the diff.
 */
export function unifiedDiff(path: string, before: string | null, after: string | null): string {
  if (before === after) return "";
  const ops = diffOps(toLines(before ?? ""), toLines(after ?? ""));

  // Hunks: runs of changes with CONTEXT lines around them, merged when they touch.
  const hunks: { from: number; to: number }[] = [];
  ops.forEach((op, index) => {
    if (op.kind === " ") return;
    const from = Math.max(0, index - CONTEXT);
    const to = Math.min(ops.length, index + CONTEXT + 1);
    const last = hunks[hunks.length - 1];
    if (last && from <= last.to) last.to = Math.max(last.to, to);
    else hunks.push({ from, to });
  });
  if (hunks.length === 0) return "";

  const header =
    `--- ${before === null ? "/dev/null" : `a/${path}`}\n` +
    `+++ ${after === null ? "/dev/null" : `b/${path}`}\n`;
  const body = hunks.map(({ from, to }) => {
    let oldStart = 1;
    let newStart = 1;
    for (const op of ops.slice(0, from)) {
      if (op.kind !== "+") oldStart++;
      if (op.kind !== "-") newStart++;
    }
    const slice = ops.slice(from, to);
    const oldCount = slice.filter((o) => o.kind !== "+").length;
    const newCount = slice.filter((o) => o.kind !== "-").length;
    const oldFrom = oldCount === 0 ? oldStart - 1 : oldStart;
    const newFrom = newCount === 0 ? newStart - 1 : newStart;
    const lines = slice.map((op) => {
      const marked = op.kind + op.text;
      return op.text.endsWith("\n") ? marked : `${marked}\n${NO_NEWLINE}`;
    });
    return `@@ -${oldFrom},${oldCount} +${newFrom},${newCount} @@\n${lines.join("")}`;
  });
  return header + body.join("");
}
