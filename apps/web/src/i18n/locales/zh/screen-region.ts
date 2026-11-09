// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { screenRegion as enScreenRegion } from "../../en/screen-region";

/** Machine-translated; unreviewed (see ../../README.md). */
export const screenRegion: Record<keyof typeof enScreenRegion, string> = {
  "screenRegion.title": "为问题捕获屏幕区域",
  "screenRegion.intro":
    "点击“选择屏幕区域”，在“审批”中确认，然后用系统选择器拖出所需区域（按 Esc 取消）。仅支持 macOS。图像只保留在此页面，不会保存。问题本身仅以文本创建，且需您批准。对于 Linear 和 Jira，之后您可以另行一步、单独确认，把已遮盖的图像附加到该问题；GitHub 仅支持文本。",
  "screenRegion.projectLabel": "GitHub 仓库（owner/name）、Linear 团队 ID 或 Jira 项目键",
  "screenRegion.linearTeamInvalid":
    "Linear 团队 ID 形如 6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f；未发送任何内容。",
  "screenRegion.jiraProjectInvalid":
    "Jira 项目键由大写字母、数字或下划线组成，例如 PROJ；未发送任何内容。",
  "screenRegion.issuesUnavailable":
    "“问题跟踪”功能未启用，或缺少创建和附加命令，因此未发送任何内容。请先启用。",
  "screenRegion.issuesNoWriteCredential":
    "“问题跟踪”中未设置 {tracker} 的写入凭据（轮询密钥从不用于写入），因此未发送任何内容。",
  "screenRegion.issueKeyInvalid": "这不是有效的问题键；未发送任何内容。",
  "focus.screenshot.textOnly":
    "问题仅以文本创建，截图不属于其中；对于 Linear 和 Jira，之后可另行提供。",
  "focus.screenshot.attach.title": "附加截图（可选）",
  "focus.screenshot.attach.intro":
    "{tracker} 问题 {key} 已在没有图像的情况下创建。现在可以把已遮盖的截图附加上去。这是单独的上传，Core 会再次请您批准。GitHub 永远不会收到图像。",
  "focus.screenshot.attach.prepare": "显示将要附加的内容",
  "focus.screenshot.attach.details": "将要附加的内容",
  "focus.screenshot.attach.tracker": "服务：{tracker}",
  "focus.screenshot.attach.issue": "问题：{key}",
  "focus.screenshot.attach.file": "文件名：{name}",
  "focus.screenshot.attach.size": "大小：{bytes} 字节",
  "focus.screenshot.attach.hash": "内容哈希（SHA-256，前 12 个字符）：{hash}",
  "focus.screenshot.attach.redacted":
    "这是在此页面上遮盖并标注后的图像；遮盖已烧录进图像。目前尚未发送任何内容。",
  "focus.screenshot.attach.confirm": "是，将此图像上传到 {tracker}",
  "focus.screenshot.attach.send": "请求批准并附加",
  "focus.screenshot.attach.done": "截图已附加到 {key}。",
  "focus.screenshot.attach.problem.badImage": "该图像不是有效的 PNG，未发送。",
  "focus.screenshot.attach.problem.tooLarge": "图像超过 5 MiB，未发送。",
  "focus.screenshot.attach.problem.changed": "审阅后图像发生了变化；请重新审阅。未发送任何内容。",
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
};
