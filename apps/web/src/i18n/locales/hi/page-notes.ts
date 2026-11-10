// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { pageNotes as enPageNotes } from "../../en/page-notes";

/** Machine-translated; unreviewed (see ../../README.md). */
export const pageNotes: Record<keyof typeof enPageNotes, string> = {
  "pageNotes.title": "आपके ब्राउज़र से भेजे गए पेज",
  "pageNotes.intro":
    "वे पेज जिन्हें आपने Phoenix ब्राउज़र एक्सटेंशन से भेजना चुना। पता, शीर्षक और चयनित पाठ वेबसाइट ने लिखे हैं, इसलिए उन्हें सादे पाठ के रूप में दिखाया जाता है। Phoenix उन्हें न खोलता है, न पढ़ता है, न AI को भेजता है; जिन्हें नहीं रखना चाहते उन्हें हटा दें।",
  "pageNotes.loading": "पेज लोड हो रहे हैं…",
  "pageNotes.loadFailed": "पेजों की सूची लोड नहीं हो सकी।",
  "pageNotes.empty": "कोई पेज नहीं भेजा गया है।",
  "pageNotes.list": "आपके ब्राउज़र से भेजे गए पेज",
  "pageNotes.untitled": "(कोई शीर्षक नहीं)",
  "pageNotes.received": "प्राप्त {time}",
  "pageNotes.selection": "चयनित पाठ",
  "pageNotes.delete": "हटाएं",
  "pageNotes.deleteLabel": "पेज {title} हटाएं",
};
