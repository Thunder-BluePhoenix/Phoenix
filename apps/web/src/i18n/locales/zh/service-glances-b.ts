// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { serviceGlancesB as enServiceGlancesB } from "../../en/service-glances-b";

/** Machine-translated; unreviewed (see ../../README.md). */
export const serviceGlancesB: Record<keyof typeof enServiceGlancesB, string> = {
  "services.glance.resend.notConfigured":
    "请在 Resend 能力的密钥中添加 Resend API 密钥，即可在此查看投递状态。",
  "services.glance.resend.empty": "最近没有可统计的已发送邮件。",
  "services.glance.resend.summary": "{count, plural, other {# 封近期邮件}}",
  "services.glance.resend.newest": "最新：{time}",
  "services.glance.resend.privacy": "仅显示数量。此处不会显示主题和收件人。",
  "services.glance.resend.state.delivered": "已送达",
  "services.glance.resend.state.inFlight": "投递中",
  "services.glance.resend.state.delayed": "已延迟",
  "services.glance.resend.state.bounced": "已退回",
  "services.glance.resend.state.complained": "已标记为垃圾邮件",
  "services.glance.resend.state.failed": "失败",
  "services.glance.resend.state.other": "其他",

  "services.glance.notion.notConfigured":
    "请在 Notion 能力的密钥中添加 Notion 集成令牌，即可在此查看您关注的页面。",
  "services.glance.notion.empty":
    "没有可显示的关注页面或数据库。请在 Notion 能力的设置中按 id 列出它们。",
  "services.glance.notion.summary": "{count, plural, other {# 个关注项}}",
  "services.glance.notion.privacy": "仅显示标题和编辑时间。绝不会读取页面内容。",
  "services.glance.notion.untitled": "无标题",
  "services.glance.notion.kind.page": "页面",
  "services.glance.notion.kind.database": "数据库",
  "services.glance.notion.kind.archived": "已归档",
  "services.glance.notion.edited": "编辑于 {time}",
  "services.glance.notion.open": "在 Notion 中打开",
  "services.glance.notion.openNamed": "在 Notion 中打开 {title}",

  "services.glance.calcom.notConfigured":
    "请在 Cal.com 能力的密钥中添加 Cal.com API 密钥，即可在此查看您的预约。",
  "services.glance.calcom.empty": "没有即将到来的预约。",
  "services.glance.calcom.summary": "{count, plural, other {# 个即将到来的预约}}",
  "services.glance.calcom.privacy": "仅显示时间和参与人数。此处不会显示姓名和电子邮件地址。",
  "services.glance.calcom.booking": "预约",
  "services.glance.calcom.status.accepted": "已确认",
  "services.glance.calcom.status.pending": "等待确认",
  "services.glance.calcom.status.other": "其他",
  "services.glance.calcom.attendees": "{count, plural, other {# 位参与者}}",
  "services.glance.calcom.more": "{count, plural, other {另有 # 个预约}}",
};
