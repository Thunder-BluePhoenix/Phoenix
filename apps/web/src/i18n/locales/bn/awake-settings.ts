// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { awakeSettings as enAwakeSettings } from "../../en/awake-settings";

/** Machine-translated; unreviewed. */
export const awakeSettings: Record<keyof typeof enAwakeSettings, string> = {
  "awakeSettings.title": "জাগিয়ে রাখুন",
  "awakeSettings.intro":
    "নির্দিষ্ট সময় পর্যন্ত এই কম্পিউটারকে ঘুমিয়ে পড়া থেকে আটকায়, যেমন বিল্ড বা এজেন্ট চলার সময়। সেশনের সবসময় একটি শেষ থাকে: ১ মিনিট থেকে ৭ দিন।",
  "awakeSettings.approval":
    "সেশন শুরু, বাড়ানো ও শেষ করার প্রতিটিই আগে “অনুমোদন”-এ আপনার সম্মতি চায়। আপনি অনুমোদন না দেওয়া পর্যন্ত কিছুই বদলায় না।",
  "awakeSettings.off": "“জাগিয়ে রাখুন” বন্ধ আছে, তাই কোনো সেশন শুরু করা যাবে না।",
  "awakeSettings.enable": "“জাগিয়ে রাখুন” চালু করুন",
  "awakeSettings.status.title": "বর্তমান সেশন",
  "awakeSettings.status.idle": "কোনো সেশন চলছে না। কম্পিউটার স্বাভাবিকভাবে ঘুমিয়ে পড়ে।",
  "awakeSettings.status.unreadable": "“জাগিয়ে রাখুন”-এর অবস্থা পড়া যায়নি।",
  "awakeSettings.status.mode.timed": "(সময়সীমাসহ)",
  "awakeSettings.status.mode.agents_grace": "(এজেন্টরা কাজ করার সময়)",
  "awakeSettings.status.label": "লেবেল: {label}",
  "awakeSettings.end.button": "সেশন শেষ করুন",
  "awakeSettings.start.title": "সেশন শুরু করুন",
  "awakeSettings.start.durations": "আগে থেকে ঠিক করা সময়কাল",
  "awakeSettings.start.minutes": "মিনিট",
  "awakeSettings.start.label": "লেবেল (ঐচ্ছিক)",
  "awakeSettings.start.labelInvalid":
    "লেবেল ১ থেকে {max} অক্ষরের হতে হবে, এতে কন্ট্রোল বা অদৃশ্য অক্ষর থাকতে পারবে না।",
  "awakeSettings.start.submit": "শুরু করতে অনুরোধ করুন",
  "awakeSettings.outcome.waiting": "“অনুমোদন”-এ আপনার সম্মতির অপেক্ষায়…",
  "awakeSettings.outcome.succeeded.start": "অনুমোদিত: সেশন শুরু হয়েছে।",
  "awakeSettings.outcome.succeeded.extend": "অনুমোদিত: সেশনে সময় যোগ করা হয়েছে।",
  "awakeSettings.outcome.succeeded.end": "অনুমোদিত: সেশন শেষ হয়েছে।",
  "awakeSettings.outcome.denied": "আপনি প্রত্যাখ্যান করেছেন, তাই কিছুই বদলানো হয়নি।",
  "awakeSettings.outcome.blocked": "জরুরি স্টপ চালু আছে, তাই কিছুই বদলানো হয়নি।",
  "awakeSettings.outcome.timeout":
    "অনুরোধটি সময়মতো অনুমোদিত হয়নি বা বাতিল হয়েছে, তাই কিছুই বদলানো হয়নি।",
  "awakeSettings.outcome.failed": "“জাগিয়ে রাখুন” এটি করতে পারেনি: {message}",
};
