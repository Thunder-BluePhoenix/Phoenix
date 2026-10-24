// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { shields as enShields } from "../../en/shields";

/** Machine-translated; unreviewed. */
export const shields: Record<keyof typeof enShields, string> = {
  "shields.title": "广告和跟踪器拦截",
  "shields.intro":
    "这些设置将在 Phoenix 浏览器发布后生效。Phoenix 目前还没有浏览器窗口，所以现在任何页面里都不会拦截任何内容。这种方式只能拦截网络请求：不支持隐藏页面元素，这也不是其他浏览器防护功能的复制品。",
  "shields.unavailable": "Phoenix Core 无法提供广告和跟踪器拦截设置。",
  "shields.loadFailed": "无法从 Phoenix Core 读取拦截设置。",
  "shields.global.label": "拦截广告和跟踪器",
  "shields.global.hint":
    "关闭时，任何列表都不会应用到任何网站。开启但没有下载列表时，使用内置的一份知名广告和统计主机的简短列表。",
  "shields.lists.title": "过滤列表",
  "shields.lists.note":
    "列表不随 Phoenix 提供，也绝不会自动下载。点击“更新”会联系 easylist.to 一次来下载该列表。不会发送任何关于您或您的页面的信息。",
  "shields.list.purpose.ads": "拦截广告",
  "shields.list.purpose.trackers": "拦截跟踪",
  "shields.list.never": "从未下载。",
  "shields.list.damaged": "已保存的副本已损坏，不会使用。请点击“更新”重新下载。",
  "shields.list.status": "下载于 {date} · {rules} 条拦截规则 · 已忽略 {cosmetic} 条页面元素规则",
  "shields.list.version": "列表版本 {version}",
  "shields.list.due": "该列表建议在 {date} 之后查找新版本。Phoenix 绝不会自行检查。",
  "shields.list.licence": "许可证：{licence}。署名：{attribution}。",
  "shields.list.source": "更新会联系 {source}",
  "shields.list.enable": "使用 {name}",
  "shields.list.enableNeedsDownload": "请先下载列表再开启。",
  "shields.list.update": "更新",
  "shields.list.updateFirst": "下载",
  "shields.list.updating": "正在下载…",
  "shields.list.updated": "{name} 已更新。",
  "shields.list.remove": "删除已下载的副本",
  "shields.list.removed": "已删除 {name} 的已下载副本。",
  "shields.sites.title": "已关闭拦截的网站",
  "shields.sites.empty": "没有网站关闭了拦截。",
  "shields.sites.add.label": "网站名称，例如 example.com",
  "shields.sites.add.submit": "对此网站关闭拦截",
  "shields.sites.remove": "重新对 {site} 开启拦截",
  "shields.sites.hint":
    "只输入网站名称，不要输入地址。网站及其子域名都包含在内。只要允许了 YouTube 音乐网站，YouTube 自己的广告就不会被拦截，这在音乐网站设置中调整，而不是这里。",
};
