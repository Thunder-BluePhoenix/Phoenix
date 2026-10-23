// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 62, the floating and island windows: a file dropped on the window itself. The desktop shell
// receives the operating system's drop (the page gets no HTML5 `drop` event there), checks the paths
// and announces numbered files (src/commands/file-drop-shell.ts). This hook asks for each number
// once, turns the bytes into a File and hands it to the SAME upload path as the chat box
// (`useAttachmentUpload` -> `readFile` -> POST /api/attachments, origin "drop"), so the type, size
// and name checks, Core's validation and every message are the existing ones. Core is never given
// a path. A folder cannot come through a native drop; it is reported, not walked.
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import {
  FileDropRefused,
  NATIVE_DROP_MAX_FILES,
  type FileDropShell,
  type NativeDrop,
  type RefusedDropEntry,
} from "../commands/file-drop-shell";
import { translate } from "../i18n/store";
import {
  DROP_LIMITS,
  imageMime,
  isTextFile,
  shown,
  useAttachmentUpload,
  type FileLike,
  type UploadNotice,
} from "./attachments";
import { formatNumber } from "./format";

/** How long the result of a drop stays on screen. */
export const NATIVE_DROP_NOTICE_MS = 8_000;

/** The existing message for an entry the shell did not take, or the one new "folder" message. */
export function refusalNote(entry: RefusedDropEntry): string {
  const name = shown(entry.name);
  switch (entry.reason) {
    case "folder":
      return translate("capture.attachments.nativeDrop.folder", { name });
    case "too_large":
      if (imageMime({ name: entry.name, type: "" }))
        return translate("capture.attachments.file.imageTooBig", { name });
      if (isTextFile({ name: entry.name, type: "" }))
        return translate("capture.attachments.file.tooLargeBytes", {
          name,
          max: formatNumber(DROP_LIMITS.textChars),
        });
      return translate("capture.attachments.file.unsupported", { name });
    case "bad_path":
      return translate("capture.attachments.file.badName", { name });
    case "not_a_file":
      return translate("capture.attachments.file.unsupported", { name });
    case "unreadable":
      return translate("capture.attachments.file.unreadable", { name });
  }
}

export interface NativeDropState {
  /** A file drag is over the window. */
  over: boolean;
  /** A drop is being read and uploaded. */
  busy: boolean;
  /** What the last drop did, or null. Cleared after NATIVE_DROP_NOTICE_MS. */
  notice: UploadNotice | null;
}

/**
 * Listens to the shell's file-drop events (nothing happens with a null shell, as in a browser)
 * and uploads what was dropped with origin "drop". One drop at a time: a drop that arrives while
 * another is being read is ignored, and its numbers simply expire in the shell.
 */
export function useNativeFileDrop(shell: FileDropShell | null): NativeDropState {
  const { upload, busy, notice, clearNotice } = useAttachmentUpload();
  const [over, setOver] = useState(false);
  const working = useRef(false);
  // The latest upload without resubscribing to the shell on every render.
  const latest = useRef(upload);
  latest.current = upload;

  useEffect(() => {
    if (!shell) return;
    let alive = true;
    const offs: Array<() => void> = [];
    const keep = (pending: Promise<() => void>) =>
      void pending.then((off) => {
        if (alive) offs.push(off);
        else off();
      });

    const onDrop = async (drop: NativeDrop) => {
      setOver(false);
      if (working.current) return;
      working.current = true;
      try {
        const earlier = drop.refused.map(refusalNote);
        if (drop.skipped > 0)
          earlier.push(
            translate("capture.attachments.nativeDrop.skipped", {
              n: drop.skipped,
              max: NATIVE_DROP_MAX_FILES,
            }),
          );
        const files: FileLike[] = [];
        for (const info of drop.files) {
          try {
            const bytes = await shell.read(info.id);
            files.push(new File([bytes as BlobPart], info.name));
          } catch (err) {
            // A refusal from the shell has its own code, but every one of them means "not read".
            earlier.push(
              err instanceof FileDropRefused && err.code === "too_large"
                ? refusalNote({ name: info.name, size: info.size, reason: "too_large" })
                : translate("capture.attachments.file.unreadable", { name: shown(info.name) }),
            );
          }
        }
        if (alive) await latest.current({ files, folders: [] }, "drop", earlier);
      } finally {
        working.current = false;
      }
    };

    keep(shell.onHover((next) => alive && setOver(next)));
    keep(shell.onDrop((drop) => void onDrop(drop)));
    return () => {
      alive = false;
      for (const off of offs) off();
    };
  }, [shell]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(clearNotice, NATIVE_DROP_NOTICE_MS);
    return () => clearTimeout(timer);
    // `clearNotice` is a fresh closure each render; the notice itself is what restarts the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice]);

  return { over, busy, notice };
}

/** The sentence for the current state of a native drop (over, reading, last result), or null. */
export function useNativeDropText(drop: NativeDropState): string | null {
  const t = useT();
  if (drop.over) return t("capture.attachments.dropZone.over");
  if (drop.busy) return t("capture.attachments.dropZone.reading");
  return drop.notice?.text ?? null;
}

/** True while a native drop has something to show: the shell should keep the window visible. */
export const nativeDropActive = (drop: NativeDropState): boolean =>
  drop.over || drop.busy || drop.notice !== null;
