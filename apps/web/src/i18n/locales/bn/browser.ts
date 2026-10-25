// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browser as enBrowser } from "../../en/browser";

/** Machine-translated; unreviewed. */
export const browser: Record<keyof typeof enBrowser, string> = {
  "browser.tabs.label": "ট্যাব",
  "browser.tab.untitled": "নতুন ট্যাব",
  "browser.tab.loading": "লোড হচ্ছে",
  "browser.tab.close": "ট্যাব {title} বন্ধ করুন",
  "browser.tab.new": "নতুন ট্যাব",
  "browser.nav.back": "পিছনে",
  "browser.nav.forward": "সামনে",
  "browser.nav.reload": "রিলোড",
  "browser.address.label": "ঠিকানা বা অনুসন্ধান",
  "browser.address.placeholder": "অনুসন্ধান করুন বা ঠিকানা লিখুন",
  "browser.address.go": "যান",
  "browser.address.blocked": "খোলা হয়নি: {text}",
  "browser.deny.unparseable": "এটি বৈধ ওয়েব ঠিকানা নয়।",
  "browser.deny.scheme_not_allowed": "শুধু নিরাপদ ওয়েব ঠিকানা (https) খোলা যায়।",
  "browser.deny.dangerous_scheme": "যে ঠিকানা কোড চালায় বা পৃষ্ঠাটিকেই ধারণ করে তা খোলা যায় না।",
  "browser.deny.file_blocked": "এই কম্পিউটারের ফাইল এখানে খোলা যায় না।",
  "browser.deny.credentials_in_url":
    "ব্যবহারকারীর নাম বা পাসওয়ার্ড থাকা ঠিকানা প্রত্যাখ্যান করা হয়।",
  "browser.deny.private_network":
    "এই কম্পিউটার বা আপনার স্থানীয় নেটওয়ার্কের ঠিকানা এখানে লেখা যায় না। বদলে পোর্ট রাডার থেকে প্রোগ্রামের পৃষ্ঠা খুলুন।",
  "browser.deny.bad_port": "ওই পোর্ট ব্লক করা হয়েছে কারণ এটি ওয়েব-বহির্ভূত পরিষেবার।",
  "browser.deny.insecure_blocked": "সাধারণ http ঠিকানা খোলা হয় না।",
  "browser.deny.site_denied": "এই সাইট ব্লক তালিকায় আছে।",
  "browser.deny.dns_private":
    "ওই নাম এই কম্পিউটার বা আপনার স্থানীয় নেটওয়ার্কের একটি ঠিকানার দিকে নির্দেশ করে।",
  "browser.deny.port_radar_invalid":
    "পোর্ট রাডারের অনুরোধটি এই কম্পিউটারের সাধারণ পৃষ্ঠা ছিল না, তাই উপেক্ষা করা হয়েছে।",
  "browser.deny.unknown": "ওই ঠিকানা প্রত্যাখ্যান করা হয়েছে।",
  "browser.zoom.label": "জুম",
  "browser.zoom.out": "জুম কমান",
  "browser.zoom.in": "জুম বাড়ান",
  "browser.zoom.reset": "জুম {percent}-এ রিসেট করুন",
  "browser.shields.label": "{site}-এ বিজ্ঞাপন ও ট্র্যাকার ব্লক করুন",
  "browser.shields.saveFailed":
    "পছন্দটি এখানে প্রয়োগ হয়েছে কিন্তু Phoenix Core-এ সংরক্ষণ করা যায়নি।",
  "browser.shields.blocked": "{count, plural, one {#টি অনুরোধ ব্লক} other {#টি অনুরোধ ব্লক}}",
  "browser.empty": "কোনো ট্যাব খোলা নেই। উপরে ঠিকানা বা অনুসন্ধান লিখুন।",
  "browser.noShell":
    "এই পৃষ্ঠাটি Phoenix ব্রাউজারের টুলবার। এটি শুধু Phoenix ডেস্কটপ অ্যাপের ভেতরে কাজ করে।",
  "browser.radar.title": "এই কম্পিউটারের প্রোগ্রাম খুলবেন?",
  "browser.radar.body":
    "পোর্ট রাডার এই ঠিকানা খুলতে বলছে। এটি এই কম্পিউটারে চলা প্রোগ্রাম, ওয়েবসাইট নয়, এবং এনক্রিপ্টেড নয়।",
  "browser.radar.url": "ঠিকানা: {url}",
  "browser.radar.open": "খুলুন",
  "browser.radar.cancel": "বাতিল",
  "browser.error.action": "ব্রাউজার এটি করতে পারেনি।",
};
