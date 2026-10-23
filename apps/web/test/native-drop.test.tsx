// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
//
// Phase 62, native file drop on the floating and island windows, driven by a fake shell bridge:
// the shell announces numbered files (never a path), the page asks for each number once and posts
// the bytes through the existing attachment route with origin "drop". No real Finder drag, no real
// shell and no real Core is involved.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FileDropRefused,
  NATIVE_DROP_MAX_FILES,
  NATIVE_REFUSAL_REASONS,
  parseDrop,
  tauriFileDrop,
  type FileDropShell,
  type NativeDrop,
} from "../src/commands/file-drop-shell";
import { DROP_LIMITS } from "../src/core/attachments";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { NATIVE_DROP_NOTICE_MS } from "../src/core/native-drop";
import { FloatingApp } from "../src/floating/FloatingApp";
import { IslandApp } from "../src/island/IslandApp";
import type { IslandFrame, IslandShell, PageEvent } from "../src/island/shell";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

// The Rust half of the feature as raw text, to compare its constants with the page's.
const RUST_SHELL = import.meta.glob("../../desktop/src-tauri/src/file_drop.rs", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** `window` as the desktop shell decorates it (withGlobalTauri). */
const tauriGlobal = (): { __TAURI__?: unknown } => window;

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete tauriGlobal().__TAURI__;
});

// ── The fake shell bridge ───────────────────────────────────────────────────────────────────────

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const text = (s: string) => new TextEncoder().encode(s);

interface FakeFileDrop extends FileDropShell {
  /** What `read` returns for each number; a number not here is "not dropped". */
  bytes: Map<number, Uint8Array | FileDropRefused>;
  reads: number[];
  listeners: number;
  drop(drop: Partial<NativeDrop>): void;
  hover(over: boolean): void;
}

function fakeFileDrop(): FakeFileDrop {
  const dropListeners = new Set<(d: NativeDrop) => void>();
  const hoverListeners = new Set<(o: boolean) => void>();
  const shell: FakeFileDrop = {
    bytes: new Map(),
    reads: [],
    get listeners() {
      return dropListeners.size + hoverListeners.size;
    },
    onDrop: async (l) => {
      dropListeners.add(l);
      return () => void dropListeners.delete(l);
    },
    onHover: async (l) => {
      hoverListeners.add(l);
      return () => void hoverListeners.delete(l);
    },
    read: async (id) => {
      shell.reads.push(id);
      const found = shell.bytes.get(id);
      shell.bytes.delete(id); // the shell hands each number out once
      if (found instanceof Uint8Array) return found;
      throw found ?? new FileDropRefused("not_dropped", "not dropped");
    },
    drop: (d) =>
      act(() => {
        for (const l of dropListeners) l({ files: [], refused: [], skipped: 0, ...d });
      }),
    hover: (over) =>
      act(() => {
        for (const l of hoverListeners) l(over);
      }),
  };
  return shell;
}

/** A drop of files whose bytes the fake shell will hand out once each. */
function dropFiles(shell: FakeFileDrop, files: Record<string, Uint8Array>, extra = {}) {
  let id = 100;
  const listed = Object.entries(files).map(([name, bytes]) => {
    id += 1;
    shell.bytes.set(id, bytes);
    return { id, name, size: bytes.length };
  });
  shell.drop({ files: listed, ...extra });
}

const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

function client(routes: Record<string, (body: unknown, url: URL) => unknown> = {}) {
  const api = fakeApi({ "GET /api/pet/settings": () => ({ reduced_motion: "auto" }), ...routes });
  const c = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    minReconnectMs: 3_600_000,
    maxReconnectMs: 3_600_000,
    fetchImpl: api.fetchImpl,
  });
  return { api, c };
}

const uploads = (api: FakeApi) => api.posts("/api/attachments");

