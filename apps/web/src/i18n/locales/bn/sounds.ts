// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { sounds as ensounds } from "../../en/sounds";

/** Machine-translated; unreviewed (see ../../README.md). */
export const sounds: Record<keyof typeof ensounds, string> = {
  "sounds.title": "Fawkes-এর শব্দ",
  "sounds.intro":
    "কিছু ঘটলে Fawkes যে ছোট সুর বাজায়। ডিফল্টভাবে বন্ধ। এগুলো Phoenix নিজেই তৈরি করে এবং শান্ত মোড, শান্ত সময়, মিউট থাকা, জরুরি বন্ধ বা ডেমোর সময় কখনও বাজে না।",
  "sounds.enabled": "Fawkes-কে শব্দ করতে দিন",
  "sounds.volume": "ভলিউম",
  "sounds.volumeValue": "{percent} শতাংশ",
  "sounds.event.launch": "হ্যালো",
  "sounds.event.poke": "খোঁচা",
  "sounds.event.dizzy": "মাথা ঘোরা",
  "sounds.event.recover": "সুস্থ হলো",
  "sounds.event.completion": "কাজ শেষ",
  "sounds.event.needsYou": "আপনাকে দরকার",
  "sounds.event.failure": "কিছু ব্যর্থ হয়েছে",
  "sounds.preview.legend": "একটি শব্দ শুনুন",
  "sounds.preview.play": "বাজান: {name}",
  "sounds.preview.hint":
    "শব্দ বন্ধ থাকলেও প্রিভিউ উপরের ভলিউমে বাজে, এবং কেবল আপনি পেজ ব্যবহার করার পরে।",
  "sounds.preview.muted": "Fawkes মিউট করা, তাই কিছু বাজানো হয়নি।",
  "sounds.preview.silentVolume": "ভলিউম ০, তাই কিছু বাজানো হয়নি।",
  "sounds.preview.quiet": "শান্ত মোড, শান্ত সময়, জরুরি বন্ধ বা ডেমো চালু, তাই কিছু বাজানো হয়নি।",
  "sounds.preview.noGesture": "আগে পেজে ক্লিক করুন বা একটি কী চাপুন, তারপর আবার চেষ্টা করুন।",
  "sounds.preview.failed": "এই ডিভাইসে শব্দটি বাজানো যায়নি।",
  "sounds.saveFailed": "শব্দের সেটিংস সংরক্ষণ করা যায়নি।",
  "sounds.loadFailed": "শব্দের সেটিংস লোড করা যায়নি।",
  "sounds.note":
    "আপনার নিজের শব্দের ফোল্ডার এখনও পাওয়া যায় না; শুধু Phoenix-এর অন্তর্নির্মিত সুর ব্যবহৃত হয়।",
};
