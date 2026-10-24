// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { remoteRelay as enRemoteRelay } from "../../en/remote-relay";

/** Machine-translated; unreviewed. */
export const remoteRelay: Record<keyof typeof enRemoteRelay, string> = {
  "relay.title": "远程中继",
  "relay.intro":
    "当已配对的手机不在您的家庭网络中时，中继可让它回应 Phoenix 待处理的批准请求。中继默认关闭，中继地址由您自己选择。在您开启之前不会发送任何内容。",
  "relay.notAvailable": "远程中继不可用：此 Phoenix Core 没有用于保存中继密钥的操作系统密钥存储。",
  "relay.loadFailed": "无法加载远程中继状态。",

  "relay.privacy.title": "中继能看到什么、不能看到什么",
  "relay.privacy.cannot":
    "它无法读取、更改、伪造或重放任何内容。每条消息都在 Phoenix 与已配对设备之间进行端到端加密，来自设备的决定会先由 Phoenix 验证签名，验证通过后才会生效。",
  "relay.privacy.sees":
    "它能看到随机的路由 id、消息发送给谁（这台电脑或某台设备），以及每条消息的大小和时间。它还可能丢弃、延迟或重复消息，或者停止工作。",
  "relay.privacy.tls":
    "与中继之间的安全（https）连接可以向网络上的其他人隐藏这些路由信息。消息本身的保护并不依赖于它。",

  "relay.status.title": "状态",
  "relay.status.off": "已关闭",
  "relay.status.connected": "已开启，并已连接到中继",
  "relay.status.connecting": "已开启，但目前未连接到中继",
  "relay.status.url": "中继地址",
  "relay.status.route": "路由",
  "relay.status.lastError": "最近报告的问题：{message}",

  "relay.enable.label": "中继地址",
  "relay.enable.hint":
    "请使用您自己运行或信任的中继的 https:// 地址。普通的 http:// 仅接受用于这台电脑。",
  "relay.enable.note":
    "开启后，会为这台电脑创建新的随机路由和新的中继密钥。私钥保存在操作系统密钥存储中，不会显示出来。",
  "relay.enable.button": "开启",
  "relay.url.empty": "请输入中继地址。",
  "relay.url.tooLong": "中继地址太长。",
  "relay.url.notUrl": "这不是网址。",
  "relay.url.https": "中继地址必须以 https:// 开头。",
  "relay.url.credentials": "中继地址不能包含用户名、密码、查询参数或片段。",
  "relay.saved.on": "远程中继已开启。",
  "relay.saved.off": "远程中继已关闭。路由和中继密钥已被丢弃。",

  "relay.disable.button": "关闭",
  "relay.disable.ask":
    "要关闭远程中继吗？这会丢弃路由以及这台电脑的中继私钥。已固定这些信息的设备将无法再使用；重新开启中继后，必须向它们提供新的详细信息。",
  "relay.disable.yes": "是，关闭并丢弃",
  "relay.disable.no": "保持开启",

  "relay.details.show": "显示给设备使用的中继详细信息",
  "relay.details.hide": "隐藏详细信息",
  "relay.details.title": "需要提供给设备的详细信息",
  "relay.details.intro":
    "设备在配对时会固定这些信息。配对本身就是手机链接配对。Phoenix 没有用于中继的配对码或链接，因此请以您信任的方式把这些值交给设备。",
  "relay.details.url": "中继地址",
  "relay.details.route": "路由 id",
  "relay.details.key": "这台电脑的中继公钥",
  "relay.details.warn":
    "路由 id 是一个地址，不是密码。当您关闭此面板、关闭中继或路由发生变化时，这些详细信息会再次隐藏。",

  "relay.devices.title": "已配对的设备",
  "relay.devices.none": "尚未配对任何设备。请在手机链接部分进行配对。",
  "relay.devices.note":
    "这些是通过手机链接配对的设备。在那里撤销某台设备后，它在中继上发出的下一条消息就会被拦截。",
  "relay.devices.loadFailed": "无法加载已配对的设备。",
  "relay.devices.unnamed": "未命名的设备",
  "relay.devices.fingerprint": "密钥指纹",
  "relay.devices.revoked": "已于 {date} 撤销",
  "relay.devices.push": "将批准请求发送到 {name}",
  "relay.devices.pushed": "已将待处理的批准请求发送到 {name}。",
};
