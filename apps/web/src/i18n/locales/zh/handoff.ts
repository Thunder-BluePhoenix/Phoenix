// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { handoff as enhandoff } from "../../en/handoff";

/** Machine-translated; unreviewed (see ../../README.md). */
export const handoff: Record<keyof typeof enhandoff, string> = {
  "handoff.title": "交接笔记",
  "handoff.intro":
    "交接笔记是 Phoenix 按固定规则（不使用模型）根据编码代理在会话中报告的内容生成的简短摘要：目标（仅当代理报告了任务标题时）、修改的文件及行数、运行过的命令（已去除机密）以及未解决的问题。Phoenix 没有核实其中任何内容，请将其视为代理的说法，而非证明。笔记保存在这台电脑的 Phoenix 数据文件夹中，仅你本人可读；保留最新的 50 条，在“隐私”中对“handoff”执行“全部删除”即可清除。",

  "handoff.settings.legend": "交接设置",
  "handoff.settings.auto": "代理会话结束时写一条笔记",
  "handoff.settings.allowCloud": "允许云端模型撰写可选摘要（关闭：仅使用本设备上的模型）",
  "handoff.settings.cloudWarning":
    "开启后，当你要求生成摘要时，笔记文本（已编辑的命令和文件名）可能会离开这台电脑发送给云端模型。AI 设置中的云端权限仍然在此选择之上生效。",
  "handoff.settings.saved": "设置已保存。",
  "handoff.settings.unavailable": "无法加载交接设置。",
  "handoff.notes.unavailable": "无法加载交接笔记。",
  "handoff.guard.unavailable": "无法加载机密防护的结果。",
  "handoff.notes.title": "已保存的笔记",
  "handoff.notes.listLabel": "交接笔记",
  "handoff.notes.empty": "还没有写过交接笔记。",
  "handoff.notes.open": "{date} {time} · {agent}",
  "handoff.notes.meta": "{project} · {files} · {lines}",
  "handoff.notes.files": "{count, plural, other {# 个文件}}",
  "handoff.notes.lines": "+{added} −{removed}",
  "handoff.notes.noProject": "无项目",
  "handoff.notes.hasSummary": "模型摘要",
  "handoff.notes.detailLabel": "所选笔记",
  "handoff.notes.loading": "正在加载笔记…",
  "handoff.notes.trigger.auto": "自动撰写",
  "handoff.notes.trigger.user": "应你的要求撰写",
  "handoff.notes.textLabel": "笔记文本",

  "handoff.summary.title": "模型摘要",
  "handoff.summary.processedBy": "撰写者：{by}",
  "handoff.summary.warning": "此摘要由模型撰写，可能有误。使用前请先核对。",
  "handoff.summary.add": "添加模型摘要",
  "handoff.summary.note": "除非你在上方允许使用云端模型，否则 Phoenix 只使用本设备上的模型。",
  "handoff.summary.added": "已添加摘要。",

  "handoff.delete.button": "删除笔记",
  "handoff.delete.done": "笔记已删除。",

  "handoff.generate.title": "为某个会话写笔记",
  "handoff.generate.sessionLabel": "会话",
  "handoff.generate.choose": "选择一个会话",
  "handoff.generate.option": "{agent} · {repository} · {time}",
  "handoff.generate.none": "目前还没有已知的编码代理会话，因此无法写笔记。",
  "handoff.generate.button": "写笔记",
  "handoff.generate.done": "笔记已写好。",

  "handoff.attach.title": "使用这条笔记",
  "handoff.attach.targetLabel": "用于何处",
  "handoff.attach.target.commit_message": "提交信息",
  "handoff.attach.target.pr_description": "拉取请求描述",
  "handoff.attach.target.task": "GitHub issue",
  "handoff.attach.repositoryLabel": "GitHub 仓库（owner/name）",
  "handoff.attach.repositoryInvalid": "请按 owner/name 的格式输入仓库，例如 acme/app。",
  "handoff.attach.preview": "预览",
  "handoff.attach.previewAgain": "重新预览",
  "handoff.attach.confirm": "确认",
  "handoff.attach.previewLabel": "将要附加内容的预览",
  "handoff.attach.issueTitle": "Issue 标题：{title}",
  "handoff.attach.textLabel": "确切文本如下",
  "handoff.attach.delivery.copy": "Phoenix 不会把它写到任何地方：确认后会复制，之后由你自己粘贴。",
  "handoff.attach.delivery.copyPr":
    "Phoenix 目前还没有修改拉取请求描述的命令：只能复制。确认后会复制，之后由你自己粘贴。",
  "handoff.attach.delivery.issue":
    "Phoenix 将通过 github 能力在 {repository} 中创建一个 GitHub issue。系统会再请你确认一次，并且需要写入令牌。",
  "handoff.attach.stale": "预览之后笔记已发生变化，因此没有附加任何内容。请重新预览。",
  "handoff.attach.copied": "已复制到剪贴板。请粘贴到需要的地方。",
  "handoff.attach.copyByHand": "Phoenix 无法使用剪贴板。请选中下面的文本并手动复制。",
  "handoff.attach.issueCreated": "已在 {repository} 中创建 issue #{number}。",
  "handoff.attach.issueExisting": "{repository} 中的 issue #{number} 已存在。",
  "handoff.attach.issueAddress": "地址：{url}",

  "handoff.guard.title": "机密防护",
  "handoff.guard.intro":
    "机密防护随上方的代理钩子安装程序一同安装：它是 Phoenix 添加到 Claude Code 和 Codex 的钩子的一部分。如果某次工具调用、git commit 或 git push 的输入或暂存更改中包含 Phoenix 检测器能识别的机密，它就会拦截，并告诉代理发现了哪种机密以及在哪里，但绝不会透露机密本身。",
  "handoff.guard.override": "只能通过批准卡片放行一次拦截；代理自己无法放行。",
  "handoff.guard.heuristic":
    "检测器只是一种启发式方法，并不保证不会泄露：它无法识别的机密不会被拦下。",
  "handoff.guard.failOpen":
    "如果 Phoenix Core 或钩子无法运行，代理的工作会继续（防护以放行方式失效），但已发现的机密始终会被拦截。",
  "handoff.guard.countsLabel": "机密防护结果",
  "handoff.guard.allowed": "检查后放行：{count}",
  "handoff.guard.blocked": "已拦截：{count}",
  "handoff.guard.overridden": "经你批准后放行：{count}",
  "handoff.guard.since": "统计起始于 {date} {time}",
  "handoff.guard.noResults": "暂无结果。",
  "handoff.guard.recentLabel": "最近的机密防护结果",
  "handoff.guard.row": "{date} {time} · {agent} · {tool}",
  "handoff.guard.outcome.blocked": "已拦截",
  "handoff.guard.outcome.overridden": "经你批准后放行",
  "handoff.guard.finding": "{kind}，位于 {location}",
};
