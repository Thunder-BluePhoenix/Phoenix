// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { power as enpower } from "../../en/power";

/** Machine-translated; unreviewed (see ../../README.md). */
export const power: Record<keyof typeof enpower, string> = {
  "power.awake.duration.minutes": "{minutes, plural, one {# মিনিট} other {# মিনিট}}",
  "power.awake.duration.hours": "{hours, plural, one {# ঘণ্টা} other {# ঘণ্টা}}",
  "power.awake.heading": "জাগিয়ে রাখুন",
  "power.awake.disabled": "“জাগিয়ে রাখুন” বন্ধ আছে। ব্যবহার করতে এই সক্ষমতা চালু করুন।",
  "power.awake.waiting": "আপনার অনুমোদনের অপেক্ষায়…",
  "power.awake.idle": "কম্পিউটার স্বাভাবিকভাবে ঘুমায়। জাগিয়ে রাখতে সময়সীমার সেশন শুরু করুন।",
  "power.awake.start.heading": "এতক্ষণ জাগিয়ে রাখুন",
  "power.awake.custom.label": "মিনিট",
  "power.awake.reason.label": "কারণ (ঐচ্ছিক)",
  "power.awake.custom.start": "শুরু করুন",
  "power.awake.custom.invalid": "{min} থেকে {max}-এর মধ্যে পূর্ণসংখ্যার মিনিট লিখুন।",
  "power.awake.agents.start": "এজেন্টরা কাজ করার সময়",
  "power.awake.agents.help":
    "কোনো কোডিং এজেন্ট কাজ করলে জাগিয়ে রাখে, এবং শেষটি শেষ হওয়ার কয়েক মিনিট পরে শেষ হয় (উপরের মিনিট ব্যবহার করে)।",
  "power.awake.agents.working":
    "{count, plural, one {# এজেন্ট কাজ করছে} other {# এজেন্ট কাজ করছে}}",
  "power.awake.agents.grace":
    "শেষ এজেন্ট শেষ হওয়ার {minutes, plural, one {# মিনিট} other {# মিনিট}} পরে শেষ হয়।",
  "power.awake.running": "কম্পিউটার জাগিয়ে রাখা হচ্ছে",
  "power.awake.remaining": "বাকি সময়: {time}",
  "power.awake.endsAt": "{time}-এ শেষ",
  "power.awake.extend.label": "সময় যোগ করুন",
  "power.awake.extend.button": "+{duration}",
  "power.awake.end.hold": "শেষ করতে চেপে ধরুন",
  "power.awake.end.holding": "চেপে ধরে রাখুন…",
  "power.awake.end.hint":
    "সেশন শেষ করতে বোতামটি ১.৫ সেকেন্ড চেপে ধরুন (বা স্পেস অথবা এন্টার চেপে ধরুন)।",
  "power.awake.battery": "প্লাগ খোলা অবস্থায় ব্যাটারি {percent}%-এর নিচে নামলেও সেশন শেষ হয়।",
  "power.awake.lid":
    "ঢাকনা বন্ধ করলে কম্পিউটার তবুও ঘুমিয়ে পড়ে; ঢাকনা বন্ধ রেখে জাগিয়ে রাখতে আলাদা লিড-ক্লোজড মোড লাগে।",
  "power.awake.indicator": "জাগ্রত {time}",
  "power.recovery.heading": "লিড-ক্লোজড মোড ও পুনরুদ্ধার",
  "power.recovery.waiting": "আপনার অনুমোদনের অপেক্ষায়…",
  "power.recovery.unreadable": "পুনরুদ্ধারের অবস্থা পড়া যায়নি।",
  "power.recovery.journal.clean": "পূর্বাবস্থায় ফেরানোর জন্য কিছু অপেক্ষায় নেই।",
  "power.recovery.journal.pending":
    "Phoenix {count, plural, one {# টি সিস্টেম পরিবর্তন} other {# টি সিস্টেম পরিবর্তন}} পুনরুদ্ধার করতে পারেনি। স্লিপ সেটিংস এখনও বদলানো থাকতে পারে।",
  "power.recovery.journal.kind.disablesleep": "ঢাকনা বন্ধ থাকলেও ঘুম বন্ধ",
  "power.recovery.journal.kind.lowpowermode": "লো পাওয়ার মোড",
  "power.recovery.journal.kind.other": "অন্য পরিবর্তন",
  "power.recovery.journal.at": "{time} থেকে",
  "power.recovery.journal.undo": "এখনই পূর্বাবস্থায় ফেরান",
  "power.recovery.journal.untrusted":
    "{count, plural, one {# টি অপঠনযোগ্য জার্নাল লাইন} other {# টি অপঠনযোগ্য জার্নাল লাইন}} উপেক্ষা করা হয়েছে, বিশ্বাস করা হয়নি।",
  "power.recovery.journal.cannotQuit":
    "এগুলি পূর্বাবস্থায় না ফেরানো পর্যন্ত Phoenix বন্ধ করা প্রত্যাখ্যান করা হবে।",
  "power.recovery.lid.open": "ঢাকনা খোলা।",
  "power.recovery.lid.closed": "ঢাকনা বন্ধ।",
  "power.recovery.lid.unknown": "ঢাকনার অবস্থা অজানা।",
  "power.recovery.lid.unsupported":
    "এই কম্পিউটারে ঢাকনার সেন্সর নেই, তাই লিড-ক্লোজড মোড পাওয়া যাবে না।",
  "power.recovery.helper.installed": "বিশেষাধিকারপ্রাপ্ত সহায়ক ইনস্টল করা আছে",
  "power.recovery.helper.missing":
    "বিশেষাধিকারপ্রাপ্ত সহায়ক ইনস্টল করা নেই (লিড-ক্লোজড মোড অনুপলব্ধ)। docs/awake-helper.md দেখুন।",
  "power.recovery.helper.unknown": "বিশেষাধিকারপ্রাপ্ত সহায়ক ইনস্টল করা আছে কিনা তা অজানা।",
  "power.recovery.floors.off": "সীমা বন্ধ আছে",
  "power.recovery.floors.rule":
    "{low} %-এর নিচে লো পাওয়ার মোড, {end} %-এর নিচে সেশন শেষ; তাপ: {heatLow}-এ লো পাওয়ার মোড, {heatEnd}-এ শেষ।",
  "power.recovery.floors.lowPowerActive": "লো পাওয়ার মোড চালু আছে",
  "power.recovery.floors.battery.none": "ব্যাটারি: নেই",
  "power.recovery.floors.battery.unknown": "ব্যাটারি: অজানা",
  "power.recovery.floors.battery.level": "ব্যাটারি {percent} %",
  "power.recovery.floors.battery.unplugged": "ব্যাটারি {percent} %, প্লাগ খোলা",
  "power.recovery.floors.battery.plugged": "ব্যাটারি {percent} %, প্লাগ লাগানো",
  "power.recovery.floors.thermal.nominal": "স্বাভাবিক",
  "power.recovery.floors.thermal.fair": "কুসুম গরম",
  "power.recovery.floors.thermal.serious": "গরম",
  "power.recovery.floors.thermal.critical": "সংকটজনক",
  "power.recovery.floors.thermal.level": "তাপ: {level}",
  "power.recovery.floors.thermal.unsupported": "তাপ: জানানো হয় না",
  "power.recovery.floors.thermal.unknown": "তাপ: অজানা",
  "power.recovery.safety.warning":
    "লিড-ক্লোজড মোড চালু থাকলে কম্পিউটার কখনও ব্যাগ, কেস বা অন্য বদ্ধ জায়গায় নিয়ে যাবেন না: এটি অতিরিক্ত গরম হতে পারে। ভেন্ট খোলা রাখুন।",
  "power.recovery.safety.understand": "আমি বুঝেছি",
  "power.recovery.safety.acknowledge": "স্বীকার করুন",
  "power.recovery.safety.done": "আপনি লিড-ক্লোজড নিরাপত্তা সতর্কতা স্বীকার করেছেন।",
  "power.recovery.start": "লিড-ক্লোজড মোড শুরু করুন",
  "power.recovery.end": "লিড-ক্লোজড মোড শেষ করুন",
  "power.recovery.engaged": "লিড-ক্লোজড মোড চালু আছে।",
  "power.recovery.engagedSince": "লিড-ক্লোজড মোড {time} থেকে চালু আছে।",
  "power.recovery.needsSession":
    "আগে জাগিয়ে রাখার সেশন শুরু করুন; লিড-ক্লোজড মোডের জন্য এটি দরকার।",
  "power.recovery.journal.discard": "এই এন্ট্রি বাদ দিন",
  "power.recovery.lockBlocked":
    "অন্য একটি পুনরুদ্ধার প্রক্রিয়া লকটি ধরে রেখেছে, তাই এখনও কিছুই পূর্বাবস্থায় ফেরানো হয়নি। পরিবর্তনটি এখনও মুলতুবি।",
  "power.recovery.sleepUnjournaled":
    "এই কম্পিউটারে স্লিপ নিষ্ক্রিয়, কিন্তু Phoenix-এর কাছে এটি বন্ধ করার কোনো রেকর্ড নেই। অন্য কিছু এটি বদলেছে।",
  "power.recovery.journalPath": "জার্নাল: {path}",
  "power.continuity.heading": "এজেন্টের ধারাবাহিকতা",
  "power.continuity.intro":
    "দীর্ঘ এজেন্ট রানের জন্য অতিরিক্ত সুবিধা। প্রতিটি আপনি চালু না করা পর্যন্ত বন্ধ থাকে, এবং এদের কোনোটিই আপনার হয়ে নেটওয়ার্ক, টার্মিনাল বা প্রোগ্রাম বেছে নেয় না।",
  "power.continuity.needsAwake":
    "এই সেটিংস কেবল তখনই কার্যকর হয় যখন “জাগিয়ে রাখা” (Keep awake) সক্ষমতা চালু থাকে।",
  "power.continuity.saved":
    "সংরক্ষিত হয়েছে। পরিবর্তনগুলো পরেরবার “জাগিয়ে রাখা” শুরু হলে প্রযোজ্য হবে।",
  "power.continuity.applyNote":
    "পরিবর্তনগুলো “জাগিয়ে রাখা” (Keep awake) সক্ষমতায় সংরক্ষিত হয় এবং এটি পরেরবার চালু করলে প্রযোজ্য হয়।",
  "power.continuity.network.title": "নেটওয়ার্ক পর্যবেক্ষণ",
  "power.continuity.network.help":
    "আপনার নির্দিষ্ট করা কম্পিউটারে যোগাযোগ করা যাচ্ছে কি না তা প্রতি কয়েক সেকেন্ড পরপর যাচাই করে, এবং নেটওয়ার্ক বন্ধ হলে ও ফিরে এলে Phoenix-কে জানায়। এটি কেবল সংযোগ করে; কিছু পাঠায় না, কিছু পড়েও না।",
  "power.continuity.hosts.label": "যাচাই করার হোস্ট (নাম বা নাম:পোর্ট)",
  "power.continuity.hotspot.title": "হটস্পট ফেইলওভার",
  "power.continuity.hotspot.help":
    "জাগিয়ে রাখার সেশন চলাকালীন Wi-Fi বিচ্ছিন্ন হলে আপনার নির্দিষ্ট করা iPhone হটস্পটে যুক্ত হয়। উপরের নেটওয়ার্ক পর্যবেক্ষণ এবং হোস্টের একটি তালিকা প্রয়োজন। শুধু macOS-এ কাজ করে এবং কোনো আসল Mac-এ পরীক্ষা করা হয়নি।",
  "power.continuity.hotspot.ssid": "হটস্পটের নাম (SSID)",
  "power.continuity.hotspot.disclosure":
    "এটি চালু করার আগে: macOS কমান্ড লাইনে কোনো পাসওয়ার্ড ছাড়াই এমন নেটওয়ার্কে যুক্ত হতে পারে যা সে আগে থেকেই চেনে, তাই আগে নিজে হাতে একবার আপনার হটস্পটে যুক্ত হয়ে নিন। কেবল যদি আপনি নিচের সংরক্ষিত পাসওয়ার্ডেরও অনুমতি দেন, তবেই Phoenix সেটি macOS-এর networksetup টুলে পাঠায়, এবং তখন যুক্ত হতে যে কয়েক সেকেন্ড লাগে, সেই সময়ে এই Mac-এর প্রতিটি প্রোগ্রাম ওই কমান্ড লাইনে পাসওয়ার্ডটি পড়তে পারে। আপনাকে না জিজ্ঞাসা করে এটি করার আর কোনো নিরাপদ বিল্ট-ইন উপায় নেই। এটি গ্রহণযোগ্য না হলে অনুমতি দেবেন না।",
  "power.continuity.hotspot.allowPassword":
    "আমি এটি মেনে নিচ্ছি: কমান্ড লাইনে সংরক্ষিত হটস্পট পাসওয়ার্ড ব্যবহার করা হোক",
  "power.continuity.hotspot.passwordSaved": "keychain-এ একটি হটস্পট পাসওয়ার্ড সংরক্ষিত আছে।",
  "power.continuity.hotspot.passwordMissing":
    "কোনো হটস্পট পাসওয়ার্ড সংরক্ষিত নেই। “জাগিয়ে রাখা” (Keep awake) সক্ষমতার “hotspot_password” সিক্রেট হিসেবে একটি সংরক্ষণ করুন, অথবা এই বাক্সটি বন্ধ রেখে একবার নিজে হাতে হটস্পটে যুক্ত হন।",
  "power.continuity.hotspot.join": "এখনই হটস্পটে যুক্ত হন",
  "power.continuity.hotspot.rejoin": "আমার আগের নেটওয়ার্কে আবার যুক্ত হন",
  "power.continuity.hotspot.confirmNote":
    "কোনো নেটওয়ার্কে যুক্ত হলে এই Mac কোন Wi-Fi ব্যবহার করবে তা বদলে যায়। Phoenix প্রতিবার আপনার নিশ্চিতকরণ চাইবে।",
  "power.continuity.hotspot.joined": "যুক্ত হয়েছে।",
  "power.continuity.nudge.title": "এজেন্টদের ঠেলা দিন",
  "power.continuity.nudge.help":
    "নিচের সময় ধরে নেটওয়ার্ক না থাকলে, আপনার তালিকাভুক্ত টার্মিনালগুলোতে “continue” টাইপ করা হয়। মিটিং বা ডিক্টেশনের সময় কিছু টাইপ করা হয় না, এবং প্রতিটি টার্মিনাল প্রতি বিভ্রাটে সর্বোচ্চ একবার এটি পায়।",
  "power.continuity.nudge.after": "ঠেলা দেওয়ার আগে নেটওয়ার্কহীন সেকেন্ড (৩০ থেকে ৩৬০০)",
  "power.continuity.nudge.panes": "tmux প্যান (যেমন %12)",
  "power.continuity.nudge.sessions": "Phoenix এজেন্ট সেশন (ph- এবং ১৬টি হেক্স অঙ্ক)",
  "power.continuity.nudge.sessionsNote":
    "এখনো উপলব্ধ নয়: ট্র্যাক করা সেশনে টাইপ করার কোনো নিরাপদ উপায় Phoenix-এর নেই, তাই তালিকাভুক্ত সেশনগুলো বাদ দেওয়া হয় এবং তা জানানো হয়। কেবল tmux প্যানগুলোতে ঠেলা দেওয়া হয়।",
  "power.continuity.nudge.commands": "যেসব প্রোগ্রাম একটি প্যানে চলতে পারে (যেমন claude)",
  "power.continuity.nudge.commandsNote":
    "টাইপ করার আগে Phoenix যাচাই করে যে প্যানটি এখনো আছে এবং এই প্রোগ্রামগুলোর একটি চালাচ্ছে। তালিকা খালি থাকলে কখনোই কিছু টাইপ করা হয় না।",
  "power.continuity.nudge.enter": "Enter-ও চাপুন",
  "power.continuity.nudge.enterHelp":
    "ডিফল্টভাবে বন্ধ। এটি ছাড়া “continue” টাইপ করা হয় কিন্তু পাঠানো হয় না, তাই আপনাকে নিজে Enter চাপতে হবে।",
  "power.continuity.throttle.title": "ব্রাউজার থ্রটলিং যাচাই",
  "power.continuity.throttle.help":
    "Chrome, Arc, Comet, Edge এবং Brave ব্যাকগ্রাউন্ড ট্যাবকে ধীর করে দেয়, যা এজেন্টের ওয়েব পেজ আটকে দিতে পারে। এটি সেভাবে চলমান ব্রাউজারগুলোর তালিকা দেখায়। আপনি Relaunch বেছে নিয়ে নিশ্চিত না করলে এটি কখনোই কোনো ব্রাউজার পরিবর্তন করে না।",
  "power.continuity.throttle.unsupported": "ব্রাউজার যাচাই কেবল macOS-এ কাজ করে।",
  "power.continuity.throttle.notRunning": "চলছে না",
  "power.continuity.throttle.throttled": "ব্যাকগ্রাউন্ড থ্রটলিং সহ চলছে",
  "power.continuity.throttle.fine": "থ্রটলিং ছাড়া চলছে",
  "power.continuity.throttle.relaunch": "{name} থ্রটলিং ছাড়া পুনরায় চালু করুন",
  "power.continuity.throttle.confirm":
    "ব্যাকগ্রাউন্ড থ্রটলিং ছাড়া {name} পুনরায় চালু করবেন? {name} বন্ধ হয়ে আবার খুলবে, এর ট্যাবগুলো পুনরায় লোড হবে, এবং কোনো পেজে যা সংরক্ষণ করা হয়নি তা হারিয়ে যেতে পারে। মিটিং বা ডিক্টেশনের সময় এটি প্রত্যাখ্যান করা হয়।",
  "power.continuity.throttle.confirmYes": "বন্ধ করে পুনরায় চালু করুন",
  "power.continuity.throttle.relaunched": "{name} পুনরায় চালু করা হয়েছে।",
  "power.continuity.outage.title": "সর্বশেষ নেটওয়ার্ক বিভ্রাট",
  "power.continuity.outage.none": "এখনো কোনো নেটওয়ার্ক বিভ্রাট দেখা যায়নি।",
  "power.continuity.outage.down": "{time} থেকে নেটওয়ার্ক বন্ধ আছে।",
  "power.continuity.outage.ended": "{from} থেকে {to} পর্যন্ত নেটওয়ার্ক বন্ধ ছিল।",
  "power.continuity.outage.nudged":
    "{count, plural, one {#টি টার্মিনালে ঠেলা দেওয়া হয়েছে} other {#টি টার্মিনালে ঠেলা দেওয়া হয়েছে}}",
  "power.continuity.outage.hotspot.joined": "হটস্পটে যুক্ত হয়েছে",
  "power.continuity.outage.hotspot.failed": "হটস্পটে যুক্ত হওয়া ব্যর্থ হয়েছে",
  "power.continuity.outage.hotspot.skipped":
    "হটস্পটে চেষ্টা করা হয়নি (বন্ধ, অথবা কোনো সেশন চলছে না)",
  "power.continuity.outage.hotspot.notTried": "হটস্পটে এখনো চেষ্টা করা হয়নি",
  "power.continuity.list.empty": "কিছু তালিকাভুক্ত নেই।",
  "power.continuity.list.remove": "{item} সরান",
  "power.continuity.invalid.host":
    "একটি হোস্টের নাম বা ঠিকানা ব্যবহার করুন, ঐচ্ছিকভাবে :পোর্ট সহ (১ থেকে ৬৫৫৩৫)।",
  "power.continuity.invalid.pane":
    "%12-এর মতো একটি tmux প্যান আইডি ব্যবহার করুন: একটি শতাংশ চিহ্ন এবং সর্বোচ্চ ছয়টি অঙ্ক।",
  "power.continuity.invalid.session": "ph-0123456789abcdef-এর মতো একটি সেশন আইডি ব্যবহার করুন।",
  "power.continuity.invalid.command":
    "claude-এর মতো একটি প্রোগ্রামের নাম ব্যবহার করুন: কেবল অক্ষর, অঙ্ক এবং . _ + - ব্যবহার করা যাবে।",
  "power.continuity.invalid.ssid":
    "১ থেকে ৩২ বাইটের দৃশ্যমান লেখা ব্যবহার করুন, যা হাইফেন দিয়ে শুরু হয় না।",
  "power.continuity.invalid.seconds": "{min} থেকে {max} এর মধ্যে একটি পূর্ণসংখ্যার সেকেন্ড লিখুন।",
  "power.continuity.problem.duplicate": "এই এন্ট্রি ইতিমধ্যে তালিকায় আছে।",
  "power.continuity.problem.full": "তালিকা পূর্ণ (সর্বোচ্চ {max}টি এন্ট্রি)।",
  "power.continuity.reason.unsupported_platform": "এটি কেবল macOS-এ কাজ করে।",
  "power.continuity.reason.no_wifi_device": "Phoenix এই Mac-এর Wi-Fi ডিভাইস খুঁজে পায়নি।",
  "power.continuity.reason.no_hotspot_configured":
    "যুক্ত হওয়ার মতো কোনো ব্যবহারযোগ্য হটস্পট বা আগের নেটওয়ার্ক নেই।",
  "power.continuity.reason.bad_password":
    "সংরক্ষিত পাসওয়ার্ডটি ব্যবহার করা যাচ্ছে না। keychain-এ এটি পরীক্ষা করুন।",
  "power.continuity.reason.join_failed": "macOS নেটওয়ার্কে যুক্ত হতে পারেনি।",
  "power.continuity.reason.unknown_browser": "ওই ব্রাউজারটি Phoenix পরিচালনা করে না।",
  "power.continuity.reason.protected": "এখন নয়: একটি মিটিং বা ডিক্টেশন চলছে।",
  "power.continuity.reason.not_running": "ওই ব্রাউজারটি চলছে না।",
  "power.continuity.reason.already_unthrottled":
    "ওই ব্রাউজারটি ইতিমধ্যে ব্যাকগ্রাউন্ড থ্রটলিং ছাড়াই চলছে।",
  "power.continuity.reason.unavailable": "এটি এখন উপলব্ধ নয়।",
  "power.continuity.reason.quit_failed": "ব্রাউজারটি বন্ধ করার অনুরোধ গ্রহণ করেনি।",
  "power.continuity.reason.still_running":
    "ব্রাউজারটি এখনো খোলা আছে, তাই এটি আবার খোলা হয়নি। নিজে এটি বন্ধ করুন, তারপর আবার চেষ্টা করুন।",
  "power.continuity.reason.open_failed": "ব্রাউজারটি বন্ধ হয়েছে কিন্তু আবার খোলা যায়নি।",
  "power.continuity.reason.other": "এটি কাজ করেনি।",
  "power.lid.heading": "ঢাকনা বন্ধ হলে পদক্ষেপ",
  "power.lid.intro":
    '"জাগিয়ে রাখুন" সেশন চলাকালীন আপনি ঢাকনা বন্ধ করলে Phoenix বিদ্যুৎ বাঁচাতে এবং এই কম্পিউটারকে শান্ত রাখতে পারে। ঢাকনা খুললে, সেশন শেষ হলে এবং ক্র্যাশের পর Phoenix আবার চালু হলে সবকিছু আগের অবস্থায় ফেরানো হয়।',
  "power.lid.needsAwake": 'এই পদক্ষেপগুলো কেবল তখনই চলে যখন "জাগিয়ে রাখুন" সক্ষমতা চালু থাকে।',
  "power.lid.master.title": "ঢাকনা বন্ধ হলে পদক্ষেপ চালান",
  "power.lid.master.help": "প্রধান সুইচ। বন্ধ থাকলে নিচের কিছুই চলবে না।",
  "power.lid.display.title": "ডিসপ্লে বন্ধ করুন",
  "power.lid.display.help":
    "ডিসপ্লেকে ঘুম পাড়ায়। বিনামূল্যের উজ্জ্বলতা টুল ইনস্টল থাকলে উজ্জ্বলতা সংরক্ষিত ও পুনরুদ্ধার হয়।",
  "power.lid.freeze.title": "চ্যাট অ্যাপ ফ্রিজ করুন",
  "power.lid.freeze.help":
    "বেছে নেওয়া চ্যাট অ্যাপগুলো থামিয়ে দেয় যাতে বিদ্যুৎ খরচ না হয়, তারপর আবার চালু করে। মিটিং, রেকর্ডিং বা ডিক্টেশনের সময় কখনও নয়, আর টার্মিনাল, এডিটর বা চলমান কোডিং এজেন্টের জন্যও কখনও নয়।",
  "power.lid.freeze.apps": "যে অ্যাপ ফ্রিজ হবে",
  "power.lid.mute.title": "শব্দ মিউট করুন",
  "power.lid.mute.help":
    "সাউন্ড আউটপুট মিউট করে এবং ঠিক আগের মতো ফিরিয়ে দেয়, মাঝখানে আউটপুট বদলালেও।",
  "power.lid.lowPower.title": "লো পাওয়ার মোড",
  "power.lid.lowPower.help":
    "লো পাওয়ার মোড চালু করে। ঐচ্ছিক বিশেষাধিকার সহায়ক লাগে; না থাকলে এটি বাদ যায়।",
  "power.lid.docker.title": "Docker Desktop ফ্রিজ করুন",
  "power.lid.docker.help":
    "কোনো কনটেইনার না চললে Docker Desktop থামায়। কনটেইনার চললে বা Docker-এর অবস্থা অজানা থাকলে কখনও নয়।",
  "power.lid.nap.title": "এজেন্ট অ্যাপকে App Nap থেকে দূরে রাখুন",
  "power.lid.nap.help":
    "আপনার তালিকার অ্যাপগুলোকে macOS ধীর করা থেকে আটকায়। তাদের আগের সেটিং সংরক্ষিত থাকে এবং ঠিক আগের মতো ফেরানো হয়।",
  "power.lid.nap.apps": "অ্যাপ (বান্ডল আইডি, যেমন com.example.App)",
  "power.lid.protected.title": "কখনও ফ্রিজ হয় না",
  "power.lid.protected.help":
    "এগুলো সবসময় অক্ষত থাকে। আপনি তালিকায় যোগ করতে পারেন, কিন্তু অন্তর্নির্মিত সুরক্ষা সরানো যায় না।",
  "power.lid.protected.builtIn": "অন্তর্নির্মিত",
  "power.lid.protected.extra": "প্রোগ্রাম বা অ্যাপের নাম যোগ করুন",
  "power.lid.list.empty": "কিছু যোগ করা হয়নি।",
  "power.lid.list.remove": "{item} সরান",
  "power.lid.list.duplicate": "এটি ইতিমধ্যে তালিকায় আছে।",
  "power.lid.list.full": "তালিকা পূর্ণ ({max}টি এন্ট্রি)।",
  "power.lid.invalid.bundle":
    "com.example.App-এর মতো বান্ডল আইডি ব্যবহার করুন: অক্ষর, অঙ্ক ও হাইফেন, অন্তত একটি ডট সহ।",
  "power.lid.invalid.name":
    "সাধারণ প্রোগ্রাম বা অ্যাপের নাম ব্যবহার করুন: অক্ষর, অঙ্ক, স্পেস এবং . _ + -",
  "power.lid.unsupported": "এখানে উপলব্ধ নয়: {reason}",
  "power.lid.gapNote":
    "এগুলোর কিছু এই কম্পিউটারে আংশিকভাবে কাজ করে। কী সমর্থিত আর কী নয় তা জানতে README-lid.md দেখুন।",
  "power.lid.last.title": "ঢাকনার শেষ ঘটনা",
  "power.lid.last.closed": "ঢাকনা {time}-এ বন্ধ হয়েছে।",
  "power.lid.last.opened": "ঢাকনা {time}-এ খুলেছে।",
  "power.lid.last.none": "এখনও কিছু ঘটেনি।",
  "power.lid.last.mismatched":
    "{count, plural, other {#টি প্রক্রিয়া আবার চালু করা হয়নি কারণ সেগুলো আর Phoenix যা ফ্রিজ করেছিল তার সঙ্গে মেলে না।}}",
  "power.lid.last.stillClosed": "ঢাকনা এখন বন্ধ এবং উপরের পদক্ষেপগুলো প্রয়োগ করা আছে।",
  "power.lid.outcome.applied": "সম্পন্ন",
  "power.lid.outcome.skipped": "বাদ দেওয়া হয়েছে",
  "power.lid.outcome.failed": "ব্যর্থ",
  "power.lid.outcome.undone": "ফিরিয়ে আনা হয়েছে",
  "power.lid.outcome.undo_failed": "ফেরানো যায়নি (Phoenix আবার চেষ্টা করবে)",
  "power.lid.reason.unsupported_platform": "এটি কেবল Mac-এ সমর্থিত।",
  "power.lid.reason.helper_unavailable": "বিশেষাধিকার সহায়ক ইনস্টল করা নেই।",
  "power.lid.reason.tool_missing": "প্রয়োজনীয় একটি টুল ইনস্টল করা নেই।",
  "power.lid.reason.already_on": "অন্য কারণে ইতিমধ্যে চালু আছে।",
  "power.lid.reason.state_unknown":
    "আপনি মিটিংয়ে আছেন কিনা Phoenix জানতে পারে না, তাই কিছু করেনি।",
  "power.lid.reason.protected_state": "একটি মিটিং, রেকর্ডিং বা ডিক্টেশন চলছে।",
  "power.lid.reason.docker_busy": "একটি কনটেইনার চলছে।",
  "power.lid.reason.docker_unknown": "Docker-এর অবস্থা অজানা।",
  "power.lid.reason.process_list_unavailable": "চলমান প্রোগ্রামের তালিকা পড়া যায়নি।",
  "power.lid.reason.audio_unavailable": "সাউন্ড আউটপুট পড়া যায়নি।",
  "power.lid.reason.no_targets": "বদলানোর কিছু ছিল না।",
  "power.lid.reason.nothing_to_do": "বদলানোর কিছু ছিল না।",
  "power.lid.reason.journal_unwritable": "রিকভারি জার্নাল লেখা যায়নি, তাই কিছু বদলানো হয়নি।",
  "power.lid.reason.not_applied": "কিছু বদলানো হয়নি।",
  "power.lid.reason.apply_failed": "পরিবর্তনটি করা যায়নি।",
  "power.lid.reason.undo_failed": "পরিবর্তনটি ফেরানো যায়নি।",
  "power.lid.reason.assertions_unknown":
    "Phoenix বুঝতে পারছে না কোনো অ্যাপ কলে আছে কি না, তাই কিছুই ফ্রিজ করেনি।",
  "power.lid.reason.holds_assertion":
    "সব চ্যাট অ্যাপ ব্যবহারে আছে (কল বা প্লেব্যাক), তাই কোনোটিই ফ্রিজ করা হয়নি।",
  "power.lid.reason.output_changed":
    "ঢাকনা বন্ধ থাকার সময় সাউন্ড আউটপুট বদলানো হয়েছে, তাই Phoenix নতুন আউটপুটে হাত দেয়নি। যে আউটপুট সে মিউট করেছিল তা আবার ডিফল্ট না হওয়া পর্যন্ত মিউট থাকবে।",
  "power.lid.reason.retry_or_alert":
    "ফ্রিজ করা একটি অ্যাপ আবার চালু হয়েছে বলে মনে হচ্ছে, তাই Phoenix সেটি চালু করেনি। আপনার চ্যাট অ্যাপগুলো ঠিকঠাক চলছে কি না দেখুন।",
  "power.lid.reason.not_ours":
    "কিছু প্রসেস আবার চালু করা যায়নি, কারণ সেগুলো নিয়ন্ত্রণ করা Phoenix-এর কাজ নয়।",
  "power.lid.limit.output_identity_unknown":
    "Phoenix সাউন্ড আউটপুটের নাম পড়তে পারছে না, তাই আউটপুট বদলেছে কি না বুঝতে পারছে না।",
  "power.lid.limit.brightness_tool_untrusted":
    "ব্রাইটনেস টুলের ফাইল চালানো নিরাপদ নয় (ভুল মালিক, বা অন্যরা লিখতে পারে), তাই ব্যবহার করা হয়নি।",
  "power.lid.reason.other": "এটি কাজ করেনি।",
  "power.lid.limit.brightness_tool_missing":
    "বিনামূল্যের উজ্জ্বলতা টুল ইনস্টল করা নেই, তাই শুধু ডিসপ্লে স্লিপ ব্যবহার হয় এবং উজ্জ্বলতা বদলায় না।",
  "power.lid.limit.keyboard_backlight_unsupported":
    "থার্ড-পার্টি সফটওয়্যার ছাড়া কিবোর্ডের আলো নিয়ন্ত্রণ করা যায় না।",
  "power.lid.limit.default_output_only": "শুধু বর্তমান ডিফল্ট আউটপুট মিউট করা যায়।",
  "power.lid.applyNote":
    "পরিবর্তন কার্যকর হয় পরের বার কোনো সেশন ঢাকনা বন্ধ হতে দেখলে। সবকিছু করার আগে জার্নালে লেখা হয়।",
  "power.lid.saved": "সংরক্ষিত।",
  "power.lid.glance.closed": "ঢাকনা বন্ধ: ঢাকনা-বন্ধ পদক্ষেপ প্রয়োগ করা আছে।",
  "power.lid.glance.failed":
    'একটি ঢাকনা-বন্ধ পদক্ষেপ ফেরানো যায়নি। বিস্তারিত জানতে "জাগিয়ে রাখুন" খুলুন।',
};
