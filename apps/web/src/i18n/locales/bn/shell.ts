// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { shell as enShell } from "../../en/shell";

/** Machine-translated; unreviewed (see ../../README.md). */
export const shell: Record<keyof typeof enShell, string> = {
  "shell.nav.home": "Phoenix হোম",
  "shell.nav.main": "প্রধান",
  "shell.nav.meetings": "মিটিং",
  "shell.nav.provenance": "উৎস-পরিচয়",
  "shell.nav.agents": "এজেন্ট",
  "shell.nav.workflows": "ওয়ার্কফ্লো",
  "shell.nav.recap": "সারসংক্ষেপ",
  "shell.nav.settings": "সেটিংস",
  "shell.nav.recording": "রেকর্ড করছে",
  "shell.app.skipToContent": "বিষয়বস্তুতে যান",
  "shell.app.tagline": "Phoenix হলো প্ল্যাটফর্ম। Fawkes হলো পোষা সঙ্গী।",
  "shell.app.noToken":
    "এই পাতায় কোনো সেশন টোকেন নেই। {command} যে ঠিকানা ছাপে সেখান থেকে Phoenix খুলুন।",
  "shell.app.hint": "Phoenix কী করছে দেখতে উপরের বারে Fawkes-এ ক্লিক করুন।",
  "shell.language.title": "ভাষা",
  "shell.language.label": "ইন্টারফেসের ভাষা",
  "shell.language.available":
    "{count, plural, one {#টি ভাষা পাওয়া যাচ্ছে।} other {#টি ভাষা পাওয়া যাচ্ছে।}}",
  "shell.language.machineNote":
    "ইংরেজি ছাড়া অন্য ভাষার লেখা যন্ত্রের অনুবাদ এবং এখনও মাতৃভাষীরা যাচাই করেননি।",
  "shell.language.saved": "ভাষা বদলানো হয়েছে।",
  "shell.language.failed": "ভাষা সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।",

  "shell.palette.title": "কমান্ড প্যালেট",
  "shell.palette.inputLabel": "কমান্ড খুঁজুন",
  "shell.palette.placeholder": "একটি কমান্ড লিখুন…",
  "shell.palette.results": "কমান্ড",
  "shell.palette.hint": "ওপর-নিচ তীর দিয়ে বেছে নিন, Enter দিয়ে চালান, Escape দিয়ে বন্ধ করুন।",
  "shell.palette.count": "{count, plural, one {#টি কমান্ড} other {#টি কমান্ড}}",
  "shell.palette.empty": "“{query}”-এর সঙ্গে কোনো কমান্ড মেলেনি।",

  "shell.cmd.palette.open": "কমান্ড প্যালেট খুলুন",
  "shell.cmd.nav.home": "হোমে যান",
  "shell.cmd.nav.meetings": "মিটিং-এ যান",
  "shell.cmd.nav.provenance": "উৎস-পরিচয়ে যান",
  "shell.cmd.nav.agents": "এজেন্টে যান",
  "shell.cmd.nav.workflows": "ওয়ার্কফ্লোতে যান",
  "shell.cmd.nav.recap": "সারসংক্ষেপে যান",
  "shell.cmd.nav.settings": "সেটিংসে যান",
  "shell.cmd.settings.language": "সেটিংস খুলুন: ভাষা",
  "shell.cmd.panel.overview": "Fawkes প্যানেল: সারসংক্ষেপ",
  "shell.cmd.panel.chat": "Fawkes প্যানেল: চ্যাট",
  "shell.cmd.panel.activity": "Fawkes প্যানেল: কার্যকলাপ",
  "shell.cmd.panel.capabilities": "Fawkes প্যানেল: সক্ষমতা",
  "shell.cmd.panel.memory": "Fawkes প্যানেল: স্মৃতি",
  "shell.cmd.panel.wardrobe": "পোশাকের আলমারি খুলুন",
  "shell.cmd.demo.start": "ডেমো শুরু করুন",
  "shell.cmd.demo.stop": "ডেমো বন্ধ করুন",
  "shell.cmd.mute.toggle": "শব্দ ও নোটিফিকেশন মিউট বা আনমিউট করুন",

  "shell.shortcuts.title": "গ্লোবাল শর্টকাট",
  "shell.shortcuts.desktopOnly":
    "গ্লোবাল শর্টকাট Phoenix ডেস্কটপ অ্যাপের একটি বৈশিষ্ট্য। ব্রাউজারে এগুলো পাওয়া যায় না।",
  "shell.shortcuts.intro":
    "Phoenix ডেস্কটপ অ্যাপ চালু থাকলে গ্লোবাল শর্টকাট যেকোনো অ্যাপ থেকে কাজ করে।",
  "shell.shortcuts.loading": "শর্টকাট লোড হচ্ছে…",
  "shell.shortcuts.loadFailed": "ডেস্কটপ অ্যাপ থেকে শর্টকাট পড়া যায়নি।",
  "shell.shortcuts.enable": "গ্লোবাল শর্টকাট চালু করুন",
  "shell.shortcuts.warning":
    "সতর্কতা: গ্লোবাল শর্টকাট চালু থাকলে প্রতিটি শর্টকাট তার কী-সংমিশ্রণ অন্য সব অ্যাপ থেকে কেড়ে নেয়। আপনি চালু না করা পর্যন্ত এগুলো বন্ধ থাকে। প্রতিটি শর্টকাটে কমপক্ষে দুটি মডিফায়ার কী (Ctrl, Alt, Shift বা Cmd) লাগে, যাতে স্বাভাবিক টাইপিংয়ে বাধা না পড়ে।",
  "shell.shortcuts.mute": "শব্দ ও নোটিফিকেশন মিউট করুন",
  "shell.shortcuts.muteHelp":
    "Fawkes এখনও দেখায় সে কী করছে; শুধু তার শব্দ ও নোটিফিকেশন বাবল বন্ধ থাকে।",
  "shell.shortcuts.list": "শর্টকাট অ্যাকশন",
  "shell.shortcuts.action.open_chat": "চ্যাট খুলুন",
  "shell.shortcuts.action.jump_to_alert": "সতর্কবার্তায় যান",
  "shell.shortcuts.action.jump_to_terminal": "টার্মিনালে যান",
  "shell.shortcuts.action.switch_pills": "পিল বদলান",
  "shell.shortcuts.action.mute": "শব্দ ও নোটিফিকেশন মিউট করুন",
  "shell.shortcuts.action.send_to_desktop": "Fawkes-কে ডেস্কটপে পাঠান",
  "shell.shortcuts.action.wardrobe": "পোশাকের আলমারি খুলুন",
  "shell.shortcuts.binding.none": "সেট করা নেই",
  "shell.shortcuts.default": "ডিফল্ট: {keys}",
  "shell.shortcuts.state.active": "সক্রিয়",
  "shell.shortcuts.state.off": "নিষ্ক্রিয়: গ্লোবাল শর্টকাট বন্ধ আছে",
  "shell.shortcuts.state.unbound": "নিষ্ক্রিয়: কোনো কী-সংমিশ্রণ সেট করা নেই",
  "shell.shortcuts.state.rejected": "নিষ্ক্রিয়: এই কী-সংমিশ্রণ অনুমোদিত নয়",
  "shell.shortcuts.state.unavailable":
    "নিষ্ক্রিয়: অন্য কোনো অ্যাপ হয়তো এই কী-সংমিশ্রণ ব্যবহার করছে, অথবা সিস্টেম এটি অনুমতি দেয় না",
  "shell.shortcuts.changeFor": "{action}-এর শর্টকাট বদলান",
  "shell.shortcuts.capture": "নতুন কী-সংমিশ্রণ চাপুন",
  "shell.shortcuts.captureFor": "{action}-এর জন্য নতুন কী-সংমিশ্রণ",
  "shell.shortcuts.captureHelp": "কীগুলো একসঙ্গে চাপুন। Escape বাতিল করে।",
  "shell.shortcuts.resetFor": "{action}-এর শর্টকাট ডিফল্টে ফিরিয়ে আনুন",
  "shell.shortcuts.resetAll": "সব শর্টকাট রিসেট করুন",
  "shell.shortcuts.saved": "{action}-এর শর্টকাট এখন {keys}।",
  "shell.shortcuts.resetDone": "{action}-এর শর্টকাট রিসেট করা হয়েছে।",
  "shell.shortcuts.resetAllDone": "সব শর্টকাট রিসেট করা হয়েছে।",
  "shell.shortcuts.reason.invalid": "এটি বৈধ শর্টকাট নয়।",
  "shell.shortcuts.reason.unsupportedKey":
    "এই কী ব্যবহার করা যাবে না। মডিফায়ার কী-র সঙ্গে একটি অক্ষর, অঙ্ক, F কী বা তীর কী ব্যবহার করুন।",
  "shell.shortcuts.reason.needs_modifiers":
    "শর্টকাটে কমপক্ষে দুটি মডিফায়ার কী (Ctrl, Alt, Shift বা Cmd) লাগে, যাতে স্বাভাবিক টাইপিং দখল না হয়।",
  "shell.shortcuts.reason.needs_third_modifier":
    "অনেক কিবোর্ডে অক্ষর বা অঙ্কের সঙ্গে Ctrl+Alt ও Alt+Shift চিহ্ন টাইপ করে (AltGr বা Option)। তৃতীয় একটি মডিফায়ার যোগ করুন।",
  "shell.shortcuts.reason.reserved": "সিস্টেম ইতিমধ্যে এই কী-সংমিশ্রণ ব্যবহার করে।",
  "shell.shortcuts.reason.dictation_chord": "এই কী-সংমিশ্রণ ডিক্টেশনে (আবার পেস্ট) ব্যবহৃত হয়।",
  "shell.shortcuts.reason.conflict":
    "Phoenix-এর অন্য একটি শর্টকাট ইতিমধ্যে এই কী-সংমিশ্রণ ব্যবহার করে।",
  "shell.shortcuts.reason.unavailable":
    "সিস্টেম এই কী-সংমিশ্রণ নিবন্ধন করেনি। অন্য কোনো অ্যাপ হয়তো এটি ব্যবহার করছে।",
  "shell.shortcuts.reason.forbidden": "এই উইন্ডো শর্টকাট বদলাতে পারে না।",
  "shell.shortcuts.reason.unknown_action": "এটি কোনো শর্টকাট অ্যাকশন নয়।",
  "shell.shortcuts.reason.unknown": "শর্টকাট বদলানো যায়নি।",
};