function mountFloating(shell: FakeFileDrop | null, routes = {}) {
  const { api, c } = client(routes);
  render(
    <CoreProvider client={c}>
      <FloatingApp shell={null} shortcuts={null} fileDrop={shell} />
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  return api;
}

const FRAME: IslandFrame = {
  state: "small",
  pointer: "poll",
  layout: { rect: { x: 0, y: 0, w: 220, h: 34 }, notch_width: 0, has_notch: false },
};

function fakeIsland(state: IslandFrame["state"]): IslandShell & { sent: PageEvent[] } {
  const sent: PageEvent[] = [];
  return {
    sent,
    connection: async () => ({ base_url: "http://127.0.0.1:4870", token: "tok" }),
    frame: async () => ({ ...FRAME, state }),
    onFrame: async () => () => {},
    send: (e) => sent.push(e),
    openInPhoenix: () => {},
    showMenu: () => {},
  };
}

async function mountIsland(shell: FakeFileDrop | null, state: IslandFrame["state"] = "small") {
  const { api, c } = client();
  const island = fakeIsland(state);
  render(
    <CoreProvider client={c}>
      <IslandApp shell={island} shortcuts={null} fileDrop={shell} />
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  await settle();
  return { api, island };
}

const status = () => screen.queryByRole("status");

// ── The floating window ─────────────────────────────────────────────────────────────────────────

describe("a file dropped on the floating Fawkes window", () => {
  beforeEach(() => vi.useFakeTimers());

  it("a text file is asked for by number, posted with origin drop and reported", async () => {
    const shell = fakeFileDrop();
    const api = mountFloating(shell);
    await settle();
    dropFiles(shell, { "notes.md": text("# Plan\nship it") });
    await settle();
    expect(shell.reads).toEqual([101]);
    expect(uploads(api).map((c) => c.body)).toEqual([
      {
        name: "notes.md",
        kind: "text",
        mime: "text/plain",
        origin: "drop",
        content: "# Plan\nship it",
      },
    ]);
    expect(status()?.textContent).toBe("Attached 1 item. Nothing has been sent anywhere yet.");
  });

  it("a PNG is posted as an image with its base64 and origin drop", async () => {
    // FileReader (the existing image path) needs real timers in happy-dom.
    vi.useRealTimers();
    const shell = fakeFileDrop();
    const api = mountFloating(shell);
    await act(async () => {});
    dropFiles(shell, { "shot.png": PNG });
    await waitFor(() => expect(uploads(api)).toHaveLength(1));
    expect(uploads(api).map((c) => c.body)).toEqual([
      {
        name: "shot.png",
        kind: "image",
        mime: "image/png",
        origin: "drop",
        content: btoa(String.fromCharCode(...PNG)),
      },
    ]);
  });

  it("several files are each read once and posted in order", async () => {
    const shell = fakeFileDrop();
    const api = mountFloating(shell);
    await settle();
    dropFiles(shell, { "a.txt": text("a"), "b.txt": text("b"), "c.txt": text("c") });
    await settle();
    expect(shell.reads).toEqual([101, 102, 103]);
    expect(uploads(api).map((c) => (c.body as { name: string }).name)).toEqual([
      "a.txt",
      "b.txt",
      "c.txt",
    ]);
    expect(status()?.textContent).toMatch(/^Attached 3 items\./);
  });

  it("the drag over the window shows the drop-zone words and leaving clears them", async () => {
    const shell = fakeFileDrop();
    mountFloating(shell);
    await settle();
    expect(status()).toBeNull();
    shell.hover(true);
    expect(status()?.textContent).toBe("Drop to attach.");
    expect(document.querySelector(".floating-root")?.getAttribute("data-drop-over")).toBe("true");
    shell.hover(false);
    expect(status()).toBeNull();
    expect(document.querySelector(".floating-root")?.getAttribute("data-drop-over")).toBe("false");
  });

  it("files are refused with the chat box's own messages and never posted", async () => {
    const shell = fakeFileDrop();
    const api = mountFloating(shell);
    await settle();
    dropFiles(
      shell,
      {
        "movie.mov": text("binary"),
        "a\u202Eb.txt": text("hello"),
        "empty.txt": text(""),
        "big.txt": text("y".repeat(DROP_LIMITS.textChars + 1)),
      },
      {},
    );
    await settle();
    expect(uploads(api)).toEqual([]);
    const said = status()?.textContent ?? "";
    expect(said).toContain("Nothing was attached.");
    expect(said).toContain("movie.mov: not a supported type");
    expect(said).toContain("the name is empty, too long, or contains hidden characters");
    expect(said).toContain("empty.txt: the file is empty");
    expect(said).toContain("big.txt: too large (200,001 characters; the limit is 200,000)");
    expect(status()?.getAttribute("data-drop")).toBe("problem");
  });

  it("entries the shell refused are reported and the others still go through", async () => {
    const shell = fakeFileDrop();
    const api = mountFloating(shell);
    await settle();
    dropFiles(
      shell,
      { "ok.txt": text("fine") },
      {
        refused: [
          { name: "project", size: 0, reason: "folder" },
          { name: "huge.png", size: 9_000_000, reason: "too_large" },
          { name: "huge.txt", size: 9_000_000, reason: "too_large" },
          { name: "huge.bin", size: 9_000_000, reason: "too_large" },
          { name: "link.txt", size: 0, reason: "not_a_file" },
          { name: "gone.txt", size: 0, reason: "unreadable" },
          { name: "bad\u0007.txt", size: 0, reason: "bad_path" },
        ],
        skipped: 2,
      },
    );
    await settle();
    expect(uploads(api)).toHaveLength(1);
    const said = status()?.textContent ?? "";
    expect(said).toMatch(/^Attached 1 item\./);
    expect(said).toContain("project: a folder cannot be dropped here");
    expect(said).toContain("huge.png: an image can be at most 5 MiB");
    expect(said).toContain("huge.txt: too large (a text file can have at most 200,000 characters)");
    expect(said).toContain("huge.bin: not a supported type");
    expect(said).toContain("link.txt: not a supported type");
    expect(said).toContain("gone.txt: the file could not be read");
    expect(said).toContain("bad?.txt: the name is empty");
    expect(said).toContain("Only the first 3 files of a drop are used; 2 more were ignored.");
  });

  it("a refusal from Core is shown with its message and the rest of the drop goes through", async () => {
    const shell = fakeFileDrop();
    let calls = 0;
    const api = mountFloating(shell, {
      "POST /api/attachments": () =>
        ++calls === 1
          ? new Response(
              JSON.stringify({
                code: "INVALID_REQUEST",
                message: "At most 10 attachments at once. Remove one first.",
              }),
              { status: 400 },
            )
          : { id: "att_2" },
    });
    await settle();
    dropFiles(shell, { "one.txt": text("1"), "two.txt": text("2") });
    await settle();
    expect(uploads(api)).toHaveLength(2);
    expect(status()?.textContent).toContain(
      "one.txt: At most 10 attachments at once. Remove one first.",
    );
    expect(status()?.textContent).toMatch(/^Attached 1 item\./);
  });

  it("a file the shell will not hand over is reported as unreadable and nothing is posted", async () => {
    const shell = fakeFileDrop();
    const api = mountFloating(shell);
    await settle();
    // Number 7 was never issued (or already used): the shell answers not_dropped.
    shell.drop({ files: [{ id: 7, name: "stale.txt", size: 3 }] });
    await settle();
    expect(shell.reads).toEqual([7]);
    expect(uploads(api)).toEqual([]);
    expect(status()?.textContent).toBe(
      "Nothing was attached. stale.txt: the file could not be read",
    );
  });

  it("a file the shell reports as too large on the read gets the size message", async () => {
    const shell = fakeFileDrop();
    const api = mountFloating(shell);
    await settle();
    shell.bytes.set(5, new FileDropRefused("too_large", "The file is too large."));
    shell.drop({ files: [{ id: 5, name: "grew.png", size: 100 }] });
    await settle();
    expect(uploads(api)).toEqual([]);
    expect(status()?.textContent).toContain("grew.png: an image can be at most 5 MiB");
  });

  it("a drop that arrives while another is being read is ignored", async () => {
    const shell = fakeFileDrop();
    const api = mountFloating(shell);
    await settle();
    const gate = Promise.withResolvers<void>();
    const read = shell.read;
    shell.read = async (id) => {
      await gate.promise;
      return read(id);
    };
    dropFiles(shell, { "first.txt": text("1") });
    await settle();
    shell.drop({ files: [{ id: 999, name: "second.txt", size: 1 }] });
    await settle();
    gate.resolve();
    await settle();
    expect(shell.reads).toEqual([101]);
    expect(uploads(api).map((c) => (c.body as { name: string }).name)).toEqual(["first.txt"]);
  });

  it("the result goes away by itself after a few seconds", async () => {
    const shell = fakeFileDrop();
    mountFloating(shell);
    await settle();
    dropFiles(shell, { "a.txt": text("a") });
    await settle();
    expect(status()).not.toBeNull();
    await act(async () => void (await vi.advanceTimersByTimeAsync(NATIVE_DROP_NOTICE_MS - 1)));
    expect(status()).not.toBeNull();
    await act(async () => void (await vi.advanceTimersByTimeAsync(2)));
    expect(status()).toBeNull();
  });

  it("without a shell (an ordinary browser) nothing is listened to and nothing is drawn", async () => {
    const shell = fakeFileDrop();
    mountFloating(null);
    await settle();
    expect(shell.listeners).toBe(0);
    expect(status()).toBeNull();
  });

  it("stops listening when the window closes", async () => {
    const shell = fakeFileDrop();
    mountFloating(shell);
    await settle();
    expect(shell.listeners).toBe(2);
    cleanup();
    expect(shell.listeners).toBe(0);
  });
});

// ── The island ──────────────────────────────────────────────────────────────────────────────────

describe("a file dropped on the Fawkes island", () => {
  beforeEach(() => vi.useFakeTimers());

  it("a text file is posted with origin drop and the result replaces the state label", async () => {
    const shell = fakeFileDrop();
    const { api } = await mountIsland(shell);
    expect(document.querySelector(".island-label")?.textContent).not.toMatch(/Attached/);
    dropFiles(shell, { "notes.md": text("# Plan") });
    await settle();
    expect(uploads(api).map((c) => c.body)).toEqual([
      { name: "notes.md", kind: "text", mime: "text/plain", origin: "drop", content: "# Plan" },
    ]);
    expect(document.querySelector(".island-label")?.textContent).toMatch(/^Attached 1 item\./);
  });

  it("the drag over the island shows the drop-zone words", async () => {
    const shell = fakeFileDrop();
    await mountIsland(shell);
    shell.hover(true);
    expect(document.querySelector(".island-label")?.textContent).toBe("Drop to attach.");
    expect(document.querySelector(".island-root")?.getAttribute("data-drop-over")).toBe("true");
    shell.hover(false);
    expect(document.querySelector(".island-label")?.textContent).not.toBe("Drop to attach.");
  });

  it("an expanded island shows the result in its body and refusals use the existing messages", async () => {
    const shell = fakeFileDrop();
    const { api } = await mountIsland(shell, "expanded");
    dropFiles(
      shell,
      { "movie.mov": text("x") },
      { refused: [{ name: "dir", size: 0, reason: "folder" }] },
    );
    await settle();
    expect(uploads(api)).toEqual([]);
    const body = document.querySelector(".island-body .island-drop")?.textContent ?? "";
    expect(body).toContain("movie.mov: not a supported type");
    expect(body).toContain("dir: a folder cannot be dropped here");
  });

  it("keeps the island awake while a drag, a read or a result is on screen", async () => {
    const shell = fakeFileDrop();
    const { island } = await mountIsland(shell);
    const lastActivity = () =>
      [...island.sent].reverse().find((e) => e.kind === "activity") as
        Extract<PageEvent, { kind: "activity" }> | undefined;
    expect(lastActivity()).toEqual({ kind: "activity", active: false, urgent: false });
    shell.hover(true);
    expect(lastActivity()).toEqual({ kind: "activity", active: true, urgent: false });
    shell.hover(false);
    expect(lastActivity()?.active).toBe(false);
    dropFiles(shell, { "a.txt": text("a") });
    await settle();
    expect(lastActivity()).toEqual({ kind: "activity", active: true, urgent: false });
    await act(async () => void (await vi.advanceTimersByTimeAsync(NATIVE_DROP_NOTICE_MS + 1)));
    expect(lastActivity()?.active).toBe(false);
  });

  it("without a shell nothing is listened to", async () => {
    const shell = fakeFileDrop();
    await mountIsland(null);
    expect(shell.listeners).toBe(0);
  });
});

// ── The bridge to the real shell ────────────────────────────────────────────────────────────────

describe("the Tauri file-drop bridge", () => {
  type Handler = (event: { payload: unknown }) => void;

  type FakeInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

  function install(invoke: FakeInvoke) {
    const handlers = new Map<string, Handler>();
    tauriGlobal().__TAURI__ = {
      core: { invoke },
      event: {
        listen: async (event: string, handler: Handler) => {
          handlers.set(event, handler);
          return () => void handlers.delete(event);
        },
      },
    };
    return handlers;
  }

  it("is null outside the desktop shell and without events", () => {
    expect(tauriFileDrop()).toBeNull();
    tauriGlobal().__TAURI__ = { core: { invoke: async () => 1 } };
    expect(tauriFileDrop()).toBeNull();
  });

  it("reads a file only through read_dropped_file with a number, never a path", async () => {
    const calls: [string, unknown][] = [];
    install(async (command, args) => {
      calls.push([command, args]);
      return new Uint8Array([1, 2, 3]).buffer;
    });
    const shell = tauriFileDrop()!;
    expect(await shell.read(41)).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls).toEqual([["read_dropped_file", { id: 41 }]]);
  });

  it("maps a shell refusal to FileDropRefused and a malformed answer to unknown", async () => {
    let answer: unknown;
    install(async () => {
      if (answer instanceof Error) throw answer;
      if (typeof answer === "object" && answer !== null && "code" in answer) throw answer;
      return answer;
    });
    const shell = tauriFileDrop()!;
    answer = { code: "not_dropped", message: "That file was not just dropped." };
    await expect(shell.read(1)).rejects.toMatchObject({
      name: "Error",
      code: "not_dropped",
      message: "That file was not just dropped.",
    });
    answer = "a string";
    await expect(shell.read(1)).rejects.toMatchObject({ code: "unknown" });
    answer = new Error("boom");
    await expect(shell.read(1)).rejects.toMatchObject({ code: "unknown", message: "boom" });
  });

  it("delivers drops and hover from the shell's events and drops malformed ones", async () => {
    const handlers = install(async () => new ArrayBuffer(0));
    const shell = tauriFileDrop()!;
    const drops: NativeDrop[] = [];
    const hovers: boolean[] = [];
    await shell.onDrop((d) => drops.push(d));
    await shell.onHover((o) => hovers.push(o));
    const good = {
      files: [{ id: 1, name: "a.txt", size: 2 }],
      refused: [{ name: "d", size: 0, reason: "folder" }],
      skipped: 0,
    };
    handlers.get("file-drop://drop")!({ payload: good });
    handlers.get("file-drop://drop")!({ payload: "nope" });
    handlers.get("file-drop://drop")!({ payload: { files: "x", refused: [] } });
    handlers.get("file-drop://hover")!({ payload: { over: true } });
    handlers.get("file-drop://hover")!({ payload: { over: "yes" } });
    expect(drops).toEqual([good]);
    expect(hovers).toEqual([true]);
  });

  it("parseDrop keeps only well-formed entries, at most three of each, and never a path", () => {
    expect(
      parseDrop({
        files: [
          { id: 1, name: "a.txt", size: 1, path: "/Users/me/a.txt" },
          { id: -1, name: "negative", size: 1 },
          { id: 1.5, name: "fraction", size: 1 },
          { id: 2, name: 7, size: 1 },
          { id: 3, name: "b.txt", size: Number.NaN },
          { id: 4, name: "c.txt", size: 3 },
          { id: 5, name: "d.txt", size: 4 },
          { id: 6, name: "e.txt", size: 5 },
          { id: 7, name: "f.txt", size: 6 },
        ],
        refused: [
          { name: "x", size: 0, reason: "folder" },
          { name: "y", size: 0, reason: "something_else" },
        ],
        skipped: 4,
      }),
    ).toEqual({
      files: [
        { id: 1, name: "a.txt", size: 1 },
        { id: 4, name: "c.txt", size: 3 },
        { id: 5, name: "d.txt", size: 4 },
      ],
      refused: [{ name: "x", size: 0, reason: "folder" }],
      skipped: 4,
    });
    expect(parseDrop({ files: [], refused: [], skipped: -3 })?.skipped).toBe(0);
    expect(parseDrop(null)).toBeNull();
    expect(parseDrop({ files: [] })).toBeNull();
  });

  it("uses the same limits as the Rust shell", () => {
    const rust = Object.values(RUST_SHELL)[0] ?? "";
    const count = /pub const MAX_PATHS: usize = (\d+);/u.exec(rust);
    expect(Number(count?.[1])).toBe(NATIVE_DROP_MAX_FILES);
    const bytes = /pub const MAX_FILE_BYTES: u64 = (\d+) \* 1024 \* 1024;/u.exec(rust);
    expect(Number(bytes?.[1]) * 1024 * 1024).toBe(DROP_LIMITS.imageBytes);
    for (const reason of NATIVE_REFUSAL_REASONS) {
      const pascal = reason.replace(/(^|_)(\w)/gu, (_m, _s, c: string) => c.toUpperCase());
      expect(rust).toContain(pascal);
    }
  });
});
