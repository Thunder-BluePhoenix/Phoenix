// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { shell as enShell } from "../../en/shell";

/** Machine-translated; unreviewed (see ../../README.md). */
export const shell: Record<keyof typeof enShell, string> = {
  "shell.nav.home": "Phoenix 首页",
  "shell.nav.main": "主导航",
  "shell.nav.meetings": "会议",
  "shell.nav.provenance": "溯源",
  "shell.nav.agents": "智能体",
  "shell.nav.workflows": "工作流",
  "shell.nav.recap": "回顾",
  "shell.nav.settings": "设置",
  "shell.nav.recording": "录制中",
  "shell.app.skipToContent": "跳到内容",
  "shell.app.tagline": "Phoenix 是平台，Fawkes 是宠物。",
  "shell.app.noToken": "此页面没有会话令牌。请从 <code>pnpm dev:core</code> 打印的地址打开 Phoenix。",
  "shell.app.hint": "点击顶部栏中的 Fawkes，查看 Phoenix 正在做什么。",
  "shell.language.title": "语言",
  "shell.language.label": "界面语言",
  "shell.language.available": "{count, plural, other {提供 # 种语言。}}",
  "shell.language.machineNote": "除英语外的文本均为机器翻译，尚未经母语者审校。",
  "shell.language.saved": "语言已更改。",
  "shell.language.failed": "无法保存语言，请重试。",
};
