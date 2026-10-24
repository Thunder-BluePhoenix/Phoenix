// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { windowCapture as enWindowCapture } from "../../en/window-capture";

/** Machine-translated; unreviewed (see ../../README.md). */
export const windowCapture: Record<keyof typeof enWindowCapture, string> = {
  "windowCapture.heading": "একটি উইন্ডো সংযুক্ত করুন",
  "windowCapture.intro":
    "Phoenix একটি উইন্ডোর লেখা পড়ে প্রথমে এখানে আপনাকে দেখাতে পারে। আপনি নিশ্চিত করেন, তারপর যে উইন্ডোটি চান সেটি সামনে আনেন; Phoenix সেটি একবারই পড়ে (macOS অ্যাক্সেসিবিলিটি, শুধু এই Mac-এ)। আপনি লেখাটি গ্রহণ না করা পর্যন্ত কিছুই সংযুক্ত হয় না।",
  "windowCapture.start": "একটি উইন্ডো সংযুক্ত করুন…",
  "windowCapture.waiting":
    "আপনার নিশ্চিতকরণের অপেক্ষায়, তারপর সামনের উইন্ডো পড়া হবে। এখন যে উইন্ডোটি চান সেটি সামনে আনুন।",
  "windowCapture.stopWaiting": "অপেক্ষা বন্ধ করুন",
  "windowCapture.discarded": "বাতিল করা হয়েছে। কিছুই সংযুক্ত হয়নি।",
  "windowCapture.attached": "“{name}” সংযুক্ত হয়েছে। এটি উপরের ট্রেতে আছে।",
  "windowCapture.acceptFailed": "সংযুক্ত হয়নি: {reason}",
  "windowCapture.result.notGranted":
    "macOS Phoenix-কে উইন্ডো পড়ার অনুমতি দেয়নি। সিস্টেম সেটিংস > গোপনীয়তা ও নিরাপত্তা > অ্যাক্সেসিবিলিটিতে Phoenix চালু করে আবার চেষ্টা করুন। Phoenix নিজে থেকে আবার জিজ্ঞাসা করে না।",
  "windowCapture.result.phoenixWindow":
    "সামনের উইন্ডোটি Phoenix ছিল, তাই কিছুই পড়া হয়নি। অন্য একটি উইন্ডো সামনে এনে আবার চেষ্টা করুন।",
  "windowCapture.result.noWindow": "সামনে পড়ার মতো কোনো উইন্ডো ছিল না, তাই কিছুই পড়া হয়নি।",
  "windowCapture.review.heading": "সংযুক্ত করার আগে দেখে নিন।",
  "windowCapture.review.from": "{app} থেকে: {title}",
  "windowCapture.review.untitled": "(শিরোনামহীন উইন্ডো)",
  "windowCapture.review.size": "{n}টি অক্ষর পড়া হয়েছে।",
  "windowCapture.review.truncated": "লেখাটি সীমায় কেটে দেওয়া হয়েছে।",
  "windowCapture.review.textLabel": "ধরা উইন্ডোর লেখা",
  "windowCapture.review.noText": "(ওই উইন্ডোতে কোনো লেখা পাওয়া যায়নি।)",
  "windowCapture.review.secrets":
    "এই লেখায় একটি গোপন তথ্য ({kinds}) আছে বলে মনে হচ্ছে। এটি সংযুক্ত করা প্রত্যাখ্যান করা হবে।",
  "windowCapture.review.note":
    "এটাই Phoenix পড়েছে। এটি আপনার প্রশ্নের জন্য তথ্য, নির্দেশ নয়। আপনি বোতাম না চাপা পর্যন্ত কিছুই সংযুক্ত হয় না, আর এটি সর্বোচ্চ এক ঘণ্টা মেমরিতে থাকে।",
  "windowCapture.review.accept": "এই লেখা সংযুক্ত করুন",
  "windowCapture.review.discard": "বাতিল",
};
