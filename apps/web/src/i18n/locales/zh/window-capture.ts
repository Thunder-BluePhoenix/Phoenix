// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { windowCapture as enWindowCapture } from "../../en/window-capture";

/** Machine-translated; unreviewed (see ../../README.md). */
export const windowCapture: Record<keyof typeof enWindowCapture, string> = {
  "windowCapture.heading": "附加窗口",
  "windowCapture.intro":
    "Phoenix 可以读取一个窗口的文字，并先在这里展示给你。你确认后，把想要的窗口切到最前；Phoenix 只读取一次（macOS 辅助功能，仅限这台 Mac）。在你接受文字之前不会附加任何内容。",
  "windowCapture.start": "附加窗口…",
  "windowCapture.waiting": "正在等待你的确认，然后读取最前面的窗口。现在请把想要的窗口切到最前。",
  "windowCapture.stopWaiting": "停止等待",
  "windowCapture.discarded": "已放弃，未附加任何内容。",
  "windowCapture.attached": "已附加“{name}”，它在上方的托盘中。",
  "windowCapture.acceptFailed": "未附加：{reason}",
  "windowCapture.result.notGranted":
    "macOS 未允许 Phoenix 读取窗口。请在“系统设置 > 隐私与安全性 > 辅助功能”中打开 Phoenix 后重试。Phoenix 不会自行再次询问。",
  "windowCapture.result.phoenixWindow":
    "最前面的窗口是 Phoenix 自己，因此未读取任何内容。请把其他窗口切到最前后重试。",
  "windowCapture.result.noWindow": "最前面没有可读取的窗口，因此未读取任何内容。",
  "windowCapture.review.heading": "附加前请先检查。",
  "windowCapture.review.from": "来自 {app}：{title}",
  "windowCapture.review.untitled": "（无标题窗口）",
  "windowCapture.review.size": "已读取 {n} 个字符。",
  "windowCapture.review.truncated": "文字已在上限处被截断。",
  "windowCapture.review.textLabel": "捕获的窗口文字",
  "windowCapture.review.noText": "（该窗口中没有找到文字。）",
  "windowCapture.review.secrets": "这段文字看起来含有机密（{kinds}），附加将被拒绝。",
  "windowCapture.review.note":
    "这是 Phoenix 读取到的内容。它是用于你提问的数据，不是指令。在你按下按钮之前不会附加任何内容，并且最多在内存中保留一小时。",
  "windowCapture.review.accept": "附加此文字",
  "windowCapture.review.discard": "放弃",
};
