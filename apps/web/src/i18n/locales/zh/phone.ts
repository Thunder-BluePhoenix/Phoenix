// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { phone as enphone } from "../../en/phone";

/** Machine-translated; unreviewed (see ../../README.md). */
export const phone: Record<keyof typeof enphone, string> = {
  "phone.title": "手机连接",
  "phone.intro": "配对手机后，它可以批准或拒绝 Phoenix 询问的事项。开启之前此功能处于关闭状态。",
  "phone.unavailable": "无法加载手机连接设置。",
  "phone.warning.title": "开启之前",
  "phone.warning.network":
    "开启后会打开一个独立的 HTTPS 监听端口，本地网络中的其他设备可以访问（互联网不可访问）。",
  "phone.warning.pairing":
    "只有你配对并在此确认的手机才能批准任何事项。配对需要此屏幕上显示的代码。",
  "phone.warning.trust": "只在你信任的网络（例如家庭网络）中开启。",
  "phone.warning.presence":
    "Phoenix 无法确认有人在这台电脑前：这台电脑上任何持有 Core 会话令牌的程序也可以配对手机。",
  "phone.enable.label": "允许本地网络中的手机连接",
  "phone.saved.on": "手机连接已开启。",
  "phone.saved.off": "手机连接已关闭。",
  "phone.saved.verifyOn": "手机上的批准现在需要生物识别或设备验证。",
  "phone.saved.verifyOff": "手机上的批准不再需要设备验证。",
  "phone.killSwitch":
    "紧急开关已开启，因此手机监听已关闭。解除紧急开关后，请在此重新开启手机连接。",
  "phone.lockedOut": "由于输入错误代码次数过多，配对已锁定至 {time}。",
  "phone.notListening": "手机连接已开启，但监听尚未运行。",
  "phone.addressChanged":
    "你选择的网络地址已不可用，因此手机连接保持关闭。请重新选择地址以再次开启。",
  "phone.addressChanged.title": "这台电脑的地址已更改",
  "phone.addressChanged.mayNotReach":
    "你之前配对的手机可能无法再连接到这台电脑，因为它仍记着旧地址。没有在其他网络上打开任何内容。",
  "phone.addressChanged.pick": "网络地址",
  "phone.addressChanged.use": "使用此地址",
  "phone.addressChanged.none":
    "目前没有找到私有的本地网络地址。请连接到你的网络后再回来，或关闭手机连接。",
  "phone.addressChanged.off": "关闭手机连接",
  "phone.addressChanged.repair": "选择地址后，如果手机仍无法连接，请显示新的配对码并重新配对手机。",
  "phone.saved.address": "手机连接的地址已更改。",
  "phone.port.label": "端口",
  "phone.port.save": "保存端口",
  "phone.port.invalid": "请输入 1024 到 65535 之间的整数。",
  "phone.port.note":
    "手机连接在此端口监听（1024 到 65535；默认 47821）。新端口在连接下次打开时生效；如果现在已开启，它会在新端口上重新启动，屏幕上显示的配对码将失效。之前配对的手机可能仍使用旧端口，需要重新配对。",
  "phone.saved.port": "手机连接端口已保存：{port}。",
  "phone.pair.qrLabel": "包含配对链接的二维码",
  "phone.pair.qrHint":
    "请用你正在配对的手机上的应用扫描。它包含上面的配对码，所以只给你自己的手机看。",
  "phone.pair.qrUnavailable": "无法为此链接生成二维码；请使用下面的链接。",
  "phone.listen.address": "地址和端口",
  "phone.listen.fingerprint": "证书指纹 (SHA-256)",
  "phone.pair.show": "显示配对码",
  "phone.pair.cancel": "取消配对码",
  "phone.pair.cancelled": "配对码已取消。",
  "phone.pair.expired": "配对码已过期。请显示新的配对码以配对手机。",
  "phone.pair.instruction":
    "在手机上输入或扫描此代码，并检查手机显示的指纹是否与下方一致。如果不一致，请不要继续。",
  "phone.pair.codeLabel": "配对码",
  "phone.pair.remaining": "{time} 后过期",
  "phone.pair.fingerprint": "证书指纹：",
  "phone.pair.link": "配对链接（如果手机无法扫描二维码）：",
  "phone.pair.hiddenActive": "配对码在 {time} 之前有效。它不会再次显示；请取消并显示新的配对码。",
  "phone.pending.question": "配对“{name}”？",
  "phone.pending.fingerprint": "密钥指纹",
  "phone.pending.yes": "是，配对此手机",
  "phone.pending.no": "否，拒绝",
  "phone.pending.waiting": "正在等待 Phoenix 请求你确认。",
  "phone.pending.approved": "手机已配对。",
  "phone.pending.rejected": "配对已拒绝。",
  "phone.verify.label": "批准时要求生物识别或设备验证",
  "phone.verify.note":
    "手机会报告是否已验证本人（指纹、面容或屏幕锁）。Phoenix 自己无法核实该报告。",
  "phone.devices.title": "已配对的手机",
  "phone.devices.none": "没有已配对的手机。",
  "phone.devices.fingerprint": "密钥指纹",
  "phone.devices.created": "配对于 {date}",
  "phone.devices.lastSeen": "最后一次出现：{when}",
  "phone.devices.neverSeen": "从未出现",
  "phone.devices.revoked": "已于 {date} 撤销",
  "phone.devices.revoke": "撤销 {name}",
  "phone.devices.revokeAsk": "撤销“{name}”？它将无法再批准任何事项。",
  "phone.devices.revokeYes": "是，撤销",
  "phone.devices.revokeNo": "保留",
  "phone.devices.revokedDone": "手机已撤销。",
  "phone.device.unnamed": "未命名手机",
};
