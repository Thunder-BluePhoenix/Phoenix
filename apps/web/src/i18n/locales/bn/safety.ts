// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { safety as ensafety } from "../../en/safety";

/** Machine-translated; unreviewed (see ../../README.md). */
export const safety: Record<keyof typeof ensafety, string> = {
  "safety.title": "এজেন্ট সুরক্ষা জাল",
  "safety.intro":
    "কোনো সেশনে কোডিং এজেন্টের প্রথম রিপোর্ট করা সম্পাদনার আগে Phoenix প্রকল্পের নিজস্ব git রিপোজিটরিতে প্রকল্পের একটি স্ন্যাপশট সংরক্ষণ করে (একটি লুকানো রেফ; আপনার ব্র্যাঞ্চ, ইনডেক্স ও স্ট্যাশ কখনও স্পর্শ করা হয় না)। প্রিভিউ দেখে এবং আপনার অনুমোদনের পর আপনি ফাইলগুলো সেখানে ফিরিয়ে নিতে পারেন।",
  "safety.timing":
    "Claude Code টুল চলার পরে ধাপটি রিপোর্ট করে, তাই স্ন্যাপশট নেওয়া হয় প্রথম সম্পাদনার রিপোর্টের সময়: সেই প্রথম সম্পাদনা সাধারণত ইতিমধ্যেই এতে থাকে। রোল ব্যাক করলে এজেন্ট তার পরে যা করেছে তা ফেরানো হয়, প্রথম সম্পাদনা নিজে নয়।",
  "safety.ignored":
    "git যে ফাইলগুলো উপেক্ষা করে (বিল্ড আউটপুট, লগ, নির্ভরতা) সেগুলো সংরক্ষণ করা হয় না এবং কখনও পুনরুদ্ধার বা মুছে ফেলাও হয় না।",
  "safety.loadFailed": "সুরক্ষা জাল লোড করা যায়নি: {error}",
  "safety.killSwitch": "কিল সুইচ চালু আছে, তাই নতুন কোনো চেকপয়েন্ট নেওয়া হচ্ছে না।",

  "safety.warnings.title": "Fawkes-এর সতর্কতা",
  "safety.warnings.loop": "লুপ",
  "safety.warnings.stall": "আটকে গেছে",
  "safety.warnings.line": "{kind} · {repository}-এ {agent}: {reason}",

  "safety.checkpoints.title": "চেকপয়েন্ট",
  "safety.checkpoints.none":
    "এখনও কোনো চেকপয়েন্ট নেই। কোনো এজেন্টের প্রথম সম্পাদনা রিপোর্ট হলে একটি নেওয়া হয়।",
  "safety.checkpoints.row": "{repository}-এ {agent}",
  "safety.checkpoints.facts":
    "নেওয়া হয়েছে {taken} · {count, plural, one {#টি ফাইল} other {#টি ফাইল}} · {expires} পর্যন্ত রাখা হবে",
  "safety.checkpoints.rolledBack": "রোল ব্যাক করা হয়েছে {when}",
  "safety.checkpoints.preview": "রোল ব্যাকের প্রিভিউ…",
  "safety.checkpoints.previewLabel":
    "{repository}-এ {agent}-এর চেকপয়েন্টে রোল ব্যাকের প্রিভিউ দেখুন",
  "safety.checkpoints.close": "প্রিভিউ বন্ধ করুন",

  "safety.skipped.title": "চেকপয়েন্টবিহীন সেশন",
  "safety.skipped.line": "{repository}-এ {agent}: {reason}",
  "safety.skipped.disabled": "সুরক্ষা জাল বন্ধ করা আছে",
  "safety.skipped.kill_switch": "কিল সুইচ চালু ছিল",
  "safety.skipped.not_git": "এই ফোল্ডারটি git রিপোজিটরি নয়, তাই স্ন্যাপশট নেওয়ার কিছু নেই",
  "safety.skipped.git_unavailable": "git চালানো যায়নি",
  "safety.skipped.too_many_files": "প্রকল্পে ফাইলের সংখ্যা সীমার চেয়ে বেশি",
  "safety.skipped.too_large": "প্রকল্পটি আকারের সীমার চেয়ে বড়",
  "safety.skipped.throttled": "এই প্রকল্পে গত এক মিনিটে ইতিমধ্যে একটি চেকপয়েন্ট নেওয়া হয়েছে",
  "safety.skipped.snapshot_failed": "git স্ন্যাপশট নিতে পারেনি",

  "safety.preview.title": "রোল ব্যাকের প্রিভিউ",
  "safety.preview.counts":
    "{restore, plural, one {#টি ফাইল পুনরুদ্ধার করা হবে} other {#টি ফাইল পুনরুদ্ধার করা হবে}}, {remove, plural, one {#টি নতুন ফাইল মুছে ফেলা হবে} other {#টি নতুন ফাইল মুছে ফেলা হবে}}, {kept, plural, one {#টি পার্থক্য যেমন আছে তেমন রাখা হবে} other {#টি পার্থক্য যেমন আছে তেমন রাখা হবে}}।",
  "safety.preview.restore": "চেকপয়েন্টে পুনরুদ্ধার করা হবে",
  "safety.preview.remove": "যে নতুন ফাইলগুলো মুছে ফেলা হবে",
  "safety.preview.kept": "যেমন আছে তেমন রাখা হবে",
  "safety.preview.change.modified": "পরিবর্তিত",
  "safety.preview.change.deleted": "এজেন্ট মুছে ফেলেছে",
  "safety.preview.change.type_changed": "ধরন বদলেছে",
  "safety.preview.why.tracked_by_head": "git ট্র্যাক করে, তাই মোছা হয় না",
  "safety.preview.why.ignored": "git উপেক্ষা করে",
  "safety.preview.why.submodule": "একটি সাবমডিউল",
  "safety.preview.why.unsafe_path": "পাথটি স্পর্শ করা নিরাপদ নয়",
  "safety.preview.why.not_a_file": "সাধারণ ফাইল নয়",
  "safety.preview.truncated": "তালিকাগুলো কাটা হয়েছে; উপরের সংখ্যাগুলো নির্ভুল।",
  "safety.preview.diff": "চেকপয়েন্টের পর থেকে পরিবর্তন",
  "safety.preview.diffTruncated": "ডিফ তার আকারের সীমায় কাটা হয়েছে।",
  "safety.preview.diffRedacted": "গোপন তথ্যের মতো দেখতে কিছু লেখা মাস্ক করা হয়েছে।",
  "safety.preview.diffEmpty": "দেখানোর মতো কোনো লেখার পরিবর্তন নেই।",
  "safety.preview.nothing":
    "ফাইলগুলো ইতিমধ্যেই চেকপয়েন্টের সাথে মিলে গেছে। রোল ব্যাক করার কিছু নেই।",
  "safety.preview.refusal.repository_missing": "প্রকল্পটি আর এখানে git রিপোজিটরি নয়।",
  "safety.preview.refusal.checkpoint_gone": "স্ন্যাপশটটি আর রিপোজিটরিতে নেই।",
  "safety.preview.refusal.head_moved":
    "চেকপয়েন্টের পর রিপোজিটরির HEAD সরে গেছে (কমিট বা ব্র্যাঞ্চ বদলের কারণে)। Phoenix তা পেরিয়ে রোল ব্যাক করবে না; কিছুই পরিবর্তন করা হয়নি।",
  "safety.preview.refusal.snapshot_failed": "Git ওয়ার্কিং ট্রি পড়তে পারেনি।",
  "safety.preview.approvalNote":
    "রোল ব্যাকের আগে আপনার অনুমোদন চাওয়া হয়। এটি কখনও git ইতিহাস, ব্র্যাঞ্চ, ইনডেক্স বা স্ট্যাশ বদলায় না, এবং এই প্রিভিউয়ের পর ফাইল বদলে গেলে এটি প্রত্যাখ্যান করে।",

  "safety.rollback.button": "রোল ব্যাক করুন…",
  "safety.rollback.waiting": "উপরের অনুমোদন তালিকায় আপনার অনুমোদনের অপেক্ষায়…",
  "safety.rollback.done":
    "রোল ব্যাক সম্পন্ন: {restored, plural, one {#টি ফাইল পুনরুদ্ধার করা হয়েছে} other {#টি ফাইল পুনরুদ্ধার করা হয়েছে}}, {removed, plural, one {#টি নতুন ফাইল মুছে ফেলা হয়েছে} other {#টি নতুন ফাইল মুছে ফেলা হয়েছে}}।",
  "safety.rollback.exact": "ফাইলগুলো এখন চেকপয়েন্টের সাথে মিলে গেছে।",
  "safety.rollback.inexact":
    "কিছু পার্থক্য যেমন আছে তেমন রাখা হয়েছে, তাই ফাইলগুলো চেকপয়েন্টের সাথে হুবহু মেলে না।",

  "safety.settings.title": "সেটিংস",
  "safety.settings.enabled": "এজেন্টের প্রথম সম্পাদনা রিপোর্ট হলে একটি চেকপয়েন্ট নিন",
  "safety.settings.notify": "Fawkes লুপ বা আটকে যাওয়া নিয়ে সতর্ক করলে একটি বিজ্ঞপ্তি পাঠান",
  "safety.settings.retention": "চেকপয়েন্ট রাখার সময় (দিন)",
  "safety.settings.maxFiles": "এর চেয়ে বেশি ফাইলের প্রকল্প বাদ দিন",
  "safety.settings.loopThreshold": "এতবার পুনরাবৃত্তির পর লুপের সতর্কতা",
  "safety.settings.waitingMin": "কোনো এজেন্ট আপনার জন্য এত সময় অপেক্ষা করলে সতর্ক করুন (মিনিট)",
  "safety.settings.idleMin": "কোনো সক্রিয় এজেন্ট এত সময় নীরব থাকলে সতর্ক করুন (মিনিট)",
  "safety.settings.saved": "সংরক্ষিত হয়েছে।",
  "safety.settings.detectNote":
    "হুক কোনো এক্সিট কোড বা ফাইলের বিষয়বস্তু রিপোর্ট করে না, তাই লুপ বলতে বোঝায় একই কমান্ড বারবার চালানো, অথবা এমন একটি ফাইল যার সম্পাদনাগুলো একে অপরকে বাতিল করতে থাকে (লাইনের সংখ্যা অনুযায়ী)।",
};
