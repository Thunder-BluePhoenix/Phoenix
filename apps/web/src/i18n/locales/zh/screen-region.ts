// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { screenRegion as enScreenRegion } from "../../en/screen-region";

/** Machine-translated; unreviewed (see ../../README.md). */
export const screenRegion: Record<keyof typeof enScreenRegion, string> = {
  "screenRegion.title": "为问题捕获屏幕区域",
  "screenRegion.intro":
    "点击“选择屏幕区域”，在“审批”中确认，然后用系统选择器拖出所需区域（按 Esc 取消）。仅支持 macOS。图像只保留在此页面，不会保存；问题只以文本形式创建在 GitHub，并需再次获得您的批准。",
  "screenRegion.unavailable":
    "区域捕获已关闭。请启用“屏幕区域捕获”功能并允许屏幕捕获后使用。仅适用于 macOS。",
  "screenRegion.cancelled": "您取消了选择，因此未捕获任何内容。",
  "screenRegion.declined": "您已拒绝，因此未捕获任何内容。",
  "screenRegion.blocked": "紧急停止已开启，因此未捕获任何内容。",
  "screenRegion.timeout": "未在时限内选择区域，或请求未获批准；未捕获任何内容。",
  "screenRegion.failed": "无法捕获该区域：{message}",
  "screenRegion.badImage": "捕获的内容不是有效的 PNG 图像，已丢弃。",
  "screenRegion.tooLarge": "捕获的区域超过 5 MiB，已丢弃。",
  "screenRegion.unsupported": "区域捕获仅支持 macOS。",
  "screenRegion.expired": "该捕获已不可用。请重新选择区域。",
  "screenRegion.trackerUnsupported":
    "这里只有 GitHub 可以创建问题；Linear 和 Jira 暂不支持，因此未发送任何内容。",
};
