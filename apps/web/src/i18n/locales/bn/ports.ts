// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { ports as enports } from "../../en/ports";

/** Machine-translated; unreviewed (see ../../README.md). */
export const ports: Record<keyof typeof enports, string> = {
  "ports.title": "পোর্ট রাডার",
  "ports.intro":
    "এই কম্পিউটারে কোন প্রোগ্রামগুলো নেটওয়ার্ক পোর্টে শুনছে, সেগুলো কোন প্রজেক্টে চলছে এবং কতক্ষণ ধরে চলছে তা দেখায়। স্ক্যান শুধু পড়ে; আপনি কোনো প্রোগ্রাম বন্ধ করে অনুমোদন না দিলে কিছুই বদলায় না।",
  "ports.disabled": "পোর্ট রাডার বন্ধ আছে। ব্যবহার করতে “পোর্ট ও প্রসেস রাডার” সক্ষমতা চালু করুন।",
  "ports.scan": "এখনই স্ক্যান করুন",
  "ports.scanning": "স্ক্যান হচ্ছে…",
  "ports.notScanned": "এখনও কিছু স্ক্যান করা হয়নি। “এখনই স্ক্যান করুন” বেছে নিন।",
  "ports.empty": "কোনো প্রোগ্রাম কোনো পোর্টে শুনছে না।",
  "ports.loadError": "পোর্ট পড়া যায়নি।",
  "ports.scannedAt": "স্ক্যানের সময়: {time}",
  "ports.count": "{count, plural, one {# টি শোনার পোর্ট} other {# টি শোনার পোর্ট}}",
  "ports.table.caption": "শোনার পোর্ট",
  "ports.col.port": "পোর্ট",
  "ports.col.process": "প্রোগ্রাম",
  "ports.col.project": "প্রজেক্ট",
  "ports.col.age": "চলছে",
  "ports.col.notes": "মন্তব্য",
  "ports.col.actions": "কাজ",
  "ports.pid": "প্রসেস {pid}",
  "ports.age.unknown": "অজানা",
  "ports.age.minutes": "{count, plural, one {# মিনিট} other {# মিনিট}}",
  "ports.age.hours": "{count, plural, one {# ঘণ্টা} other {# ঘণ্টা}}",
  "ports.age.days": "{count, plural, one {# দিন} other {# দিন}}",
  "ports.project.none": "কোনো প্রজেক্ট নেই",
  "ports.exposure.all": "নেটওয়ার্ক থেকে পৌঁছানো যায়",
  "ports.exposure.loopback": "শুধু এই কম্পিউটার",
  "ports.exposure.interface": "একটি নেটওয়ার্ক ঠিকানা",
  "ports.flag.forgotten": "হয়তো ভুলে যাওয়া",
  "ports.flag.heavy": "ভারী",
  "ports.flag.core": "স্বয়ং Phoenix",
  "ports.usage": "CPU {percent}%, মেমরি {mb} MB",
  "ports.help.forgotten":
    "হয়তো ভুলে যাওয়া: এটি একটি প্রজেক্ট ফোল্ডারে চলছে এবং {hours, plural, one {# ঘণ্টার} other {# ঘণ্টার}} বেশি সময় ধরে চলছে। কেউ এখনও এটি ব্যবহার করছে কি না Phoenix তা দেখতে পারে না।",
  "ports.help.heavy":
    "ভারী: CPU {cpu}% বা তার বেশি, অথবা মেমরি {mb} MB বা তার বেশি, ps যেমন জানায় (গড়, সরাসরি পাঠ নয়)।",
  "ports.open": "ব্রাউজারে খুলুন",
  "ports.open.label": "পোর্ট {port}-এ {name} আপনার ডিফল্ট ব্রাউজারে খুলুন",
  "ports.openNote":
    "লিংকগুলো আপনার ডিফল্ট ব্রাউজারে http://127.0.0.1 খোলে। Phoenix-এর নিজের ব্রাউজার এখনও নেই।",
  "ports.stop": "বন্ধ করুন…",
  "ports.stop.label": "পোর্ট {port}-এ {name} বন্ধ করুন",
  "ports.refusal.self": "এটি স্বয়ং Phoenix, যা নিজেকে কখনও বন্ধ করে না।",
  "ports.refusal.other_user": "এটি অন্য ব্যবহারকারীর।",
  "ports.refusal.system": "এটি একটি সিস্টেম প্রসেস।",
  "ports.refusal.not_dev_tool": "এটি এমন ডেভেলপার টুল নয় যা Phoenix বন্ধ করতে পারে।",
  "ports.refusal.unsupported": "এই সিস্টেমে বন্ধ করা যায় না।",
  "ports.refusal.unknown": "Phoenix এই প্রসেস যাচাই করতে পারেনি, তাই এটি বন্ধ করবে না।",
  "ports.confirm.title": "পোর্ট {port}-এ {name} বন্ধ করবেন?",
  "ports.confirm.body":
    "আপনি অনুমোদন দিলে Phoenix {name} (প্রসেস {pid})-কে বন্ধ হতে বলবে। প্রোগ্রামটির অসংরক্ষিত কাজ হারিয়ে যেতে পারে।",
  "ports.confirm.go": "বন্ধ করতে বলুন",
  "ports.confirm.cancel": "বাতিল",
  "ports.stop.waiting": "অনুমোদনে আপনার অনুমোদনের অপেক্ষা…",
  "ports.stop.exited": "{name} বন্ধ হয়েছে।",
  "ports.stop.stillRunning":
    "{name}-কে বন্ধ হতে বলা হয়েছিল এবং এটি এখনও চলছে। জোর করে বন্ধ করা এটিকে সঙ্গে সঙ্গে শেষ করে, ফেরানো যায় না এবং ডেটা হারাতে পারে।",
  "ports.force": "জোর করে বন্ধ করুন…",
  "ports.force.label": "পোর্ট {port}-এ {name} জোর করে বন্ধ করুন",
  "ports.force.hint":
    "বন্ধ হওয়ার অনুরোধের পর প্রথম কয়েক সেকেন্ড Phoenix জোর করে বন্ধ করতে অস্বীকার করে।",
  "ports.force.confirm": "জোর করে বন্ধ করুন",
  "ports.restart": "পুনরায় চালু করুন…",
  "ports.restart.label": "পোর্ট {port}-এ {name} পুনরায় চালু করুন",
  "ports.restart.title": "পোর্ট {port}-এ {name} পুনরায় চালু করবেন?",
  "ports.restart.body":
    "আপনি অনুমোদন করলে Phoenix {name} (প্রসেস {pid})-কে বন্ধ হতে বলবে এবং প্রোগ্রামটি বন্ধ হলেই কেবল আপনার সেট করা রিস্টার্ট রেসিপি নিচে যেমন দেখানো আছে ঠিক তেমন চালু করবে। প্রোগ্রামটি অসংরক্ষিত কাজ হারাতে পারে। চালু করা ব্যর্থ হলে প্রোগ্রামটি বন্ধই থাকবে।",
  "ports.restart.recipe": "রেসিপি",
  "ports.restart.argv": "প্রোগ্রাম ও আর্গুমেন্ট",
  "ports.restart.cwd": "ফোল্ডার",
  "ports.restart.go": "পুনরায় চালুর অনুরোধ করুন",
  "ports.restart.started":
    "{name} বন্ধ করা হয়েছে এবং {recipe} রেসিপি চালু করা হয়েছে (প্রসেস {pid})। এটি আবার শুনছে কি না Phoenix এখনই বলতে পারে না; আবার স্ক্যান করুন।",
  "ports.restart.note":
    "রিস্টার্ট কেবল সেই প্রোগ্রামের জন্য দেওয়া হয় যার পোর্টের জন্য আপনি এই সক্ষমতার সেটিংসে রিস্টার্ট রেসিপি লিখেছেন। চলমান প্রোগ্রাম থেকে Phoenix কখনও কমান্ড পুনর্গঠন করে না।",
  "ports.watch.label": "Phoenix খোলা থাকলে নিজে থেকে রিফ্রেশ করুন",
  "ports.watch.help":
    "ডিফল্টে বন্ধ। চালু থাকলে Phoenix প্রতি ১৫ সেকেন্ডে পোর্টের তালিকা পড়ে, শুধু যখন Phoenix-এর কোনো উইন্ডো খোলা থাকে।",
  "ports.noProcessTable": "প্রসেসের তালিকা পড়া যায়নি, তাই চলার সময় এবং বন্ধ করা উপলব্ধ নয়।",
  "ports.parseWarnings":
    "সিস্টেমের প্রসেস বা পোর্ট তালিকার কিছু লাইন বোঝা যায়নি এবং বাদ দেওয়া হয়েছে (প্রোগ্রামের নামে লাইন ব্রেক থাকতে পারে)। কিছু প্রোগ্রাম অনুপস্থিত থাকতে পারে বা এখানে বন্ধ করা যাবে না; বন্ধ করার সময় সবকিছু আবার যাচাই করা হয়।",
  "ports.windows.note":
    "Windows-এ রাডার শুধু পোর্ট ও প্রোগ্রামের নাম দেখায়; চলার সময়, প্রজেক্ট ও বন্ধ করা উপলব্ধ নয়।",
};
