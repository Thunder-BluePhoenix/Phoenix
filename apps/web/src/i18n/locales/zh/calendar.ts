// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { calendar as enCalendar } from "../../en/calendar";

/** Machine-translated; unreviewed. */
export const calendar: Record<keyof typeof enCalendar, string> = {
  "calendar.title": "会议准备",
  "calendar.disabled": "日历感知已关闭。启用日历功能以查看即将举行的会议。",
  "calendar.empty": "没有即将举行的会议。",
  "calendar.loading": "正在读取会议…",
  "calendar.error": "无法读取日历。",
  "calendar.refresh": "刷新会议",
  "calendar.prep": "会议准备",
  "calendar.decisions": "先前决策",
  "calendar.actions": "待办事项",
  "calendar.noPrep": "没有相关的已审核决策或待办事项。",
  "calendar.notetaker": "启动会议记录",
  "calendar.notetakerInfo": "只有在您选择启动并授予权限后才会录音。",
  "calendar.freeze": "部署冻结",
  "calendar.busy": "私人事件",
  "calendar.source": "来自 {meeting}",
  "calendar.unconfigured":
    "未连接日历提供方。请连接 Google、Microsoft、CalDAV 或 macOS 日历以查看会议。",
  "calendar.unavailable": "日历源不可用，无法显示即将举行的会议和部署冻结。",
  "calendar.stale": "日历源已过期。刷新之前，无法信任即将举行的会议和部署冻结。",
  "calendar.lastChecked": "上次成功读取：{time}",
  "calendar.prepIncomplete": "部分会议的准备内容不完整。",
};
