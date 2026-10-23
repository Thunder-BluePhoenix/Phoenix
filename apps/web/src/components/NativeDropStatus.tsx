// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useNativeDropText, type NativeDropState } from "../core/native-drop";

/**
 * What a file dropped on the floating window is doing: the drag is over the window, the file is
 * being read, or what the last drop did (the existing attachment notices). Draws nothing when
 * there is nothing to say. Shares its words with the chat box's drop zone.
 */
export function NativeDropStatus({
  drop,
  className,
}: {
  drop: NativeDropState;
  className?: string;
}) {
  const text = useNativeDropText(drop);
  if (!text) return null;
  return (
    <p
      className={className}
      role="status"
      data-drop={
        drop.over ? "over" : drop.busy ? "busy" : drop.notice?.problem ? "problem" : "done"
      }
    >
      {text}
    </p>
  );
}
