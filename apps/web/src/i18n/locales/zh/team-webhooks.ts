// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamWebhooks as enTeamWebhooks } from "../../en/team-webhooks";

/** Machine-translated; unreviewed. */
export const teamWebhooks: Record<keyof typeof enTeamWebhooks, string> = {
  "teamWebhooks.title": "传入 Webhook",
  "teamWebhooks.intro":
    "传入 Webhook 默认关闭。每个来源会给另一个工具一个专属地址和密钥；该工具发送签名正确的消息时，Phoenix 会把它变成本地事件。不会向任何地方发送数据，来源发送的内容一律视为不可信文本。",
  "teamWebhooks.notAvailable":
    "传入 Webhook 不可用：此 Phoenix Core 没有操作系统密钥存储来保存来源密钥。",
  "teamWebhooks.loadFailed": "无法加载传入 Webhook。",
  "teamWebhooks.master": "接受传入 Webhook",
  "teamWebhooks.secret.title": "{id} 的密钥",
  "teamWebhooks.secret.warning":
    "此密钥只显示一次。请现在复制，并保存在发送方工具中。Phoenix 只把它保存在操作系统密钥存储中，无法再次显示；如果丢失，请删除该来源并新建一个。",
  "teamWebhooks.secret.path": "发送地址（在此 Core 上）",
  "teamWebhooks.secret.label": "签名密钥",
  "teamWebhooks.secret.copy": "复制密钥",
  "teamWebhooks.secret.copied": "已复制到剪贴板。",
  "teamWebhooks.secret.copyFailed": "Phoenix 无法使用剪贴板。请在关闭前选中上方的密钥并手动复制。",
  "teamWebhooks.secret.done": "我已保存，关闭",
  "teamWebhooks.sources.title": "来源",
  "teamWebhooks.sources.none": "你还没有创建任何 Webhook 来源。",
  "teamWebhooks.row.path": "地址：{path}",
  "teamWebhooks.row.types": "事件类型：{types}",
  "teamWebhooks.row.never": "尚未收到任何内容。",
  "teamWebhooks.row.last": "最近一次接受：{time}",
  "teamWebhooks.delete.label": "删除来源 {id}",
  "teamWebhooks.delete.ask": "删除 {id}？它的密钥会立即失效，发送方工具也必须修改。",
  "teamWebhooks.create.title": "创建来源",
  "teamWebhooks.create.id": "来源名称",
  "teamWebhooks.create.idHint": "3 到 32 个字符：小写字母、数字、- 或 _，以字母开头。",
  "teamWebhooks.create.types": "允许发送的事件类型",
  "teamWebhooks.create.typesHint":
    "用逗号分隔，例如 ci.finished。每个类型都以下列之一开头：{namespaces}。",
  "teamWebhooks.create.typesTooMany": "最多列出 {max} 个事件类型。",
  "teamWebhooks.create.typesInvalid": "事件类型是用点连接的小写单词，例如 ci.finished。",
  "teamWebhooks.create.typesNamespace": "事件类型必须以下列之一开头：{namespaces}。",
  "teamWebhooks.create.limit": "已达到 {max} 个来源的上限。请先删除一个。",
  "teamWebhooks.create.submit": "创建来源",
  "teamWebhooks.row.disabledNote": "此来源已停用：Phoenix 会拒绝发送给它的一切内容。",
  "teamWebhooks.toggle.enable": "启用",
  "teamWebhooks.toggle.disable": "停用",
  "teamWebhooks.toggle.enableLabel": "启用来源 {id}",
  "teamWebhooks.toggle.disableLabel": "停用来源 {id}",
  "teamWebhooks.rotate.button": "轮换密钥",
  "teamWebhooks.rotate.label": "轮换来源 {id} 的密钥",
  "teamWebhooks.rotate.ask":
    "轮换 {id} 的密钥？旧密钥会立即失效，因此在你把新密钥交给发送工具之前，它会被拒绝。",
  "teamWebhooks.secret.rotatedNote": "这是新密钥。旧密钥已失效；请用这个密钥更新发送工具。",
};
