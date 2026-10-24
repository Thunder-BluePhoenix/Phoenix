// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamInvite as enTeamInvite } from "../../en/team-invite";

/** Machine-translated; unreviewed. */
export const teamInvite: Record<keyof typeof enTeamInvite, string> = {
  "teamInvite.share.title": "分享我的身份",
  "teamInvite.share.intro":
    "通过聊天或电子邮件把此邀请发给队友。它只包含你的团队 ID、公钥和你在下方输入的名称，不含任何机密，你的私钥也不会离开这台电脑。",
  "teamInvite.share.label": "邀请中的名称（可选）",
  "teamInvite.share.invalid": "无法用此身份生成邀请。",
  "teamInvite.share.invite": "你的邀请",
  "teamInvite.share.copy": "复制邀请",
  "teamInvite.share.copied": "邀请已复制到剪贴板。",
  "teamInvite.share.copyFailed": "Phoenix 无法使用剪贴板。请选中上方的邀请并手动复制。",
  "teamInvite.share.fingerprintHint":
    "请通过语音或在另一个聊天中把指纹念给队友，让对方核对收到的邀请确实是你的。",
  "teamInvite.fingerprint": "密钥指纹",
  "teamInvite.checksumNote":
    "邀请末尾的短校验码只能发现复制错误，不能证明邀请由谁生成；只有核对指纹才能证明。",
  "teamInvite.refusal.empty": "请先粘贴邀请。",
  "teamInvite.refusal.tooLong": "内容太长，不可能是团队邀请。",
  "teamInvite.refusal.format": "这不是 Phoenix 团队邀请。",
  "teamInvite.refusal.version": "此邀请来自另一个版本的 Phoenix，当前版本无法读取。",
  "teamInvite.refusal.checksum": "邀请被改动或复制有误。请让队友重新发送。",
  "teamInvite.refusal.content": "邀请已损坏或内容异常。",
  "teamInvite.refusal.id": "邀请中的团队 ID 无效。",
  "teamInvite.refusal.key": "邀请中的公钥无效。",
  "teamInvite.refusal.label": "邀请中的名称无效。",
  "teamInvite.refusal.unsupported": "此浏览器无法检查邀请。",
  "teamInvite.refusal.own": "该邀请是你自己的身份。",
  "teamInvite.refusal.duplicate": "该队友已在你的列表中。请先移除他们才能更换密钥。",
  "teamInvite.add.title": "添加队友",
  "teamInvite.add.paste": "粘贴队友的邀请",
  "teamInvite.add.preview": "添加此队友前请核对以下信息。",
  "teamInvite.add.noLabel": "邀请中没有名称；请输入一个要显示的名称。",
  "teamInvite.add.theirLabel": "邀请中的名称是：{label}",
  "teamInvite.add.confirm": "我已通过语音或在另一个聊天中与队友核对此指纹，并且一致。",
};
