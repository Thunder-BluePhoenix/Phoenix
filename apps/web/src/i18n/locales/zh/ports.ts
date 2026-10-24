// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { ports as enports } from "../../en/ports";

/** Machine-translated; unreviewed (see ../../README.md). */
export const ports: Record<keyof typeof enports, string> = {
  "ports.title": "端口雷达",
  "ports.intro":
    "显示这台电脑上哪些程序正在监听网络端口、它们属于哪个项目以及已运行多久。扫描只读取信息；除非你选择停止某个程序并批准，否则不会更改任何内容。",
  "ports.disabled": "端口雷达已关闭。请启用“端口与进程雷达”功能后使用。",
  "ports.scan": "立即扫描",
  "ports.scanning": "正在扫描…",
  "ports.notScanned": "尚未扫描。请选择“立即扫描”。",
  "ports.empty": "没有程序在监听端口。",
  "ports.loadError": "无法读取端口。",
  "ports.scannedAt": "扫描时间：{time}",
  "ports.count": "{count, plural, other {# 个监听端口}}",
  "ports.table.caption": "监听端口",
  "ports.col.port": "端口",
  "ports.col.process": "程序",
  "ports.col.project": "项目",
  "ports.col.age": "已运行",
  "ports.col.notes": "备注",
  "ports.col.actions": "操作",
  "ports.pid": "进程 {pid}",
  "ports.age.unknown": "未知",
  "ports.age.minutes": "{count, plural, other {# 分钟}}",
  "ports.age.hours": "{count, plural, other {# 小时}}",
  "ports.age.days": "{count, plural, other {# 天}}",
  "ports.project.none": "无项目",
  "ports.exposure.all": "网络中可访问",
  "ports.exposure.loopback": "仅限本机",
  "ports.exposure.interface": "单个网络地址",
  "ports.flag.forgotten": "可能已被遗忘",
  "ports.flag.heavy": "占用高",
  "ports.flag.core": "Phoenix 自身",
  "ports.usage": "CPU {percent}%，内存 {mb} MB",
  "ports.help.forgotten":
    "可能已被遗忘：它在项目文件夹中运行，已运行超过 {hours, plural, other {# 小时}}。Phoenix 无法得知是否仍有人在使用它。",
  "ports.help.heavy":
    "占用高：CPU 达到 {cpu}% 或以上，或内存达到 {mb} MB 或以上（由 ps 报告，是平均值而非实时读数）。",
  "ports.open": "在浏览器中打开",
  "ports.open.label": "在默认浏览器中打开端口 {port} 上的 {name}",
  "ports.openNote": "链接会在默认浏览器中打开 http://127.0.0.1。Phoenix 目前还没有自己的浏览器。",
  "ports.stop": "停止…",
  "ports.stop.label": "停止端口 {port} 上的 {name}",
  "ports.refusal.self": "这是 Phoenix 自身，它不会停止自己。",
  "ports.refusal.other_user": "它属于其他用户。",
  "ports.refusal.system": "它是系统进程。",
  "ports.refusal.not_dev_tool": "它不是 Phoenix 可以停止的开发工具。",
  "ports.refusal.unsupported": "此系统不支持停止。",
  "ports.refusal.unknown": "Phoenix 无法检查此进程，因此不会停止它。",
  "ports.confirm.title": "停止端口 {port} 上的 {name}？",
  "ports.confirm.body":
    "你批准后，Phoenix 会请求 {name}（进程 {pid}）退出。该程序可能会丢失未保存的内容。",
  "ports.confirm.go": "请求停止",
  "ports.confirm.cancel": "取消",
  "ports.stop.waiting": "正在“审批”中等待你的批准…",
  "ports.stop.exited": "{name} 已停止。",
  "ports.stop.stillRunning":
    "已请求 {name} 退出，但它仍在运行。强制停止会立即结束它，无法撤销，并可能丢失数据。",
  "ports.force": "强制停止…",
  "ports.force.label": "强制停止端口 {port} 上的 {name}",
  "ports.force.hint": "请求退出后的最初几秒内，Phoenix 会拒绝强制停止。",
  "ports.force.confirm": "强制停止",
  "ports.restart": "重启…",
  "ports.restart.label": "重启端口 {port} 上的 {name}",
  "ports.restart.title": "重启端口 {port} 上的 {name}？",
  "ports.restart.body":
    "你批准后，Phoenix 会请求 {name}（进程 {pid}）退出，并且只有它退出后，才会严格按下方所示启动你配置的重启配方。程序可能丢失未保存的工作。如果启动失败，程序保持停止。",
  "ports.restart.recipe": "配方",
  "ports.restart.argv": "程序和参数",
  "ports.restart.cwd": "文件夹",
  "ports.restart.go": "请求重启",
  "ports.restart.started":
    "{name} 已停止，配方 {recipe} 已启动（进程 {pid}）。Phoenix 暂时无法确认它是否重新监听；请再次扫描。",
  "ports.restart.note":
    "只有为某个端口在本功能设置中写了重启配方，才会为该端口上的程序提供重启。Phoenix 绝不会从正在运行的程序重建命令。",
  "ports.watch.label": "Phoenix 打开时自动刷新",
  "ports.watch.help":
    "默认关闭。开启后，Phoenix 每 15 秒读取一次端口列表，且仅在 Phoenix 窗口打开时进行。",
  "ports.noProcessTable": "无法读取进程列表，因此无法显示运行时长，也无法停止进程。",
  "ports.parseWarnings":
    "系统进程或端口列表中有些行无法理解，已被忽略（程序名称可能包含换行）。某些程序可能缺失或无法在此停止；停止时会重新检查所有内容。",
  "ports.windows.note": "在 Windows 上，雷达只显示端口和程序名称；不提供运行时长、项目和停止功能。",
};
