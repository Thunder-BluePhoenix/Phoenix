// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { statusLights as enStatusLights } from "../../en/status-lights";

/** Machine-translated; unreviewed. */
export const statusLights: Record<keyof typeof enStatusLights, string> = {
  "statusLights.limits":
    "只会发送固定的颜色，绝不发送任何文本。凭据（Hue 应用密钥、Luxafor 令牌）只能写入：保存后不再显示。灯具上报的名称和 ID 以纯文本显示。",
  "statusLights.line.luxafor": "位于 {address} 的 Luxafor 应用",
  "statusLights.line.hue": "桥接器 {bridge} 上的 Hue 灯",

  "statusLights.error.unavailable": "此 Phoenix Core 没有操作系统凭据存储，因此无法保存凭据。",
  "statusLights.error.save": "无法保存灯具列表。请检查名称和地址。",
  "statusLights.error.capability": "无法更改“状态灯”设置。",
  "statusLights.error.hueName":
    "请为桥接器取一个由字母、数字以及 . _ : - 组成的名称（最多 160 个字符）。",
  "statusLights.error.hueInspect": "桥接器没有在该地址上响应。请使用它在您自己网络中的 IPv4 地址。",
  "statusLights.error.huePair": "配对失败。请按下桥接器上的圆形连接按钮，然后重试。",
  "statusLights.error.hueRemove": "无法移除该桥接器。",
  "statusLights.error.hueLights": "无法列出此桥接器上的灯。",
  "statusLights.error.luxaforToken": "令牌未保存。它需要 1 到 128 个不含空格的可打印字符。",
  "statusLights.error.lifx": "LIFX 发现未完成。请等待几秒钟后重试。",
  "statusLights.error.quietInvalid": "请输入两个时间和一个有效的时区，例如 Europe/Paris。",

  "statusLights.hue.title": "Philips Hue",
  "statusLights.hue.notAvailable": "Hue 不可用：此 Phoenix Core 没有操作系统凭据存储。",
  "statusLights.hue.loadFailed": "无法加载 Hue 桥接器。",
  "statusLights.hue.intro":
    "已配对的桥接器只有在出示您确认过 SHA-256 指纹的证书时才会被信任。其应用密钥保存在您操作系统的凭据存储中，绝不会显示。",
  "statusLights.hue.empty": "没有已配对的桥接器。",
  "statusLights.hue.bridgeLine": "位于 {address}:{port}",
  "statusLights.hue.fingerprint": "SHA-256 指纹：",
  "statusLights.hue.find": "显示灯",
  "statusLights.hue.findNamed": "显示桥接器 {name} 上的灯",
  "statusLights.hue.remove": "移除桥接器",
  "statusLights.hue.removeNamed": "移除桥接器 {name}",
  "statusLights.hue.removeNote": "移除桥接器会删除其已保存的密钥。使用它的灯将不再被联系。",
  "statusLights.hue.noLights": "此桥接器没有上报任何灯。",
  "statusLights.hue.alreadyAdded": "已添加",
  "statusLights.hue.add": "添加",
  "statusLights.hue.addNamed": "添加 Hue 灯 {name}",
  "statusLights.hue.pairTitle": "配对桥接器",
  "statusLights.hue.name": "此桥接器的名称",
  "statusLights.hue.address": "桥接器在您网络中的地址（例如 192.168.1.2）",
  "statusLights.hue.lookup": "读取桥接器证书",
  "statusLights.hue.confirmGroup": "确认桥接器证书",
  "statusLights.hue.found": "有一个桥接器在 {address}:{port} 上响应。",
  "statusLights.hue.certName": "证书主体：{name}",
  "statusLights.hue.linkStep":
    "现在请按下桥接器顶部的圆形连接按钮，然后在下方确认。如果按钮在最近 30 秒左右内没有被按下，配对将被拒绝。",
  "statusLights.hue.confirm": "我已将此指纹与我桥接器上的指纹进行比对，并信任此桥接器。",
  "statusLights.hue.pair": "配对并固定此指纹",
  "statusLights.hue.cancel": "取消",

  "statusLights.luxafor.title": "Luxafor",
  "statusLights.luxafor.intro":
    "Phoenix 只与 Luxafor 应用的本地 webhook 通信，在您自己的网络中使用普通 HTTP。无论令牌是什么，该应用都会回答成功，因此已保存的令牌并不能证明灯已发生变化。",
  "statusLights.luxafor.name": "此 Luxafor 灯的名称",
  "statusLights.luxafor.address": "运行 Luxafor 应用的计算机的地址",
  "statusLights.luxafor.add": "添加 Luxafor 灯",
  "statusLights.luxafor.token": "Webhook 令牌",
  "statusLights.luxafor.tokenNamed": "{name} 的 Webhook 令牌",
  "statusLights.luxafor.save": "设置或替换令牌",
  "statusLights.luxafor.saved": "令牌已保存。",
  "statusLights.luxafor.writeOnly": "令牌不再显示。要清除它，请移除此灯。",

  "statusLights.lifx.title": "LIFX",
  "statusLights.lifx.intro":
    "发现功能会在您的网络上发送一次广播，并列出有响应的灯。在您启用某盏灯之前，不会添加任何内容，也不会发送任何颜色。",
  "statusLights.lifx.discover": "查找 LIFX 灯",
  "statusLights.lifx.none": "没有 LIFX 灯响应。",
  "statusLights.lifx.line": "位于 {address} 的 LIFX 灯 {serial}",
  "statusLights.lifx.added": "已添加",
  "statusLights.lifx.enable": "添加此灯",
  "statusLights.lifx.enableNamed": "添加 LIFX 灯 {serial}",

  "statusLights.quiet.title": "静默时段",
  "statusLights.quiet.intro": "在这两个时间之间，灯保持熄灭，按您选择的时区计算。",
  "statusLights.quiet.off": "静默时段已关闭。",
  "statusLights.quiet.on": "灯在 {start} 至 {end} 之间熄灭（{timezone}）。",
  "statusLights.quiet.start": "从",
  "statusLights.quiet.end": "到",
  "statusLights.quiet.timezone": "时区",
  "statusLights.quiet.save": "保存静默时段",
  "statusLights.quiet.clear": "关闭静默时段",
};
