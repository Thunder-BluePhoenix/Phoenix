// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { signals as ensignals } from "../../en/signals";

/** Machine-translated; unreviewed. */
export const signals: Record<keyof typeof ensignals, string> = {
  "signals.title": "工程信号",
  "signals.intro": "检查所选代码库的依赖公告、测试稳定性、耗时趋势和配置键差异。读取不会修改文件。",
  "signals.root": "代码库文件夹",
  "signals.add": "监控文件夹",
  "signals.remove": "停止监控",
  "signals.refresh": "立即检查",
  "signals.empty": "监控的代码库目前没有信号。",
  "signals.unconfigured": "请选择要监控的代码库文件夹。",
  "signals.error": "无法读取工程信号。",
  "signals.advisory": "依赖安全公告",
  "signals.flaky_test": "不稳定测试",
  "signals.duration_trend": "耗时增加",
  "signals.config_drift": "缺少配置键",
  "signals.optin": "主动通知需要明确同意，并遵守免打扰时段和每小时上限。",
  "signals.privacy": "只比较配置键名称；绝不显示值。",
  "signals.unknown.advisories": "依赖公告尚未评估（状态未知，并非无问题）：",
  "signals.unknown.history": "测试历史和耗时趋势尚未评估（状态未知，并非无问题）：",
};
