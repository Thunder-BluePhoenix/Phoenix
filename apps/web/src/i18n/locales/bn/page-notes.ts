// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { pageNotes as enPageNotes } from "../../en/page-notes";

/** Machine-translated; unreviewed (see ../../README.md). */
export const pageNotes: Record<keyof typeof enPageNotes, string> = {
  "pageNotes.title": "আপনার ব্রাউজার থেকে পাঠানো পৃষ্ঠা",
  "pageNotes.intro":
    "Phoenix ব্রাউজার এক্সটেনশন দিয়ে আপনি যে পৃষ্ঠাগুলি পাঠাতে বেছে নিয়েছেন। ঠিকানা, শিরোনাম ও নির্বাচিত লেখা ওয়েবসাইট লিখেছে, তাই সাধারণ লেখা হিসেবে দেখানো হয়। Phoenix এগুলি খোলে না, পড়ে না, বা AI-কে পাঠায় না; যেগুলি রাখতে চান না সেগুলি মুছুন।",
  "pageNotes.loading": "পৃষ্ঠা লোড হচ্ছে…",
  "pageNotes.loadFailed": "পৃষ্ঠার তালিকা লোড করা যায়নি।",
  "pageNotes.empty": "কোনো পৃষ্ঠা পাঠানো হয়নি।",
  "pageNotes.list": "আপনার ব্রাউজার থেকে পাঠানো পৃষ্ঠা",
  "pageNotes.untitled": "(শিরোনাম নেই)",
  "pageNotes.received": "প্রাপ্ত {time}",
  "pageNotes.selection": "নির্বাচিত লেখা",
  "pageNotes.delete": "মুছুন",
  "pageNotes.deleteLabel": "পৃষ্ঠা {title} মুছুন",
};
