// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { screenRegion as enScreenRegion } from "../../en/screen-region";

/** Machine-translated; unreviewed (see ../../README.md). */
export const screenRegion: Record<keyof typeof enScreenRegion, string> = {
  "screenRegion.title": "ইস্যুর জন্য স্ক্রিনের অংশ ক্যাপচার",
  "screenRegion.intro":
    "“স্ক্রিনের অংশ বাছুন” চাপুন, অনুমোদনে নিশ্চিত করুন, তারপর সিস্টেম নির্বাচক দিয়ে কাঙ্ক্ষিত অংশ টেনে নিন (Esc বাতিল করে)। শুধু macOS-এ। ছবি এই পৃষ্ঠাতেই থাকে, সংরক্ষিত হয় না; আপনি আবার অনুমোদন করলে ইস্যু শুধু টেক্সট হিসেবে GitHub-এ তৈরি হয়।",
  "screenRegion.unavailable":
    "অংশ ক্যাপচার বন্ধ আছে। ব্যবহার করতে স্ক্রিন অংশ ক্যাপচার সক্ষমতা চালু করুন এবং স্ক্রিন ক্যাপচারের অনুমতি দিন। এটি শুধু macOS-এ কাজ করে।",
  "screenRegion.cancelled": "আপনি নির্বাচন বাতিল করেছেন, তাই কিছুই ক্যাপচার হয়নি।",
  "screenRegion.declined": "আপনি প্রত্যাখ্যান করেছেন, তাই কিছুই ক্যাপচার হয়নি।",
  "screenRegion.blocked": "জরুরি থামানো চালু আছে, তাই কিছুই ক্যাপচার হয়নি।",
  "screenRegion.timeout":
    "সময়মতো কোনো অংশ বাছা হয়নি বা অনুরোধ অনুমোদিত হয়নি; কিছুই ক্যাপচার হয়নি।",
  "screenRegion.failed": "অংশটি ক্যাপচার করা যায়নি: {message}",
  "screenRegion.badImage": "ক্যাপচারটি বৈধ PNG ছবি ছিল না এবং বাদ দেওয়া হয়েছে।",
  "screenRegion.tooLarge": "ক্যাপচার করা অংশ ৫ MiB-এর বেশি এবং বাদ দেওয়া হয়েছে।",
  "screenRegion.unsupported": "অংশ ক্যাপচার শুধু macOS-এ সমর্থিত।",
  "screenRegion.expired": "ক্যাপচারটি আর পাওয়া যায়নি। আবার একটি অংশ বাছুন।",
  "screenRegion.trackerUnsupported":
    "এখান থেকে শুধু GitHub ইস্যু তৈরি করতে পারে; Linear ও Jira এখনো পারে না, তাই কিছুই পাঠানো হয়নি।",
};
