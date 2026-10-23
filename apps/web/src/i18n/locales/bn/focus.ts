// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { focus as enFocus } from "../../en/focus";

/** Machine-translated; unreviewed. */
export const focus: Record<keyof typeof enFocus, string> = {
  "focus.title": "ফোকাস মোড",
  "focus.start": "ফোকাস শুরু করুন",
  "focus.stop": "ফোকাস শেষ করুন",
  "focus.minutes": "মিনিট (সময়সীমা না থাকলে ফাঁকা রাখুন)",
  "focus.remaining": "বাকি মিনিট: {count}",
  "focus.active": "ফোকাস চালু",
  "focus.inactive": "ফোকাস বন্ধ",
  "focus.held": "আটকে রাখা বিজ্ঞপ্তি: {count}",
  "focus.osDnd": "সিস্টেমে বিরক্ত করবেন না চালু",
  "focus.osUnknown": "সিস্টেমের বিরক্ত করবেন না অবস্থা অনুপলব্ধ",
  "focus.refresh": "সিস্টেম ফোকাস অবস্থা রিফ্রেশ করুন",
  "focus.pomodoro": "পোমোডোরো শুরু করুন",
  "focus.systemUnavailable":
    "সিস্টেম ডু নট ডিস্টার্ব উপলব্ধ নয়; ফোকাস মোড শুধু Phoenix বিজ্ঞপ্তি নিয়ন্ত্রণ করে।",
  "focus.screenshot.title": "স্ক্রিনশট থেকে ইস্যু",
  "focus.screenshot.capture": "স্ক্রিনের অংশ বাছুন…",
  "focus.screenshot.permission": "স্ক্রিন রেকর্ডিং অনুমতি প্রয়োজন।",
  "focus.screenshot.error": "অনুরোধ ব্যর্থ: {error}",
  "focus.screenshot.box": "বাক্স",
  "focus.screenshot.arrow": "তীর",
  "focus.screenshot.text": "লেখা",
  "focus.screenshot.redact": "স্থায়ীভাবে ঢাকুন",
  "focus.screenshot.annotationText": "টীকার লেখা",
  "focus.screenshot.project": "রিপোজিটরি বা প্রকল্প",
  "focus.screenshot.issueTitle": "ইস্যুর শিরোনাম",
  "focus.screenshot.body": "ইস্যুর বিবরণ",
  "focus.screenshot.preview": "খসড়া দেখুন",
  "focus.screenshot.create": "অনুমোদন নিয়ে ইস্যু তৈরি করুন",
  "focus.screenshot.draft": "ইস্যুর খসড়া (তৈরি হয়নি)",
  "focus.screenshot.attachment": "সমর্থিত হলে স্ক্রিনশট যুক্ত",
  "focus.screenshot.noAttachment":
    "এই ট্র্যাকার স্ক্রিনশট সংযুক্তি সমর্থন করে না; ছবি পাঠানো হবে না।",
  "focus.screenshot.created": "ইস্যু তৈরি হয়েছে: {url}",
  "focus.screenshot.declined": "অনুমোদিত হয়নি; কিছু পাঠানো হয়নি।",
  "focus.screenshot.tracker": "ইস্যু ট্র্যাকার",
  "focus.screenshot.tracker.github": "GitHub",
  "focus.screenshot.tracker.linear": "Linear",
  "focus.screenshot.tracker.jira": "Jira",
  "focus.issueDraft.title": "আপনার কাছে থাকা ছবি থেকে ইস্যু",
  "focus.issueDraft.intro":
    "আপনার কাছে আগে থেকেই থাকা একটি PNG বা JPEG এখানে ছাড়ুন, পেস্ট করুন বা বেছে নিন, ইস্যু লিখুন এবং ঠিক কী পাঠানো হবে তা দেখুন। Phoenix আপনার স্ক্রিন ক্যাপচার করে না। এখানে এবং আবার অনুমোদনে নিশ্চিত করার পরেই GitHub-এ ইস্যু তৈরি হয়।",
  "focus.issueDraft.unavailable.capability":
    "GitHub ইন্টিগ্রেশন চালু নেই বা ইস্যু তৈরি করতে পারে না, তাই কিছু তৈরি করা যাবে না।",
  "focus.issueDraft.unavailable.token":
    "GitHub ইন্টিগ্রেশনের জন্য GitHub লেখার টোকেন সেট করা নেই, তাই কিছু তৈরি করা যাবে না।",
  "focus.issueDraft.dropLabel": "ইস্যুর জন্য ছবি ছাড়ুন",
  "focus.issueDraft.dropHint": "এখানে PNG বা JPEG ছাড়ুন বা পেস্ট করুন, অথবা {choose}।",
  "focus.issueDraft.choose": "ছবি বেছে নিন…",
  "focus.issueDraft.chooseLabel": "ইস্যুর জন্য ছবি বেছে নিন",
  "focus.issueDraft.imageAlt": "ইস্যুর জন্য ছবি: {name}",
  "focus.issueDraft.imageRemove": "ছবি সরান",
  "focus.issueDraft.oneImage": "একবারে একটি ছবি যোগ করুন।",
  "focus.issueDraft.imageRequired": "আগে একটি ছবি যোগ করুন।",
  "focus.issueDraft.titleRequired": "ইস্যুর শিরোনাম লিখুন।",
  "focus.issueDraft.titleTooLong": "শিরোনামে সর্বোচ্চ {max}টি অক্ষর থাকতে পারে।",
  "focus.issueDraft.bodyTooLong": "বিবরণে সর্বোচ্চ {max}টি অক্ষর থাকতে পারে।",
  "focus.issueDraft.secretInTitle":
    "শিরোনামে পাসওয়ার্ড, কী বা টোকেনের মতো কিছু আছে বলে মনে হচ্ছে। সেটি সরান; কিছুই পাঠানো হয়নি।",
  "focus.issueDraft.secretInBody":
    "বিবরণে পাসওয়ার্ড, কী বা টোকেনের মতো কিছু আছে বলে মনে হচ্ছে। সেটি সরান; কিছুই পাঠানো হয়নি।",
  "focus.issueDraft.secretInBoth":
    "শিরোনাম ও বিবরণে পাসওয়ার্ড, কী বা টোকেনের মতো কিছু আছে বলে মনে হচ্ছে। সেটি সরান; কিছুই পাঠানো হয়নি।",
  "focus.issueDraft.previewRepository": "রিপোজিটরি: {repository}",
  "focus.issueDraft.previewTitle": "শিরোনাম: {title}",
  "focus.issueDraft.previewBody": "বিবরণ, ঠিক যেভাবে পাঠানো হবে:",
  "focus.issueDraft.previewNoBody": "কোনো বিবরণ পাঠানো হবে না।",
  "focus.issueDraft.imageLocal":
    "ছবিটি ({name}) পাঠানো হয় না। GitHub ইস্যু শুধু টেক্সট থেকে তৈরি হয়; ছবি এই ডিভাইসেই থাকে এবং সংরক্ষিত হয় না। চাইলে নিজে ইস্যুতে যোগ করুন।",
  "focus.issueDraft.approval":
    "এখনও কিছু তৈরি হয়নি। বোতাম চাপার পরে, GitHub-এ কিছু পাঠানোর আগে Phoenix অনুমোদন-এ আপনার সম্মতি চাইবে।",
  "focus.issueDraft.create": "ইস্যু তৈরির অনুরোধ করুন",
  "focus.issueDraft.waiting": "অনুমোদন-এ আপনার সম্মতির অপেক্ষা…",
  "focus.issueDraft.denied": "আপনি প্রত্যাখ্যান করেছেন; GitHub-এ কিছুই পাঠানো হয়নি।",
  "focus.issueDraft.blocked": "জরুরি বন্ধ চালু আছে; GitHub-এ কিছুই পাঠানো হয়নি।",
  "focus.issueDraft.timeout": "অনুরোধ সময়মতো অনুমোদিত হয়নি বা বাতিল হয়েছে; কিছুই পাঠানো হয়নি।",
  "focus.issueDraft.failed": "ইস্যু তৈরি করা যায়নি: {message}",
};
