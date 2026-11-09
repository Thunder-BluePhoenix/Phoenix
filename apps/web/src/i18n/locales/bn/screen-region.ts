// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { screenRegion as enScreenRegion } from "../../en/screen-region";

/** Machine-translated; unreviewed (see ../../README.md). */
export const screenRegion: Record<keyof typeof enScreenRegion, string> = {
  "screenRegion.title": "ইস্যুর জন্য স্ক্রিনের অংশ ক্যাপচার",
  "screenRegion.intro":
    "“স্ক্রিনের অংশ বেছে নিন” চাপুন, অনুমোদনে নিশ্চিত করুন, তারপর সিস্টেমের নির্বাচক দিয়ে কাঙ্ক্ষিত অংশ টেনে নিন (Esc বাতিল করে)। শুধু macOS। ছবিটি এই পৃষ্ঠাতেই থাকে, সংরক্ষিত হয় না। ইস্যুটি নিজে শুধু টেক্সট হিসেবে তৈরি হয়, আপনার অনুমোদনের পর। Linear ও Jira-র ক্ষেত্রে পরে আলাদা ধাপে, নিজস্ব নিশ্চিতকরণসহ, ঢাকা ছবিটি ওই ইস্যুতে সংযুক্ত করতে পারেন; GitHub শুধু টেক্সট।",
  "screenRegion.projectLabel": "GitHub রিপোজিটরি (owner/name), Linear টিম আইডি বা Jira প্রকল্প কী",
  "screenRegion.linearTeamInvalid":
    "Linear টিম আইডি দেখতে এমন: 6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f; কিছু পাঠানো হয়নি।",
  "screenRegion.jiraProjectInvalid":
    "Jira প্রকল্প কী হলো বড় হাতের অক্ষর, সংখ্যা বা আন্ডারস্কোর, যেমন PROJ; কিছু পাঠানো হয়নি।",
  "screenRegion.issuesUnavailable":
    "“ইস্যু ট্র্যাকার” সক্ষমতা বন্ধ আছে বা তাতে তৈরি ও সংযুক্ত করার কমান্ড নেই, তাই কিছু পাঠানো হয়নি। আগে চালু করুন।",
  "screenRegion.issuesNoWriteCredential":
    "“ইস্যু ট্র্যাকার”-এ {tracker}-এর জন্য লেখার ক্রেডেনশিয়াল সেট করা নেই (পোলিং কী কখনও লেখায় ব্যবহৃত হয় না), তাই কিছু পাঠানো হয়নি।",
  "screenRegion.issueKeyInvalid": "এটি বৈধ ইস্যু কী নয়; কিছু পাঠানো হয়নি।",
  "focus.screenshot.textOnly":
    "ইস্যুটি শুধু টেক্সটে তৈরি হয়। স্ক্রিনশট এর অংশ নয়; Linear ও Jira-র জন্য পরে আলাদাভাবে দিতে পারবেন।",
  "focus.screenshot.attach.title": "স্ক্রিনশট সংযুক্ত করুন (ঐচ্ছিক)",
  "focus.screenshot.attach.intro":
    "{tracker} ইস্যু {key} ছবি ছাড়া তৈরি হয়েছে। এখন এতে ঢাকা স্ক্রিনশটটি সংযুক্ত করতে পারেন। এটি আলাদা আপলোড, যার জন্য Core আবার আপনার অনুমোদন চাইবে। GitHub কখনও ছবি পায় না।",
  "focus.screenshot.attach.prepare": "কী সংযুক্ত হবে দেখান",
  "focus.screenshot.attach.details": "যা সংযুক্ত হবে",
  "focus.screenshot.attach.tracker": "সেবা: {tracker}",
  "focus.screenshot.attach.issue": "ইস্যু: {key}",
  "focus.screenshot.attach.file": "ফাইলের নাম: {name}",
  "focus.screenshot.attach.size": "আকার: {bytes} বাইট",
  "focus.screenshot.attach.hash": "কনটেন্ট হ্যাশ (SHA-256, প্রথম ১২ অক্ষর): {hash}",
  "focus.screenshot.attach.redacted":
    "এই পৃষ্ঠায় যেভাবে ঢাকা ও মন্তব্য করা হয়েছে ছবিটি সেভাবেই; ঢাকার অংশ ছবির সঙ্গে মিশে গেছে। এখনও কিছু পাঠানো হয়নি।",
  "focus.screenshot.attach.confirm": "হ্যাঁ, এই ছবি {tracker}-এ আপলোড করুন",
  "focus.screenshot.attach.send": "অনুমোদন চেয়ে সংযুক্ত করুন",
  "focus.screenshot.attach.done": "স্ক্রিনশট {key}-এ সংযুক্ত হয়েছে।",
  "focus.screenshot.attach.problem.badImage": "ছবিটি বৈধ PNG নয় এবং পাঠানো হয়নি।",
  "focus.screenshot.attach.problem.tooLarge": "ছবিটি ৫ MiB-এর বেশি এবং পাঠানো হয়নি।",
  "focus.screenshot.attach.problem.changed":
    "আপনার পর্যালোচনার পর ছবিটি বদলেছে; আবার পর্যালোচনা করুন। কিছু পাঠানো হয়নি।",
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
};
