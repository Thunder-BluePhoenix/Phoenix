// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { digest as endigest } from "../../en/digest";

/** Machine-translated; unreviewed. */
export const digest: Record<keyof typeof endigest, string> = {
  "digest.title": "每日摘要",
  "digest.yesterday": "昨天",
  "digest.today": "今天（已确认的计划）",
  "digest.blockers": "阻碍",
  "digest.endOfDay": "日终总结",
  "digest.source": "来源",
  "digest.none": "没有关联的活动",
  "digest.date": "日期",
  "digest.localNote": "根据关联活动在本地生成。未使用云端模型。",
  "digest.error": "无法加载或复制摘要。",
  "digest.loading": "正在加载摘要…",
  "digest.copy": "复制并附来源",
  "digest.copied": "已复制",
  "digest.sendUnavailable": "连接获批的集成前，无法发送到 Slack 或 Teams。",
  "digest.back": "返回摘要",
  "digest.eventTitle": "事件依据",
  "digest.eventMissing": "该事件已不可用。",
  "digest.unverified": "未验证：这是本地存储的事件声明，并非经提供方验证的证据。",
  "digest.commitTitle": "提交",
  "digest.commitMissing": "此提交不在受监视的仓库中。",
  "digest.noneIncomplete": "在可读取的来源中未找到任何内容。",
  "digest.noticeHeading": "摘要不完整",
  "digest.noticeUnavailable": "无法读取，因此摘要可能缺少活动：{sources}。",
  "digest.noticePartial": "仅读取了最新记录，较早的活动可能缺失：{sources}。",
  "digest.noticeUnattributed":
    "未配置 git 身份（user.email），因此已排除提交而不是将其显示为你的工作：{sources}。",
  "digest.sources.git": "git 仓库",
  "digest.sources.events": "事件历史",
  "digest.sources.sessions": "代理会话",
  "digest.sources.meetings": "会议",
};
