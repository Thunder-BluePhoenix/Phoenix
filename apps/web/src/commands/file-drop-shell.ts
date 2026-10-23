// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What the floating and island pages may ask of the desktop shell about a file dropped on the
// window itself (Phase 62; apps/desktop file_drop.rs and the `read_dropped_file` command in lib.rs).
// On those two windows the operating system's drop never reaches the page as an HTML5 `drop`
// event: the shell receives Tauri's native drag-and-drop event, checks every path and announces
// the files with a number, a name and a size, never a path. The page then asks for each number
// once, and the shell returns the bytes. Like DesktopShell and ShortcutsShell this is the only
// place that knows the command and event names, so the pages take a `FileDropShell` and tests
// pass a fake.

/** Most files of one drop the shell looks at (file_drop.rs `MAX_PATHS`; a test compares them). */
export const NATIVE_DROP_MAX_FILES = 3;

/** The reasons the shell gives for an entry it did not take (file_drop.rs `Reason`). */
export const NATIVE_REFUSAL_REASONS = [
  "bad_path",
  "folder",
  "not_a_file",
  "too_large",
  "unreadable",
] as const;
export type NativeRefusalReason = (typeof NATIVE_REFUSAL_REASONS)[number];

/** A file the shell took: ask for `id` to get its bytes. */
export interface DroppedFileInfo {
  id: number;
  name: string;
  size: number;
}

/** An entry the shell did not take. */
export interface RefusedDropEntry {
  name: string;
  size: number;
  reason: NativeRefusalReason;
}

/** What one drop became (the `file-drop://drop` event). */
export interface NativeDrop {
  files: DroppedFileInfo[];
  refused: RefusedDropEntry[];
  /** Entries past the shell's per-drop limit, not looked at. */
  skipped: number;
}

/** A command the shell refused: `code` is machine-readable (not_dropped, forbidden, too_large, ...). */
export class FileDropRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface FileDropShell {
  /** Calls back for every drop on this window; returns the unsubscribe. A malformed event is dropped. */
  onDrop(listener: (drop: NativeDrop) => void): Promise<() => void>;
  /** Calls back when a file drag enters (`true`) or leaves, drops or is cancelled (`false`). */
  onHover(listener: (over: boolean) => void): Promise<() => void>;
  /** The bytes of a file announced by `onDrop`. Works once per number; rejects with FileDropRefused. */
  read(id: number): Promise<Uint8Array>;
}

export const DROP_EVENT = "file-drop://drop";
export const HOVER_EVENT = "file-drop://hover";

/** The value of a field of an untrusted object, `undefined` when it is not an object or lacks it. */
function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null && name in value
    ? (value as Record<string, unknown>)[name]
    : undefined;
}

const isReason = (v: unknown): v is NativeRefusalReason =>
  NATIVE_REFUSAL_REASONS.some((r) => r === v);

/** A drop from the shell, checked: anything malformed is dropped rather than trusted. */
export function parseDrop(value: unknown): NativeDrop | null {
  const files: DroppedFileInfo[] = [];
  const refused: RefusedDropEntry[] = [];
  const listed = field(value, "files");
  const refusedList = field(value, "refused");
  const skipped = field(value, "skipped");
  if (!Array.isArray(listed) || !Array.isArray(refusedList)) return null;
  for (const item of listed) {
    const id = field(item, "id");
    const name = field(item, "name");
    const size = field(item, "size");
    if (
      typeof id === "number" &&
      Number.isSafeInteger(id) &&
      id >= 0 &&
      typeof name === "string" &&
      typeof size === "number" &&
      Number.isFinite(size)
    )
      files.push({ id, name, size });
  }
  for (const item of refusedList) {
    const name = field(item, "name");
    const size = field(item, "size");
    const reason = field(item, "reason");
    if (typeof name === "string" && typeof size === "number" && isReason(reason))
      refused.push({ name, size, reason });
  }
  return {
    files: files.slice(0, NATIVE_DROP_MAX_FILES),
    refused: refused.slice(0, NATIVE_DROP_MAX_FILES),
    skipped:
      typeof skipped === "number" && Number.isSafeInteger(skipped) && skipped > 0 ? skipped : 0,
  };
}

/** What `invoke` returns for a command that answers with bytes (an ArrayBuffer; tests may use others). */
function toBytes(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (Array.isArray(raw) && raw.every((n) => Number.isInteger(n) && n >= 0 && n <= 255))
    return Uint8Array.from(raw as number[]);
  return null;
}

/** The refusal behind a rejected command: the shell serialises `{ code, message }`. */
function refusal(err: unknown): FileDropRefused {
  const code = field(err, "code");
  if (typeof code === "string") {
    const message = field(err, "message");
    return new FileDropRefused(code, typeof message === "string" ? message : code);
  }
  return new FileDropRefused("unknown", err instanceof Error ? err.message : String(err));
}

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type Listen = <T>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void>;

interface TauriGlobal {
  core: { invoke: Invoke };
  event?: { listen: Listen };
}

/** The shell when running inside the Tauri webview (with events); null in an ordinary browser. */
export function tauriFileDrop(win: Window = window): FileDropShell | null {
  const tauri = (win as Window & { __TAURI__?: TauriGlobal }).__TAURI__;
  const invoke = tauri?.core.invoke;
  const listen = tauri?.event?.listen;
  if (!invoke || !listen) return null;
  return {
    onDrop: (listener) =>
      listen<unknown>(DROP_EVENT, (e) => {
        const drop = parseDrop(e.payload);
        if (drop) listener(drop);
      }),
    onHover: (listener) =>
      listen<unknown>(HOVER_EVENT, (e) => {
        const over = field(e.payload, "over");
        if (typeof over === "boolean") listener(over);
      }),
    read: async (id) => {
      let raw: unknown;
      try {
        raw = await invoke<unknown>("read_dropped_file", { id });
      } catch (err) {
        throw refusal(err);
      }
      const bytes = toBytes(raw);
      if (!bytes) throw new FileDropRefused("unknown", "malformed answer");
      return bytes;
    },
  };
}
