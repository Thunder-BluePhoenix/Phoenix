// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { follow as enFollow } from "../../en/follow";

/** Machine-translated; unreviewed (see ../../README.md). */
export const follow: Record<keyof typeof enFollow, string> = {
  "follow.label": "允许悬浮的 Fawkes 跟随我的鼠标指针（仅限桌面应用）",
  "follow.hint":
    "默认关闭。只有桌面应用中的悬浮 Fawkes 会移动；有事需要你时它会飞回原位，并且在隐藏、安静模式或安静时段、紧急停止期间以及演示中保持不动。开启减少动效时，它会直接跳到位置而不是滑行。浏览器中不可用。",
};
