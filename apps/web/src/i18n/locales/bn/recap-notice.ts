// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { recapNotice as enrecapNotice } from "../../en/recap-notice";

/** Machine-translated; unreviewed. */
export const recapNotice: Record<keyof typeof enrecapNotice, string> = {
  "recapNotice.title": "সাপ্তাহিক রিক্যাপ বিজ্ঞপ্তি",
  "recapNotice.intro":
    "প্রতি সোমবার স্থানীয় সময় ০৯:০০-এ Phoenix-এর নিজস্ব বিজ্ঞপ্তি তালিকায় গত সপ্তাহের সংখ্যাসহ একটি বিজ্ঞপ্তি দেখানো হবে। ডিফল্টভাবে বন্ধ। লেখা নির্দিষ্ট এবং শুধু সংখ্যা থাকে (কোনো নাম, পাথ বা শিরোনাম নয়); কোনো মডেল কল বা নেটওয়ার্ক অনুরোধ হয় না, এবং Proactive-এর নীরব সময়, বিজ্ঞপ্তি নীরব মোড ও জরুরি থামানোর সময় এটি বাদ যায়। সপ্তাহে সর্বোচ্চ একটি; সোমবার Phoenix চালু না থাকলে সেই সপ্তাহেই পরে একবার দেখানো হবে।",
  "recapNotice.enable": "সোমবার সাপ্তাহিক রিক্যাপ বিজ্ঞপ্তি দেখান",
  "recapNotice.last": "সর্বশেষ বিজ্ঞপ্তি সপ্তাহ {week}-এর জন্য।",
  "recapNotice.never": "এখনও কোনো সাপ্তাহিক রিক্যাপ বিজ্ঞপ্তি দেখানো হয়নি।",
  "recapNotice.error": "সাপ্তাহিক রিক্যাপ বিজ্ঞপ্তির সেটিং লোড বা সংরক্ষণ করা যায়নি।",
  "recapNotice.midweek": "সপ্তাহের মাঝখানে চালু করলে এটি পরের সোমবার পর্যন্ত অপেক্ষা করে।",
};
