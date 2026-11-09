// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { musicPlay as enMusicPlay } from "../../en/music-play";

/** Machine-translated; unreviewed (see ../../README.md). */
export const musicPlay: Record<keyof typeof enMusicPlay, string> = {
  "musicPlay.title": "संगीत खोजें",
  "musicPlay.body":
    "Phoenix कुछ नहीं चलाता और कोई परिणाम नहीं चुनता। खोज का पृष्ठ खोलें और परिणाम खुद चुनें।",
  "musicPlay.service": "साइट: {service}",
  "musicPlay.query": "खोज: {query}",
  "musicPlay.open": "खोज पृष्ठ खोलें",
  "musicPlay.checking": "जाँच की जा रही है कि यह साइट अनुमत है…",
  "musicPlay.off":
    "{service} बंद है। सेटिंग्स में संगीत साइटें के अंतर्गत इसे चालू करें, फिर दोबारा कहें।",
  "musicPlay.failed": "खोज का पता नहीं बनाया जा सका।",
  "musicPlay.refused.unknown_service":
    "इस तरह केवल SoundCloud, Bandcamp और YouTube पर खोजा जा सकता है।",
  "musicPlay.refused.empty_query": "बोलें या लिखें कि क्या खोजना है।",
  "musicPlay.refused.too_long": "यह खोज {max} अक्षरों से लंबी है।",
  "musicPlay.refused.bad_characters": "इस खोज में अनुमत न होने वाले अक्षर हैं।",
};
