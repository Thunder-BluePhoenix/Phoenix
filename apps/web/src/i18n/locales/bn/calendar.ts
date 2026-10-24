// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { calendar as enCalendar } from "../../en/calendar";

/** Machine-translated; unreviewed. */
export const calendar: Record<keyof typeof enCalendar, string> = {
  "calendar.title": "সভার প্রস্তুতি",
  "calendar.disabled": "ক্যালেন্ডার বন্ধ আছে। আসন্ন সভা দেখতে ক্যালেন্ডার সক্ষম করুন।",
  "calendar.empty": "কোনো আসন্ন সভা নেই।",
  "calendar.loading": "সভা পড়া হচ্ছে…",
  "calendar.error": "ক্যালেন্ডার পড়া যায়নি।",
  "calendar.refresh": "সভা রিফ্রেশ করুন",
  "calendar.prep": "প্রস্তুতি",
  "calendar.decisions": "আগের সিদ্ধান্ত",
  "calendar.actions": "বাকি কাজ",
  "calendar.noPrep": "প্রাসঙ্গিক অনুমোদিত সিদ্ধান্ত বা বাকি কাজ নেই।",
  "calendar.notetaker": "নোটটেকার চালু করুন",
  "calendar.notetakerInfo": "আপনি শুরু করতে চাইলে এবং অনুমতি দিলেই রেকর্ডিং শুরু হয়।",
  "calendar.freeze": "মোতায়েন স্থগিত",
  "calendar.busy": "ব্যক্তিগত অনুষ্ঠান",
  "calendar.source": "{meeting} থেকে",
  "calendar.unconfigured":
    "কোনো ক্যালেন্ডার প্রদানকারী সংযুক্ত নেই। মিটিং দেখতে Google, Microsoft বা CalDAV সংযুক্ত করুন।",
  "calendar.unavailable":
    "ক্যালেন্ডার ফিড পাওয়া যাচ্ছে না। আসন্ন মিটিং ও ডিপ্লয় ফ্রিজ দেখানো যাচ্ছে না।",
  "calendar.stale":
    "ক্যালেন্ডার ফিড পুরনো। রিফ্রেশ না হওয়া পর্যন্ত আসন্ন মিটিং ও ডিপ্লয় ফ্রিজ বিশ্বাসযোগ্য নয়।",
  "calendar.lastChecked": "সর্বশেষ সফল পড়া: {time}",
  "calendar.prepIncomplete": "কিছু মিটিংয়ের প্রস্তুতি অসম্পূর্ণ।",
};
