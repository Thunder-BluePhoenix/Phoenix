// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { musicPlay as enMusicPlay } from "../../en/music-play";

/** Machine-translated; unreviewed (see ../../README.md). */
export const musicPlay: Record<keyof typeof enMusicPlay, string> = {
  "musicPlay.title": "গান খুঁজুন",
  "musicPlay.body":
    "Phoenix কিছু চালায় না এবং কোনো ফলাফল বেছে নেয় না। অনুসন্ধানের পাতা খুলুন এবং নিজে একটি ফলাফল বেছে নিন।",
  "musicPlay.service": "সাইট: {service}",
  "musicPlay.query": "যা খুঁজবেন: {query}",
  "musicPlay.open": "অনুসন্ধানের পাতা খুলুন",
  "musicPlay.checking": "এই সাইট অনুমোদিত কি না যাচাই করা হচ্ছে…",
  "musicPlay.off": "{service} বন্ধ আছে। সেটিংসে গানের সাইট অংশে এটি চালু করে আবার বলুন।",
  "musicPlay.failed": "অনুসন্ধানের ঠিকানা তৈরি করা যায়নি।",
  "musicPlay.refused.unknown_service": "এভাবে শুধু SoundCloud, Bandcamp ও YouTube-এ খোঁজা যায়।",
  "musicPlay.refused.empty_query": "কী খুঁজবেন তা বলুন বা লিখুন।",
  "musicPlay.refused.too_long": "এই অনুসন্ধান {max} অক্ষরের চেয়ে লম্বা।",
  "musicPlay.refused.bad_characters": "এই অনুসন্ধানে অনুমোদিত নয় এমন অক্ষর আছে।",
};
