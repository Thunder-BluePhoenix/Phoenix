// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { recapNotice as enrecapNotice } from "../../en/recap-notice";

/** Machine-translated; unreviewed. */
export const recapNotice: Record<keyof typeof enrecapNotice, string> = {
  "recapNotice.title": "每周回顾通知",
  "recapNotice.intro":
    "每周一当地时间 09:00，在 Phoenix 自己的通知列表中显示一条通知，内容为上周的数量。默认关闭。文本固定，只含数字（不含名称、路径或标题），不调用模型，不发起网络请求；在“主动提示”免打扰时段、通知静音模式和紧急停止期间不显示。每周最多一条；如果周一 Phoenix 没有运行，则会在当周稍后补发一次。",
  "recapNotice.enable": "在周一显示每周回顾通知",
  "recapNotice.last": "最近一次通知对应第 {week} 周。",
  "recapNotice.never": "尚未显示过每周回顾通知。",
  "recapNotice.error": "无法加载或保存每周回顾通知设置。",
  "recapNotice.midweek": "在周中开启，将等到下一个周一。",
};
