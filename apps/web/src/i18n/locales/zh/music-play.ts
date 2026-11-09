// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { musicPlay as enMusicPlay } from "../../en/music-play";

/** Machine-translated; unreviewed (see ../../README.md). */
export const musicPlay: Record<keyof typeof enMusicPlay, string> = {
  "musicPlay.title": "搜索音乐",
  "musicPlay.body": "Phoenix 不会播放任何内容，也不会替你选择结果。请打开搜索页面，自行选择结果。",
  "musicPlay.service": "网站：{service}",
  "musicPlay.query": "搜索：{query}",
  "musicPlay.open": "打开搜索页面",
  "musicPlay.checking": "正在检查此网站是否被允许…",
  "musicPlay.off": "{service} 已关闭。请在设置的音乐网站中打开它，然后再说一次。",
  "musicPlay.failed": "无法生成搜索地址。",
  "musicPlay.refused.unknown_service": "只能这样搜索 SoundCloud、Bandcamp 和 YouTube。",
  "musicPlay.refused.empty_query": "请说出或输入要搜索的内容。",
  "musicPlay.refused.too_long": "该搜索超过 {max} 个字符。",
  "musicPlay.refused.bad_characters": "该搜索包含不允许的字符。",
};
