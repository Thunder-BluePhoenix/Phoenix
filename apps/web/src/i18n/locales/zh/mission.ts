// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { mission as enmission } from "../../en/mission";

/** Machine-translated; unreviewed (see ../../README.md). */
export const mission: Record<keyof typeof enmission, string> = {
  "mission.title": "任务控制台",
  "mission.nav": "任务",
  "mission.note": "令牌数和费用均由各智能体自行上报，未与服务商的账单核对。",
  "mission.sourceMissing":
    "目前无法读取部分智能体会话（智能体功能已关闭或没有响应），因此看板上可能缺少一些会话。",
  "mission.refresh": "刷新",
  "mission.loadFailed": "无法加载任务控制台。",

  "mission.filter.search": "搜索会话",
  "mission.filter.searchPlaceholder": "智能体、项目或会话 ID",
  "mission.filter.agent": "智能体",
  "mission.filter.project": "项目",
  "mission.filter.state": "状态",
  "mission.filter.all": "全部",
  "mission.filter.clear": "清除筛选",

  "mission.state.working": "工作中",
  "mission.state.waiting": "等待你处理",
  "mission.state.finished": "已完成",
  "mission.state.stuck": "卡住",
  "mission.reason.permission": "需要你的许可",
  "mission.reason.input": "有问题要问你",
  "mission.reason.idle": "停在提示符处空闲",
  "mission.stuck.noReport": "已超过停滞时限仍无上报",
  "mission.stuck.safetyStall": "被安全网标记为停滞",

  "mission.board.title": "会话",
  "mission.board.empty": "没有可显示的智能体会话。",
  "mission.board.noMatch": "没有符合筛选条件的会话。",
  "mission.column.count": "{count, plural, other {# 个会话}}",
  "mission.column.empty": "无",

  "mission.card.open": "详情",
  "mission.card.focus": "跳转到终端",
  "mission.card.focused": "终端窗口已置于最前。",
  "mission.card.unnamedProject": "未知项目",
  "mission.card.tokens": "输入 {input}，输出 {output}",
  "mission.card.noTokens": "未上报令牌数",
  "mission.card.cost": "费用 {cost}",
  "mission.card.costPartial": "费用至少 {cost}（部分用量没有已知费用）",
  "mission.card.costUnknown": "费用未知",
  "mission.card.lastSeen": "最后响应于 {ago}",
  "mission.card.steps": "{count, plural, other {# 步}}",

  "mission.totals.title": "令牌与费用",
  "mission.totals.window": "最近 {days, plural, other {# 天}}",
  "mission.totals.input": "输入令牌",
  "mission.totals.output": "输出令牌",
  "mission.totals.cost": "费用",
  "mission.totals.unknown": "未知",
  "mission.totals.partial": "至少 {cost}",
  "mission.totals.unpriced":
    "尚未设置价格的模型：{models}。它们的费用是未知，而不是零。请在下方添加价格以查看费用。",
  "mission.totals.empty": "在此时间范围内，没有智能体上报令牌数或费用。",

  "mission.by.day": "按日",
  "mission.by.agent": "按智能体",
  "mission.by.project": "按项目",
  "mission.by.session": "按会话",
  "mission.col.day": "日期",
  "mission.col.agent": "智能体",
  "mission.col.project": "项目",
  "mission.col.session": "会话",
  "mission.col.input": "输入",
  "mission.col.output": "输出",
  "mission.col.cost": "费用",

  "mission.budgets.title": "预算",
  "mission.budgets.note":
    "在达到上限之前，当用量达到上限的 {thresholds} 时会发出提醒，每个预算每天一次。费用预算只统计费用已知的用量。",
  "mission.budgets.none": "还没有预算。",
  "mission.budgets.line": "{scope}，{metric}{agent}：已用 {used}，上限 {limit}（{pct}%）",
  "mission.budgets.lineAtLeast":
    "{scope}，{metric}{agent}：至少 {used}，上限 {limit}（{pct}%）；部分用量没有已知费用，未计入",
  "mission.ingest.notice":
    "今天 Core 将 {clamped, plural, other {# 份报告}}截断到限额，并拒绝了 {refused, plural, other {# 份报告}}，因此下面的数字可能低于代理所报告的数字。代理：{agents}。",
  "mission.budgets.lineUnknown": "{scope}，{metric}{agent}：用量未知，上限 {limit}",
  "mission.budgets.agentSuffix": "（{agent}）",
  "mission.budgets.scope": "适用范围",
  "mission.budgets.scope.daily": "一天内全部",
  "mission.budgets.scope.session": "每个会话",
  "mission.budgets.metric": "计量单位",
  "mission.budgets.metric.tokens": "令牌",
  "mission.budgets.metric.cost": "美元",
  "mission.budgets.limit": "上限",
  "mission.budgets.agent": "智能体（可选）",
  "mission.budgets.add": "添加预算",
  "mission.budgets.remove": "移除预算 {id}",
  "mission.budgets.invalid": "请输入大于零的上限。",

  "mission.prices.title": "价格",
  "mission.prices.note":
    "Phoenix 没有内置价格。请以智能体上报的模型名称，填写你自己的价格（美元/每百万令牌）。",
  "mission.prices.aiNote": "在 AI 设置中也设有价格的模型：{models}。",
  "mission.prices.none": "还没有价格。",
  "mission.prices.model": "模型",
  "mission.prices.input": "每百万输入令牌",
  "mission.prices.output": "每百万输出令牌",
  "mission.prices.line": "{model}：每百万令牌，输入 {input}，输出 {output}",
  "mission.prices.add": "保存价格",
  "mission.prices.remove": "移除 {model} 的价格",
  "mission.prices.invalid": "请输入模型名称和两个不小于零的价格。",

  "mission.stall.label": "活跃会话在这么多分钟内没有上报时，将其标记为卡住",
  "mission.stall.save": "保存",

  "mission.saved": "已保存",
  "mission.delete.button": "删除所有智能体用量",
  "mission.delete.warning":
    "要删除所有已存储的令牌数和费用数据吗？预算和价格会保留。此操作无法撤销。",
  "mission.delete.confirm": "是，删除",
  "mission.delete.done": "{count, plural, other {已删除 # 条记录}}",
};
