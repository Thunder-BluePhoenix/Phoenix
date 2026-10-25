// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserApproval as enBrowserApproval } from "../../en/browser-approval";

/** Machine-translated; unreviewed. */
export const browserApproval: Record<keyof typeof enBrowserApproval, string> = {
  "browserApproval.action": "浏览器操作",
  "browserApproval.action.click": "点击页面上的控件",
  "browserApproval.action.type": "在页面的输入框中输入文字",
  "browserApproval.action.submit": "提交页面上的表单",
  "browserApproval.action.download": "从页面开始下载",
  "browserApproval.action.navigate": "前往另一个地址",
  "browserApproval.action.missing": "请求没有说明这是哪种操作。",
  "browserApproval.page": "页面",
  "browserApproval.page.missing": "请求没有指明页面。",
  "browserApproval.selector": "控件",
  "browserApproval.selector.missing": "请求没有指明控件。",
  "browserApproval.destination": "目标地址",
  "browserApproval.destination.missing": "请求没有指明目标地址。",
  "browserApproval.queryHidden": "该地址还有查询部分，未显示。",
  "browserApproval.text": "将要输入的文字（完整显示）",
  "browserApproval.text.missing": "请求中没有包含文字。",
  "browserApproval.textLength": "文字长度",
  "browserApproval.textLength.value": "{length} 个字符",
  "browserApproval.textLength.missing": "缺少文字长度。",
};
