// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserAssist as enBrowserAssist } from "../../en/browser-assist";

/** Machine-translated; unreviewed. */
export const browserAssist: Record<keyof typeof enBrowserAssist, string> = {
  "browser.assist.open": "请 Fawkes 帮忙处理此页面",
  "browser.assist.title": "请 Fawkes 帮忙处理此页面",
  "browser.assist.goalLabel": "你想在此页面上完成什么？",
  "browser.assist.goalPlaceholder": "例如：把蓝色的加入购物车",
  "browser.assist.propose": "提出步骤",
  "browser.assist.proposing": "正在询问本地模型…",
  "browser.assist.close": "关闭助手",
  "browser.assist.goalTooLong": "目标最多 {max} 个字符。",
  "browser.assist.goalControl": "目标不能包含控制字符。",
  "browser.assist.goalHidden": "目标不能包含文字方向或零宽字符。",
  "browser.assist.requestFailed": "无法联系助手。未执行任何操作。",
  "browser.assist.noLocalModel":
    "设备上没有可用的模型，因此 Fawkes 没有读取此页面。页面文字绝不会发送到云服务。",
  "browser.assist.localModelFailed":
    "设备上的模型失败。未执行任何操作，也没有向其他地方发送任何内容。",
  "browser.assist.noBrowser": "此 Phoenix 应用没有可读取页面的浏览器。",
  "browser.assist.inert":
    "由读取了此页面的本地模型提出。尚未执行任何操作。这些步骤是纯文本，可能有误。",
  "browser.assist.forPage": "页面：{url}",
  "browser.assist.dropped": "{count, plural, other {有 # 条模型建议被拒绝，未显示。}}",
  "browser.assist.noSteps": "模型没有为此页面提出任何步骤。",
  "browser.assist.kind.click": "点击",
  "browser.assist.kind.type": "输入到",
  "browser.assist.kind.submit": "提交表单",
  "browser.assist.typeText": "文本：{text}",
  "browser.assist.modelWritten": "由本地模型撰写，而非你本人",
  "browser.assist.run": "执行此步骤",
  "browser.assist.step.running": "正在等待你的批准…",
  "browser.assist.step.done": "完成。未执行其他任何操作。",
  "browser.assist.refused.noTab": "没有可执行此步骤的活动标签页。",
  "browser.assist.refused.moved": "标签页已不在提出这些步骤时的页面上。请重新询问。",
  "browser.assist.failed.denied": "你拒绝了此步骤。",
  "browser.assist.failed.blocked": "Phoenix 拒绝了此步骤（该页面或控件不被允许）。",
  "browser.assist.failed.unavailable": "无法联系浏览器。",
  "browser.assist.failed.timeout": "步骤超时。它可能已执行，也可能没有。",
  "browser.assist.failed.failed": "该步骤未执行。",
};
