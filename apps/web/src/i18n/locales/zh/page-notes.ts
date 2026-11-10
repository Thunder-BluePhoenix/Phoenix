// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { pageNotes as enPageNotes } from "../../en/page-notes";

/** Machine-translated; unreviewed (see ../../README.md). */
export const pageNotes: Record<keyof typeof enPageNotes, string> = {
  "pageNotes.title": "从浏览器发送的页面",
  "pageNotes.intro":
    "您通过 Phoenix 浏览器扩展选择发送的页面。网址、标题和选中的文字由网站编写，因此以纯文本显示。Phoenix 不会打开、读取这些内容，也不会把它们发送给 AI；请删除不想保留的页面。",
  "pageNotes.loading": "正在加载页面…",
  "pageNotes.loadFailed": "无法加载页面列表。",
  "pageNotes.empty": "尚未发送任何页面。",
  "pageNotes.list": "从浏览器发送的页面",
  "pageNotes.untitled": "（无标题）",
  "pageNotes.received": "收到时间 {time}",
  "pageNotes.selection": "选中的文字",
  "pageNotes.delete": "删除",
  "pageNotes.deleteLabel": "删除页面 {title}",
};
