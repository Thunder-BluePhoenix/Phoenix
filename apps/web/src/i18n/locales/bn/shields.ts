// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { shields as enShields } from "../../en/shields";

/** Machine-translated; unreviewed. */
export const shields: Record<keyof typeof enShields, string> = {
  "shields.title": "বিজ্ঞাপন ও ট্র্যাকার ব্লক করা",
  "shields.intro":
    "এই সেটিংস Phoenix ব্রাউজার প্রকাশিত হলে তাতে প্রযোজ্য হবে। Phoenix-এর এখনও ব্রাউজার উইন্ডো নেই, তাই আজ কোনো পেজেই কিছু ব্লক হয় না। এভাবে শুধু নেটওয়ার্ক অনুরোধ ব্লক করা যায়: পেজের উপাদান লুকানো সমর্থিত নয়, আর এটি অন্য কোনো ব্রাউজারের সুরক্ষার অনুলিপি নয়।",
  "shields.unavailable":
    "Phoenix Core থেকে বিজ্ঞাপন ও ট্র্যাকার ব্লক করার সেটিংস পাওয়া যাচ্ছে না।",
  "shields.loadFailed": "Phoenix Core থেকে ব্লক করার সেটিংস পড়া যায়নি।",
  "shields.global.label": "বিজ্ঞাপন ও ট্র্যাকার ব্লক করুন",
  "shields.global.hint":
    "বন্ধ থাকলে কোনো তালিকা কোনো সাইটে প্রয়োগ হয় না। চালু থাকলে এবং কোনো তালিকা ডাউনলোড না থাকলে পরিচিত বিজ্ঞাপন ও অ্যানালিটিক্স হোস্টের একটি ছোট অন্তর্নির্মিত তালিকা ব্যবহার হয়।",
  "shields.lists.title": "ফিল্টার তালিকা",
  "shields.lists.note":
    "তালিকা Phoenix-এর সঙ্গে আসে না এবং কখনও নিজে থেকে ডাউনলোড হয় না। আপডেট চাপলে সেই তালিকা ডাউনলোড করতে easylist.to-এর সঙ্গে একবার যোগাযোগ করা হয়। আপনার বা আপনার পেজের কিছুই পাঠানো হয় না।",
  "shields.list.purpose.ads": "বিজ্ঞাপন ব্লক করে",
  "shields.list.purpose.trackers": "ট্র্যাকিং ব্লক করে",
  "shields.list.never": "কখনও ডাউনলোড হয়নি।",
  "shields.list.damaged":
    "সংরক্ষিত অনুলিপিটি ক্ষতিগ্রস্ত এবং ব্যবহার হয় না। আবার ডাউনলোড করতে আপডেট চাপুন।",
  "shields.list.status":
    "{date} তারিখে ডাউনলোড · {rules}টি ব্লক নিয়ম · {cosmetic}টি পেজ-উপাদান নিয়ম উপেক্ষিত",
  "shields.list.version": "তালিকার সংস্করণ {version}",
  "shields.list.due":
    "তালিকাটি {date}-এর পর নতুন সংস্করণ খুঁজতে বলে। Phoenix কখনও নিজে থেকে যাচাই করে না।",
  "shields.list.licence": "লাইসেন্স: {licence}। কৃতজ্ঞতা: {attribution}।",
  "shields.list.source": "আপডেট {source}-এর সঙ্গে যোগাযোগ করে",
  "shields.list.enable": "{name} ব্যবহার করুন",
  "shields.list.enableNeedsDownload": "চালু করার আগে তালিকা ডাউনলোড করুন।",
  "shields.list.update": "আপডেট",
  "shields.list.updateFirst": "ডাউনলোড",
  "shields.list.updating": "ডাউনলোড হচ্ছে…",
  "shields.list.updated": "{name} আপডেট হয়েছে।",
  "shields.list.remove": "ডাউনলোড করা অনুলিপি মুছুন",
  "shields.list.removed": "{name}-এর ডাউনলোড করা অনুলিপি মুছে ফেলা হয়েছে।",
  "shields.sites.title": "যেসব সাইটে ব্লক করা বন্ধ",
  "shields.sites.empty": "কোনো সাইটে ব্লক করা বন্ধ নেই।",
  "shields.sites.add.label": "সাইটের নাম, যেমন example.com",
  "shields.sites.add.submit": "এই সাইটের জন্য ব্লক করা বন্ধ করুন",
  "shields.sites.remove": "{site}-এর জন্য ব্লক করা আবার চালু করুন",
  "shields.sites.hint":
    "শুধু সাইটের নাম লিখুন, ঠিকানা নয়। সাইট ও তার সাবডোমেন অন্তর্ভুক্ত। YouTube সংগীত সাইটের অনুমতি থাকা পর্যন্ত YouTube-এর নিজের বিজ্ঞাপনে হাত দেওয়া হয় না; এটি সংগীত সাইটে ঠিক করা হয়, এখানে নয়।",
};
