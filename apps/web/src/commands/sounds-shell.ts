// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What the floating and island pages may ask of the desktop shell about the user sounds folder
// (Phase 59; apps/desktop sounds_folder.rs and the `sound_override` command). The command takes one
// of the seven fixed sound ids, never a path, and answers the folder's location and the bytes of
// `<folder>/<id>.wav` (or none). Like DesktopShell and FileDropShell this is the only place that
// knows the command name, so the sound host takes a `SoundsShell` and tests pass a fake. The bytes
// are NOT trusted here: the pet runtime's `inspectWav` still checks them before anything plays.

export interface SoundsShell {
  /** The user's replacement bytes for a sound id, or null when there is none. Never a path. */
  override(id: string): Promise<Uint8Array | null>;
  /** Where the sounds folder is (read only; the shell never creates it), or null when unknown. */
  folder(): Promise<string | null>;
}

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

interface TauriGlobal {
  core: { invoke: Invoke };
}

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null && name in value
    ? (value as Record<string, unknown>)[name]
    : undefined;
}

/** The bytes of the shell's JSON array of numbers; null when it is anything else. */
function toBytes(value: unknown): Uint8Array | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    const byte = value[i];
    if (typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 255) return null;
    bytes[i] = byte;
  }
  return bytes;
}

/** The shell when running inside the Tauri webview; null in an ordinary browser. */
export function tauriSoundsShell(win: Window | undefined = globalThis.window): SoundsShell | null {
  const tauri = (win as (Window & { __TAURI__?: TauriGlobal }) | undefined)?.__TAURI__;
  const invoke = tauri?.core?.invoke;
  if (!invoke) return null;
  return {
    override: async (id) => {
      const answer = await invoke<unknown>("sound_override", { id });
      return toBytes(field(answer, "wav"));
    },
    folder: async () => {
      const answer = await invoke<unknown>("sound_override", {});
      const folder = field(answer, "folder");
      return typeof folder === "string" && folder !== "" ? folder : null;
    },
  };
}
