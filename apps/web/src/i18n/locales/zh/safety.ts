// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { safety as ensafety } from "../../en/safety";

/** Machine-translated; unreviewed (see ../../README.md). */
export const safety: Record<keyof typeof ensafety, string> = {
  "safety.title": "智能体安全网",
  "safety.intro":
    "在一次会话中编码智能体报告第一次编辑之前，Phoenix 会将项目快照保存到项目自身的 git 仓库中（隐藏引用；不会触及你的分支、暂存区和 stash）。经过预览并获得你的批准后，你可以将文件回滚到该快照。",
  "safety.timing":
    "Claude Code 在工具运行之后才报告步骤，因此快照是在首次收到编辑报告时创建的：第一次编辑通常已包含在快照中。回滚撤销的是智能体在此之后所做的操作，而不是第一次编辑本身。",
  "safety.ignored": "被 git 忽略的文件（构建产物、日志、依赖）不会被保存，也永远不会被恢复或删除。",
  "safety.loadFailed": "无法加载安全网：{error}",
  "safety.killSwitch": "紧急停止开关已开启，因此不会创建新的检查点。",

  "safety.warnings.title": "来自 Fawkes 的警告",
  "safety.warnings.loop": "循环",
  "safety.warnings.stall": "停滞",
  "safety.warnings.line": "{kind} · {agent}，位于 {repository}：{reason}",

  "safety.checkpoints.title": "检查点",
  "safety.checkpoints.none": "尚无检查点。智能体的第一次编辑被报告时会创建一个。",
  "safety.checkpoints.row": "{agent}，位于 {repository}",
  "safety.checkpoints.facts":
    "创建于 {taken} · {count, plural, other {# 个文件}} · 保留至 {expires}",
  "safety.checkpoints.rolledBack": "已于 {when} 回滚",
  "safety.checkpoints.preview": "预览回滚…",
  "safety.checkpoints.previewLabel": "预览回滚到 {agent} 在 {repository} 中的检查点",
  "safety.checkpoints.close": "关闭预览",

  "safety.skipped.title": "没有检查点的会话",
  "safety.skipped.line": "{agent}，位于 {repository}：{reason}",
  "safety.skipped.disabled": "安全网已关闭",
  "safety.skipped.kill_switch": "紧急停止开关已开启",
  "safety.skipped.not_git": "此文件夹不是 git 仓库，因此无法创建快照",
  "safety.skipped.git_unavailable": "无法运行 git",
  "safety.skipped.too_many_files": "项目的文件数超过了上限",
  "safety.skipped.too_large": "项目大小超过了上限",
  "safety.skipped.throttled": "该项目在最近一分钟内已创建过检查点",
  "safety.skipped.snapshot_failed": "git 无法创建快照",

  "safety.preview.title": "回滚预览",
  "safety.preview.counts":
    "{restore, plural, other {将恢复 # 个文件}}，{remove, plural, other {将删除 # 个新文件}}，{kept, plural, other {将保持 # 处差异不变}}。",
  "safety.preview.restore": "恢复到检查点",
  "safety.preview.remove": "将被删除的新文件",
  "safety.preview.kept": "保持不变",
  "safety.preview.change.modified": "已修改",
  "safety.preview.change.deleted": "被智能体删除",
  "safety.preview.change.type_changed": "类型已更改",
  "safety.preview.why.tracked_by_head": "已被 git 跟踪，因此不会被删除",
  "safety.preview.why.ignored": "被 git 忽略",
  "safety.preview.why.submodule": "子模块",
  "safety.preview.why.unsafe_path": "路径不安全，不能操作",
  "safety.preview.why.not_a_file": "不是常规文件",
  "safety.preview.truncated": "列表已被截断；上方的数量是准确的。",
  "safety.preview.diff": "自检查点以来的更改",
  "safety.preview.diffTruncated": "差异内容已在大小上限处被截断。",
  "safety.preview.diffRedacted": "部分看起来像密钥的文本已被遮盖。",
  "safety.preview.diffEmpty": "没有可显示的文本更改。",
  "safety.preview.nothing": "文件已与检查点一致，无需回滚。",
  "safety.preview.refusal.repository_missing": "此处的项目已不再是 git 仓库。",
  "safety.preview.refusal.checkpoint_gone": "该快照已不在仓库中。",
  "safety.preview.refusal.head_moved":
    "自检查点以来仓库的 HEAD 已移动（提交或切换了分支）。Phoenix 不会跨越这一点进行回滚；未做任何更改。",
  "safety.preview.refusal.snapshot_failed": "Git 无法读取工作区。",
  "safety.preview.approvalNote":
    "回滚前会先征求你的批准。它不会更改 git 历史、分支、暂存区或 stash，并且如果文件在此预览之后发生了变化，它会拒绝执行。",

  "safety.rollback.button": "回滚…",
  "safety.rollback.waiting": "正在等待你在上方的批准列表中批准…",
  "safety.rollback.done":
    "已回滚：{restored, plural, other {已恢复 # 个文件}}，{removed, plural, other {已删除 # 个新文件}}。",
  "safety.rollback.exact": "文件现已与检查点一致。",
  "safety.rollback.inexact": "部分差异被保持不变，因此文件与检查点并不完全一致。",

  "safety.settings.title": "设置",
  "safety.settings.enabled": "在报告智能体的第一次编辑时创建检查点",
  "safety.settings.notify": "当 Fawkes 警告出现循环或停滞时发送通知",
  "safety.settings.retention": "检查点保留时间（天）",
  "safety.settings.maxFiles": "跳过文件数超过以下值的项目",
  "safety.settings.loopThreshold": "重复多少次后发出循环警告",
  "safety.settings.waitingMin": "智能体等待你超过多久时发出警告（分钟）",
  "safety.settings.idleMin": "活跃的智能体沉默多久时发出警告（分钟）",
  "safety.settings.saved": "已保存。",
  "safety.settings.detectNote":
    "钩子不会报告退出码或文件内容，因此“循环”是指同一条命令被反复运行，或某个文件的编辑不断相互抵消（按行数统计）。",
};
