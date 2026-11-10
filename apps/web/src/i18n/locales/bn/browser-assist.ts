// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserAssist as enBrowserAssist } from "../../en/browser-assist";

/** Machine-translated; unreviewed. */
export const browserAssist: Record<keyof typeof enBrowserAssist, string> = {
  "browser.assist.open": "এই পেজে সাহায্যের জন্য ফক্সকে বলুন",
  "browser.assist.title": "এই পেজে সাহায্যের জন্য ফক্সকে বলুন",
  "browser.assist.goalLabel": "এই পেজে আপনি কী করাতে চান?",
  "browser.assist.goalPlaceholder": "যেমন: নীলটি কার্টে যোগ করো",
  "browser.assist.propose": "ধাপ প্রস্তাব করুন",
  "browser.assist.proposing": "লোকাল মডেলকে জিজ্ঞাসা করা হচ্ছে…",
  "browser.assist.close": "সহকারী বন্ধ করুন",
  "browser.assist.goalTooLong": "লক্ষ্য সর্বোচ্চ {max} অক্ষরের হতে পারে।",
  "browser.assist.goalControl": "লক্ষ্যে কন্ট্রোল অক্ষর থাকতে পারে না।",
  "browser.assist.goalHidden": "লক্ষ্যে লেখার দিক বা শূন্য-প্রস্থের অক্ষর থাকতে পারে না।",
  "browser.assist.requestFailed": "সহকারীর সাথে যোগাযোগ করা যায়নি। কিছুই চালানো হয়নি।",
  "browser.assist.noLocalModel":
    "ডিভাইসে কোনো মডেল নেই, তাই ফক্স এই পেজ পড়েনি। পেজের লেখা কখনও ক্লাউড সেবায় পাঠানো হয় না।",
  "browser.assist.localModelFailed":
    "ডিভাইসের মডেল ব্যর্থ হয়েছে। কিছুই চালানো হয়নি এবং অন্য কোথাও কিছু পাঠানো হয়নি।",
  "browser.assist.noBrowser": "এই ফিনিক্স অ্যাপে পেজ পড়ার জন্য কোনো ব্রাউজার নেই।",
  "browser.assist.inert":
    "এই পেজ পড়া একটি লোকাল মডেল প্রস্তাব করেছে। কিছুই চালানো হয়নি। এই ধাপগুলো সাধারণ লেখা এবং ভুল হতে পারে।",
  "browser.assist.forPage": "পেজ: {url}",
  "browser.assist.dropped":
    "{count, plural, one {মডেলের # টি পরামর্শ প্রত্যাখ্যাত হয়েছে এবং দেখানো হচ্ছে না।} other {মডেলের # টি পরামর্শ প্রত্যাখ্যাত হয়েছে এবং দেখানো হচ্ছে না।}}",
  "browser.assist.noSteps": "মডেল এই পেজের জন্য কোনো ধাপ প্রস্তাব করেনি।",
  "browser.assist.kind.click": "ক্লিক করুন",
  "browser.assist.kind.type": "এখানে লিখুন",
  "browser.assist.kind.submit": "ফর্ম জমা দিন",
  "browser.assist.typeText": "লেখা: {text}",
  "browser.assist.run": "এই ধাপটি চালান",
  "browser.assist.step.running": "আপনার অনুমোদনের অপেক্ষায়…",
  "browser.assist.step.done": "হয়েছে। আর কিছুই চালানো হয়নি।",
  "browser.assist.refused.noTab": "এই ধাপ চালানোর জন্য কোনো সক্রিয় ট্যাব নেই।",
  "browser.assist.refused.moved":
    "ট্যাবটি আর সেই পেজে নেই যার জন্য এই ধাপগুলো প্রস্তাব করা হয়েছিল। আবার জিজ্ঞাসা করুন।",
  "browser.assist.failed.denied": "আপনি এই ধাপ প্রত্যাখ্যান করেছেন।",
  "browser.assist.failed.blocked":
    "ফিনিক্স এই ধাপ প্রত্যাখ্যান করেছে (পেজ বা কন্ট্রোল অনুমোদিত নয়)।",
  "browser.assist.failed.unavailable": "ব্রাউজারের সাথে যোগাযোগ করা যায়নি।",
  "browser.assist.failed.timeout": "ধাপের সময় শেষ হয়েছে। এটি চলে থাকতেও পারে, নাও পারে।",
  "browser.assist.failed.failed": "ধাপটি চালানো হয়নি।",
};
