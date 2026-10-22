// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { handoff as enhandoff } from "../../en/handoff";

/** Machine-translated; unreviewed (see ../../README.md). */
export const handoff: Record<keyof typeof enhandoff, string> = {
  "handoff.title": "হ্যান্ডঅফ নোট",
  "handoff.intro":
    "হ্যান্ডঅফ নোট হলো একটি সংক্ষিপ্ত সারাংশ, যা Phoenix নির্দিষ্ট নিয়মে, কোনো মডেল ছাড়াই, সেশনের সময় কোডিং এজেন্ট যা জানিয়েছে তা থেকে তৈরি করে: লক্ষ্য (শুধু যখন এজেন্ট কাজের শিরোনাম জানিয়েছে), পরিবর্তিত ফাইল ও লাইনের সংখ্যা, চালানো কমান্ড (গোপন তথ্য সরিয়ে) এবং খোলা প্রশ্ন। Phoenix এর কিছুই যাচাই করেনি, তাই একে এজেন্টের কথা হিসেবে দেখুন, প্রমাণ হিসেবে নয়। নোটগুলো এই কম্পিউটারে Phoenix-এর ডেটা ফোল্ডারে রাখা হয়, শুধু আপনিই পড়তে পারেন; সবচেয়ে নতুন ৫০টি রাখা হয়, আর গোপনীয়তায় “handoff”-এর জন্য “সব মুছুন” সেগুলো মুছে দেয়।",

  "handoff.settings.legend": "হ্যান্ডঅফ সেটিংস",
  "handoff.settings.auto": "এজেন্টের সেশন শেষ হলে একটি নোট লিখুন",
  "handoff.settings.allowCloud":
    "ঐচ্ছিক সারাংশ ক্লাউড মডেলকে লিখতে দিন (বন্ধ: শুধু এই ডিভাইসের মডেল)",
  "handoff.settings.cloudWarning":
    "এটি চালু করলে, আপনি সারাংশ চাইলে নোটের লেখা (লুকানো কমান্ড ও ফাইলের নাম) এই কম্পিউটার থেকে বেরিয়ে ক্লাউড মডেলের কাছে যেতে পারে। AI সেটিংসের ক্লাউড অনুমতিগুলো এই পছন্দের ওপরেও প্রযোজ্য থাকে।",
  "handoff.settings.saved": "সেটিংস সংরক্ষিত হয়েছে।",
  "handoff.settings.unavailable": "হ্যান্ডঅফ সেটিংস লোড করা যায়নি।",
  "handoff.notes.unavailable": "হ্যান্ডঅফ নোট লোড করা যায়নি।",
  "handoff.guard.unavailable": "সিক্রেট গার্ডের ফলাফল লোড করা যায়নি।",
  "handoff.notes.title": "সংরক্ষিত নোট",
  "handoff.notes.listLabel": "হ্যান্ডঅফ নোট",
  "handoff.notes.empty": "এখনো কোনো হ্যান্ডঅফ নোট লেখা হয়নি।",
  "handoff.notes.open": "{date} {time} · {agent}",
  "handoff.notes.meta": "{project} · {files} · {lines}",
  "handoff.notes.files": "{count, plural, one {# টি ফাইল} other {# টি ফাইল}}",
  "handoff.notes.lines": "+{added} −{removed}",
  "handoff.notes.noProject": "কোনো প্রকল্প নেই",
  "handoff.notes.hasSummary": "মডেলের সারাংশ",
  "handoff.notes.detailLabel": "নির্বাচিত নোট",
  "handoff.notes.loading": "নোট লোড হচ্ছে…",
  "handoff.notes.trigger.auto": "স্বয়ংক্রিয়ভাবে লেখা",
  "handoff.notes.trigger.user": "আপনি চেয়েছিলেন",
  "handoff.notes.textLabel": "নোটের লেখা",

  "handoff.summary.title": "মডেলের সারাংশ",
  "handoff.summary.processedBy": "যিনি লিখেছেন: {by}",
  "handoff.summary.warning":
    "এই সারাংশ একটি মডেল লিখেছে এবং এটি ভুল হতে পারে। ভরসা করার আগে যাচাই করে নিন।",
  "handoff.summary.add": "মডেলের সারাংশ যোগ করুন",
  "handoff.summary.note":
    "আপনি ওপরে ক্লাউড মডেলের অনুমতি না দিলে Phoenix শুধু এই ডিভাইসের মডেল ব্যবহার করে।",
  "handoff.summary.added": "সারাংশ যোগ করা হয়েছে।",

  "handoff.delete.button": "নোট মুছুন",
  "handoff.delete.done": "নোট মুছে ফেলা হয়েছে।",

  "handoff.generate.title": "একটি সেশনের জন্য নোট লিখুন",
  "handoff.generate.sessionLabel": "সেশন",
  "handoff.generate.choose": "একটি সেশন বেছে নিন",
  "handoff.generate.option": "{agent} · {repository} · {time}",
  "handoff.generate.none": "এখনো কোনো কোডিং-এজেন্ট সেশন জানা নেই, তাই নোট লেখার মতো কিছু নেই।",
  "handoff.generate.button": "নোট লিখুন",
  "handoff.generate.done": "নোট লেখা হয়েছে।",

  "handoff.attach.title": "এই নোট ব্যবহার করুন",
  "handoff.attach.targetLabel": "এটি কোথায় যাবে",
  "handoff.attach.target.commit_message": "কমিট বার্তা",
  "handoff.attach.target.pr_description": "পুল রিকোয়েস্টের বিবরণ",
  "handoff.attach.target.task": "GitHub ইস্যু",
  "handoff.attach.repositoryLabel": "GitHub রিপোজিটরি (owner/name)",
  "handoff.attach.repositoryInvalid": "রিপোজিটরি owner/name আকারে লিখুন, যেমন acme/app।",
  "handoff.attach.preview": "প্রিভিউ",
  "handoff.attach.previewAgain": "আবার প্রিভিউ করুন",
  "handoff.attach.confirm": "নিশ্চিত করুন",
  "handoff.attach.previewLabel": "যা সংযুক্ত হবে তার প্রিভিউ",
  "handoff.attach.issueTitle": "ইস্যুর শিরোনাম: {title}",
  "handoff.attach.textLabel": "ঠিক এই লেখাটি",
  "handoff.attach.delivery.copy":
    "Phoenix এটি কোথাও লেখে না: কপি করতে নিশ্চিত করুন, তারপর নিজে পেস্ট করুন।",
  "handoff.attach.delivery.copyPr":
    "Phoenix-এর এখনো পুল রিকোয়েস্টের বিবরণ বদলানোর কোনো কমান্ড নেই: শুধু কপি। কপি করতে নিশ্চিত করুন, তারপর নিজে পেস্ট করুন।",
  "handoff.attach.delivery.issue":
    "Phoenix github সক্ষমতা দিয়ে {repository}-এ একটি GitHub ইস্যু তৈরি করবে। আপনাকে আরও একবার নিশ্চিত করতে বলা হবে, এবং এর জন্য লেখার টোকেন লাগবে।",
  "handoff.attach.stale":
    "এই প্রিভিউয়ের পরে নোট বদলে গেছে, তাই কিছুই সংযুক্ত হয়নি। আবার প্রিভিউ করুন।",
  "handoff.attach.copied": "ক্লিপবোর্ডে কপি হয়েছে। যেখানে দরকার সেখানে পেস্ট করুন।",
  "handoff.attach.copyByHand":
    "Phoenix ক্লিপবোর্ড ব্যবহার করতে পারেনি। নিচের লেখাটি নির্বাচন করে হাতে কপি করুন।",
  "handoff.attach.issueCreated": "{repository}-এ ইস্যু #{number} তৈরি হয়েছে।",
  "handoff.attach.issueExisting": "{repository}-এ ইস্যু #{number} আগে থেকেই ছিল।",
  "handoff.attach.issueAddress": "ঠিকানা: {url}",

  "handoff.guard.title": "সিক্রেট গার্ড",
  "handoff.guard.intro":
    "সিক্রেট গার্ড ওপরের এজেন্ট হুক ইনস্টলারের সঙ্গে ইনস্টল হয়: এটি Phoenix যে হুকগুলো Claude Code ও Codex-এ যোগ করে তার অংশ। কোনো টুল কল, git commit বা git push-এর ইনপুট বা স্টেজ করা পরিবর্তনে Phoenix-এর ডিটেক্টরের চেনা কোনো গোপন তথ্য থাকলে এটি তা আটকে দেয়, এবং এজেন্টকে জানায় কী ধরনের গোপন তথ্য কোথায় পাওয়া গেছে, গোপন তথ্যটি কখনোই নয়।",
  "handoff.guard.override":
    "আপনি কোনো একটি আটকানো শুধু অনুমোদন কার্ডের মাধ্যমেই বাতিল করতে পারেন; এজেন্ট তা পারে না।",
  "handoff.guard.heuristic":
    "ডিটেক্টরটি অনুমানভিত্তিক, কিছুই ফাঁস হবে না এমন প্রতিশ্রুতি নয়: যে গোপন তথ্য এটি চেনে না তা ধরা পড়ে না।",
  "handoff.guard.failOpen":
    "Phoenix Core বা হুক চালানো না গেলে এজেন্টের কাজ চলতে থাকে (গার্ড খোলা অবস্থায় ব্যর্থ হয়), তবে পাওয়া গোপন তথ্য সবসময় আটকানো হয়।",
  "handoff.guard.countsLabel": "সিক্রেট গার্ডের ফলাফল",
  "handoff.guard.allowed": "যাচাইয়ের পর অনুমোদিত: {count}",
  "handoff.guard.blocked": "আটকানো: {count}",
  "handoff.guard.overridden": "আপনার অনুমোদনের পর অনুমোদিত: {count}",
  "handoff.guard.since": "{date} {time} থেকে গণনা",
  "handoff.guard.noResults": "এখনো কোনো ফলাফল নেই।",
  "handoff.guard.recentLabel": "সিক্রেট গার্ডের সাম্প্রতিক ফলাফল",
  "handoff.guard.row": "{date} {time} · {agent} · {tool}",
  "handoff.guard.outcome.blocked": "আটকানো হয়েছে",
  "handoff.guard.outcome.overridden": "আপনার অনুমোদনের পর অনুমোদিত",
  "handoff.guard.finding": "{kind}, অবস্থান: {location}",
};
