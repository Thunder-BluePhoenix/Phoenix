// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { phone as enphone } from "../../en/phone";

/** Machine-translated; unreviewed (see ../../README.md). */
export const phone: Record<keyof typeof enphone, string> = {
  "phone.title": "ফোন লিঙ্ক",
  "phone.intro":
    "একটি ফোন যুক্ত করুন, যাতে Phoenix যা জিজ্ঞেস করে তা সে অনুমোদন বা প্রত্যাখ্যান করতে পারে। আপনি চালু না করা পর্যন্ত এটি বন্ধ থাকে।",
  "phone.unavailable": "ফোন লিঙ্কের সেটিংস লোড করা যায়নি।",
  "phone.warning.title": "চালু করার আগে",
  "phone.warning.network":
    "চালু করলে একটি আলাদা HTTPS লিসেনার খোলে, যেখানে আপনার লোকাল নেটওয়ার্কের অন্য ডিভাইস পৌঁছাতে পারে (ইন্টারনেট নয়)।",
  "phone.warning.pairing":
    "শুধু যে ফোনগুলো আপনি যুক্ত করে এখানে নিশ্চিত করেছেন সেগুলোই কিছু অনুমোদন করতে পারে। যুক্ত করতে এই স্ক্রিনে দেখানো কোড লাগে।",
  "phone.warning.trust": "শুধু বিশ্বাসযোগ্য নেটওয়ার্কে চালু করুন, যেমন আপনার বাড়ির নেটওয়ার্ক।",
  "phone.warning.presence":
    "Phoenix যাচাই করতে পারে না যে এই কম্পিউটারে কোনো ব্যক্তি আছেন: এই কম্পিউটারের যেকোনো প্রোগ্রাম, যার কাছে Core সেশন টোকেন আছে, সেও ফোন যুক্ত করতে পারে।",
  "phone.enable.label": "আমার লোকাল নেটওয়ার্কের ফোনকে সংযুক্ত হতে দিন",
  "phone.saved.on": "ফোন লিঙ্ক চালু আছে।",
  "phone.saved.off": "ফোন লিঙ্ক বন্ধ আছে।",
  "phone.saved.verifyOn": "ফোন থেকে অনুমোদনে এখন বায়োমেট্রিক বা ডিভাইস যাচাই চাওয়া হবে।",
  "phone.saved.verifyOff": "ফোন থেকে অনুমোদনে আর ডিভাইস যাচাই চাওয়া হবে না।",
  "phone.killSwitch":
    "কিল সুইচ চালু আছে, তাই ফোন লিসেনার বন্ধ। কিল সুইচ সরানোর পর এখানে ফোন লিঙ্ক আবার চালু করুন।",
  "phone.lockedOut": "অনেকগুলো ভুল কোড দেওয়ায় যুক্ত করা {time} পর্যন্ত লক করা আছে।",
  "phone.notListening": "ফোন লিঙ্ক চালু আছে, কিন্তু লিসেনার এখনও চলছে না।",
  "phone.addressChanged":
    "আপনার বেছে নেওয়া নেটওয়ার্ক ঠিকানাটি আর পাওয়া যাচ্ছে না, তাই ফোন লিঙ্ক বন্ধ থাকবে। আবার চালু করতে নতুন করে একটি ঠিকানা বেছে নিন।",
  "phone.addressChanged.title": "এই কম্পিউটারের ঠিকানা বদলে গেছে",
  "phone.addressChanged.mayNotReach":
    "আগে যে ফোন যুক্ত করেছেন সেটি আর এই কম্পিউটারে পৌঁছাতে নাও পারে, কারণ সেটি এখনও পুরোনো ঠিকানা মনে রেখেছে। অন্য কোনো নেটওয়ার্কে কিছু খোলা হয়নি।",
  "phone.addressChanged.pick": "নেটওয়ার্ক ঠিকানা",
  "phone.addressChanged.use": "এই ঠিকানা ব্যবহার করুন",
  "phone.addressChanged.none":
    "এই মুহূর্তে কোনো ব্যক্তিগত লোকাল নেটওয়ার্ক ঠিকানা পাওয়া যায়নি। আপনার নেটওয়ার্কে সংযুক্ত হয়ে ফিরে আসুন, অথবা ফোন লিঙ্ক বন্ধ করুন।",
  "phone.addressChanged.off": "ফোন লিঙ্ক বন্ধ করুন",
  "phone.addressChanged.repair":
    "একটি ঠিকানা বেছে নেওয়ার পর, ফোন তবুও সংযুক্ত না হতে পারলে নতুন পেয়ারিং কোড দেখান এবং ফোনটি আবার যুক্ত করুন।",
  "phone.saved.address": "ফোন লিঙ্কের ঠিকানা বদলানো হয়েছে।",
  "phone.port.label": "পোর্ট",
  "phone.port.save": "পোর্ট সংরক্ষণ করুন",
  "phone.port.invalid": "1024 থেকে 65535 এর মধ্যে একটি পূর্ণসংখ্যা লিখুন।",
  "phone.port.note":
    "ফোন লিঙ্ক এই পোর্টে শোনে (1024 থেকে 65535; ডিফল্ট 47821)। নতুন পোর্ট লিঙ্ক পরের বার খোলার সময় কার্যকর হয়; এখন চালু থাকলে এটি নতুন পোর্টে আবার চালু হয় এবং স্ক্রিনে থাকা যেকোনো পেয়ারিং কোড কাজ করা বন্ধ করে। আগে যুক্ত করা ফোন পুরোনো পোর্ট ব্যবহার করতে পারে এবং আবার যুক্ত করতে হতে পারে।",
  "phone.saved.port": "ফোন লিঙ্কের পোর্ট সংরক্ষিত হয়েছে: {port}।",
  "phone.pair.qrLabel": "পেয়ারিং লিঙ্কসহ QR কোড",
  "phone.pair.qrHint":
    "যে ফোনটি যুক্ত করছেন তার অ্যাপ দিয়ে স্ক্যান করুন। এতে উপরের কোডটি আছে, তাই শুধু নিজের ফোনকে দেখান।",
  "phone.pair.qrUnavailable": "এই লিঙ্কের জন্য QR কোড তৈরি করা যায়নি; নিচের লিঙ্কটি ব্যবহার করুন।",
  "phone.listen.address": "ঠিকানা ও পোর্ট",
  "phone.listen.fingerprint": "সার্টিফিকেট ফিঙ্গারপ্রিন্ট (SHA-256)",
  "phone.pair.show": "পেয়ারিং কোড দেখান",
  "phone.pair.cancel": "কোড বাতিল করুন",
  "phone.pair.cancelled": "পেয়ারিং কোড বাতিল হয়েছে।",
  "phone.pair.expired": "পেয়ারিং কোডের মেয়াদ শেষ হয়েছে। ফোন যুক্ত করতে নতুন কোড দেখান।",
  "phone.pair.instruction":
    "ফোনে এই কোড লিখুন বা স্ক্যান করুন, এবং সেখানে দেখানো ফিঙ্গারপ্রিন্ট নিচেরটির সাথে মেলে কিনা দেখুন। না মিললে এগোবেন না।",
  "phone.pair.codeLabel": "পেয়ারিং কোড",
  "phone.pair.remaining": "{time} পরে মেয়াদ শেষ",
  "phone.pair.fingerprint": "সার্টিফিকেট ফিঙ্গারপ্রিন্ট:",
  "phone.pair.link": "পেয়ারিং লিঙ্ক (ফোন QR কোড স্ক্যান করতে না পারলে):",
  "phone.pair.hiddenActive":
    "একটি পেয়ারিং কোড {time} পর্যন্ত সক্রিয়। এটি আর দেখানো হয় না; বাতিল করে নতুন কোড দেখান।",
  "phone.pending.question": '"{name}" যুক্ত করবেন?',
  "phone.pending.fingerprint": "কী ফিঙ্গারপ্রিন্ট",
  "phone.pending.yes": "হ্যাঁ, এই ফোন যুক্ত করুন",
  "phone.pending.no": "না, প্রত্যাখ্যান করুন",
  "phone.pending.waiting": "Phoenix আপনার নিশ্চিতকরণ চাওয়ার অপেক্ষায়।",
  "phone.pending.approved": "ফোন যুক্ত হয়েছে।",
  "phone.pending.rejected": "যুক্ত করা প্রত্যাখ্যাত হয়েছে।",
  "phone.verify.label": "অনুমোদনে বায়োমেট্রিক বা ডিভাইস যাচাই আবশ্যক করুন",
  "phone.verify.note":
    "ফোন জানায় ব্যক্তিকে যাচাই করা হয়েছে কিনা (ফিঙ্গারপ্রিন্ট, মুখ বা স্ক্রিন লক)। Phoenix নিজে সেই রিপোর্ট যাচাই করতে পারে না।",
  "phone.devices.title": "যুক্ত ফোন",
  "phone.devices.none": "কোনো ফোন যুক্ত নেই।",
  "phone.devices.fingerprint": "কী ফিঙ্গারপ্রিন্ট",
  "phone.devices.created": "{date} তারিখে যুক্ত",
  "phone.devices.lastSeen": "সর্বশেষ দেখা গেছে {when}",
  "phone.devices.neverSeen": "কখনও দেখা যায়নি",
  "phone.devices.revoked": "{date} তারিখে বাতিল",
  "phone.devices.revoke": "{name} বাতিল করুন",
  "phone.devices.revokeAsk": '"{name}" বাতিল করবেন? এটি আর কিছু অনুমোদন করতে পারবে না।',
  "phone.devices.revokeYes": "হ্যাঁ, বাতিল করুন",
  "phone.devices.revokeNo": "রেখে দিন",
  "phone.devices.revokedDone": "ফোন বাতিল হয়েছে।",
  "phone.device.unnamed": "নামহীন ফোন",
};
