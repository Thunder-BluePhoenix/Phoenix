// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { awakeSettings as enAwakeSettings } from "../../en/awake-settings";

/** Machine-translated; unreviewed. */
export const awakeSettings: Record<keyof typeof enAwakeSettings, string> = {
  "awakeSettings.title": "保持唤醒",
  "awakeSettings.intro":
    "在设定的时间内阻止此电脑休眠，例如在构建或智能体运行期间。会话一定有结束时间：从 1 分钟到 7 天。",
  "awakeSettings.approval":
    "开始、延长和结束会话都会先在“审批”中征求你的同意。在你批准之前不会有任何改变。",
  "awakeSettings.off": "“保持唤醒”已关闭，因此无法开始会话。",
  "awakeSettings.enable": "开启“保持唤醒”",
  "awakeSettings.status.title": "当前会话",
  "awakeSettings.status.idle": "没有正在运行的会话。电脑会照常休眠。",
  "awakeSettings.status.unreadable": "无法读取“保持唤醒”的状态。",
  "awakeSettings.status.mode.timed": "（定时）",
  "awakeSettings.status.mode.agents_grace": "（智能体工作期间）",
  "awakeSettings.status.label": "标签：{label}",
  "awakeSettings.end.button": "结束会话",
  "awakeSettings.start.title": "开始会话",
  "awakeSettings.start.durations": "预设时长",
  "awakeSettings.start.minutes": "分钟",
  "awakeSettings.start.label": "标签（可选）",
  "awakeSettings.start.labelInvalid":
    "标签必须为 1 到 {max} 个字符，且不能包含控制字符或不可见字符。",
  "awakeSettings.start.submit": "请求开始",
  "awakeSettings.outcome.waiting": "正在等待你在“审批”中批准…",
  "awakeSettings.outcome.succeeded.start": "已批准：会话已开始。",
  "awakeSettings.outcome.succeeded.extend": "已批准：已为会话增加时间。",
  "awakeSettings.outcome.succeeded.end": "已批准：会话已结束。",
  "awakeSettings.outcome.denied": "你已拒绝，因此没有做任何更改。",
  "awakeSettings.outcome.blocked": "紧急停止已开启，因此没有做任何更改。",
  "awakeSettings.outcome.timeout": "请求未在时限内获批或已被取消，因此没有做任何更改。",
  "awakeSettings.outcome.failed": "“保持唤醒”无法执行：{message}",
};
