// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { statusLights as enStatusLights } from "../../en/status-lights";

/** Machine-translated; unreviewed. */
export const statusLights: Record<keyof typeof enStatusLights, string> = {
  "statusLights.limits":
    "শুধু নির্দিষ্ট রং পাঠানো হয়, কখনও কোনো লেখা নয়। ক্রেডেনশিয়াল (Hue অ্যাপ্লিকেশন কী, Luxafor টোকেন) শুধু লেখার জন্য: একবার সংরক্ষণ করলে আর কখনও দেখানো হয় না। কোনো লাইটের জানানো নাম ও আইডি সাধারণ টেক্সট হিসেবে দেখানো হয়।",
  "statusLights.line.luxafor": "{address}-এ Luxafor অ্যাপ",
  "statusLights.line.hue": "{bridge} ব্রিজে Hue লাইট",

  "statusLights.error.unavailable":
    "এই Phoenix Core-এ কোনো OS ক্রেডেনশিয়াল স্টোর নেই, তাই ক্রেডেনশিয়াল রাখা যায় না।",
  "statusLights.error.save": "লাইটের তালিকা সংরক্ষণ করা যায়নি। নাম ও ঠিকানা দেখে নিন।",
  "statusLights.error.capability": "স্ট্যাটাস লাইট সেটিং পরিবর্তন করা যায়নি।",
  "statusLights.error.hueName":
    "ব্রিজের একটি নাম দিন, যাতে অক্ষর, সংখ্যা এবং . _ : - থাকতে পারে (সর্বোচ্চ ১৬০ অক্ষর)।",
  "statusLights.error.hueInspect":
    "ব্রিজ ওই ঠিকানায় সাড়া দেয়নি। আপনার নিজের নেটওয়ার্কে এর IPv4 ঠিকানা ব্যবহার করুন।",
  "statusLights.error.huePair":
    "পেয়ারিং ব্যর্থ হয়েছে। ব্রিজের গোল লিংক বোতাম চাপুন, তারপর আবার চেষ্টা করুন।",
  "statusLights.error.hueRemove": "ব্রিজটি সরানো যায়নি।",
  "statusLights.error.hueLights": "এই ব্রিজের লাইটগুলোর তালিকা করা যায়নি।",
  "statusLights.error.luxaforToken":
    "টোকেন সংরক্ষণ করা হয়নি। এতে স্পেস ছাড়া ১ থেকে ১২৮টি প্রিন্টযোগ্য অক্ষর লাগবে।",
  "statusLights.error.lifx": "LIFX ডিসকভারি শেষ হয়নি। কয়েক সেকেন্ড অপেক্ষা করে আবার চেষ্টা করুন।",
  "statusLights.error.quietInvalid": "দুটি সময় এবং একটি সঠিক টাইম জোন দিন, যেমন Europe/Paris।",

  "statusLights.hue.title": "Philips Hue",
  "statusLights.hue.notAvailable":
    "Hue উপলব্ধ নয়: এই Phoenix Core-এ কোনো OS ক্রেডেনশিয়াল স্টোর নেই।",
  "statusLights.hue.loadFailed": "Hue ব্রিজ লোড করা যায়নি।",
  "statusLights.hue.intro":
    "পেয়ার করা ব্রিজকে তখনই বিশ্বাস করা হয়, যখন সে এমন সার্টিফিকেট দেখায় যার SHA-256 ফিঙ্গারপ্রিন্ট আপনি নিশ্চিত করেছেন। এর অ্যাপ্লিকেশন কী আপনার OS ক্রেডেনশিয়াল স্টোরে রাখা হয় এবং কখনও দেখানো হয় না।",
  "statusLights.hue.empty": "কোনো ব্রিজ পেয়ার করা নেই।",
  "statusLights.hue.bridgeLine": "{address}:{port}-এ",
  "statusLights.hue.fingerprint": "SHA-256 ফিঙ্গারপ্রিন্ট:",
  "statusLights.hue.find": "লাইট দেখান",
  "statusLights.hue.findNamed": "{name} ব্রিজের লাইটগুলো দেখান",
  "statusLights.hue.remove": "ব্রিজ সরান",
  "statusLights.hue.removeNamed": "{name} ব্রিজ সরান",
  "statusLights.hue.removeNote":
    "ব্রিজ সরালে এর সংরক্ষিত কী মুছে যায়। যে লাইটগুলো এটি ব্যবহার করে, সেগুলোর সঙ্গে আর যোগাযোগ করা হয় না।",
  "statusLights.hue.noLights": "এই ব্রিজ কোনো লাইট জানায়নি।",
  "statusLights.hue.alreadyAdded": "যোগ করা হয়েছে",
  "statusLights.hue.add": "যোগ করুন",
  "statusLights.hue.addNamed": "Hue লাইট {name} যোগ করুন",
  "statusLights.hue.pairTitle": "একটি ব্রিজ পেয়ার করুন",
  "statusLights.hue.name": "এই ব্রিজের নাম",
  "statusLights.hue.address": "আপনার নেটওয়ার্কে ব্রিজের ঠিকানা (যেমন 192.168.1.2)",
  "statusLights.hue.lookup": "ব্রিজের সার্টিফিকেট পড়ুন",
  "statusLights.hue.confirmGroup": "ব্রিজের সার্টিফিকেট নিশ্চিত করুন",
  "statusLights.hue.found": "{address}:{port}-এ একটি ব্রিজ সাড়া দিয়েছে।",
  "statusLights.hue.certName": "সার্টিফিকেটের বিষয়: {name}",
  "statusLights.hue.linkStep":
    "এখনই ব্রিজের উপরের গোল লিংক বোতাম চাপুন, তারপর নিচে নিশ্চিত করুন। বোতামটি গত প্রায় ৩০ সেকেন্ডের মধ্যে না চাপা হলে পেয়ারিং প্রত্যাখ্যাত হয়।",
  "statusLights.hue.confirm":
    "আমি এই ফিঙ্গারপ্রিন্টটি আমার ব্রিজের ফিঙ্গারপ্রিন্টের সঙ্গে মিলিয়ে দেখেছি এবং এই ব্রিজকে বিশ্বাস করি।",
  "statusLights.hue.pair": "পেয়ার করুন এবং এই ফিঙ্গারপ্রিন্ট পিন করুন",
  "statusLights.hue.cancel": "বাতিল",

  "statusLights.luxafor.title": "Luxafor",
  "statusLights.luxafor.intro":
    "Phoenix শুধু Luxafor অ্যাপের লোকাল ওয়েবহুকের সঙ্গে কথা বলে, আপনার নিজের নেটওয়ার্কে সাধারণ HTTP-তে। টোকেন যা-ই হোক, অ্যাপ সফল বলে সাড়া দেয়, তাই একটি সংরক্ষিত টোকেন প্রমাণ করে না যে লাইট বদলেছে।",
  "statusLights.luxafor.name": "এই Luxafor লাইটের নাম",
  "statusLights.luxafor.address": "যে কম্পিউটারে Luxafor অ্যাপ চলছে তার ঠিকানা",
  "statusLights.luxafor.add": "Luxafor লাইট যোগ করুন",
  "statusLights.luxafor.token": "ওয়েবহুক টোকেন",
  "statusLights.luxafor.tokenNamed": "{name}-এর ওয়েবহুক টোকেন",
  "statusLights.luxafor.save": "টোকেন সেট বা প্রতিস্থাপন করুন",
  "statusLights.luxafor.saved": "টোকেন সংরক্ষিত হয়েছে।",
  "statusLights.luxafor.writeOnly": "টোকেন আর কখনও দেখানো হবে না। এটি মুছতে এই লাইটটি সরান।",

  "statusLights.lifx.title": "LIFX",
  "statusLights.lifx.intro":
    "ডিসকভারি আপনার নেটওয়ার্কে একটি ব্রডকাস্ট পাঠায় এবং যে লাইটগুলো সাড়া দেয় সেগুলোর তালিকা করে। আপনি কোনো লাইট চালু না করা পর্যন্ত কিছু যোগ হয় না এবং কোনো রং পাঠানো হয় না।",
  "statusLights.lifx.discover": "LIFX লাইট খুঁজুন",
  "statusLights.lifx.none": "কোনো LIFX লাইট সাড়া দেয়নি।",
  "statusLights.lifx.line": "{address}-এ LIFX লাইট {serial}",
  "statusLights.lifx.added": "যোগ করা হয়েছে",
  "statusLights.lifx.enable": "এই লাইট যোগ করুন",
  "statusLights.lifx.enableNamed": "LIFX লাইট {serial} যোগ করুন",

  "statusLights.quiet.title": "শান্ত সময়",
  "statusLights.quiet.intro":
    "আপনার বেছে নেওয়া টাইম জোনে, এই দুই সময়ের মধ্যে লাইটগুলো বন্ধ থাকে।",
  "statusLights.quiet.off": "শান্ত সময় বন্ধ আছে।",
  "statusLights.quiet.on": "লাইটগুলো {start} থেকে {end} পর্যন্ত বন্ধ থাকে ({timezone})।",
  "statusLights.quiet.start": "শুরু",
  "statusLights.quiet.end": "শেষ",
  "statusLights.quiet.timezone": "টাইম জোন",
  "statusLights.quiet.save": "শান্ত সময় সংরক্ষণ করুন",
  "statusLights.quiet.clear": "শান্ত সময় বন্ধ করুন",
};
