// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamStatus as enTeamStatus } from "../../en/team-status";

/** Machine-translated; unreviewed. */
export const teamStatus: Record<keyof typeof enTeamStatus, string> = {
  "teamStatus.title": "টিমের উপস্থিতি",
  "teamStatus.intro":
    "টিমের উপস্থিতি ডিফল্টভাবে বন্ধ থাকে। চালু করলে Phoenix শুধু আপনার টিক দেওয়া ধরনের অবস্থা (ডিপ্লয় করছেন, এজেন্ট চালাচ্ছেন, মিটিংয়ে আছেন) এনক্রিপ্টেড ফ্রেম হিসেবে আপনার যোগ করা সহকর্মীদের পাঠায়, এবং কখনও কোনো রিপজিটরি, ব্রাঞ্চ বা ব্যক্তির নাম উল্লেখ করে না।",
  "teamStatus.notAvailable":
    "টিমের উপস্থিতি পাওয়া যাচ্ছে না: এই Phoenix Core-এ আপনার কী রাখার জন্য অপারেটিং সিস্টেমের সিক্রেট স্টোর নেই।",
  "teamStatus.loadFailed": "টিমের উপস্থিতি লোড করা যায়নি।",
  "teamStatus.listSeparator": ", ",
  "teamStatus.kind.deploying": "ডিপ্লয় করছেন",
  "teamStatus.kind.agentRun": "এজেন্ট চালাচ্ছেন",
  "teamStatus.kind.meeting": "মিটিংয়ে আছেন",
  "teamStatus.relay.label": "রিলে ঠিকানা",
  "teamStatus.route.label": "রুট (ঐচ্ছিক)",
  "teamStatus.route.hint":
    "নতুন টিম শুরু করতে রুট খালি রাখুন। কোনো সহকর্মীর টিমে যোগ দিতে এখানে রুট পেস্ট করুন।",
  "teamStatus.route.shown": "রিলে রুট",
  "teamStatus.turnOn": "চালু করুন",
  "teamStatus.resume": "আবার চালু করুন",
  "teamStatus.pause": "বিরতি দিন",
  "teamStatus.leave": "টিম ছেড়ে যান",
  "teamStatus.leave.ask": "টিম ছেড়ে সবাইকে ভুলে যাবেন?",
  "teamStatus.state.line": "সংযোগ: {state}",
  "teamStatus.state.connected": "সংযুক্ত",
  "teamStatus.state.connecting": "সংযুক্ত হচ্ছে",
  "teamStatus.state.paused": "বিরতিতে",
  "teamStatus.lastError": "সর্বশেষ ত্রুটি: {error}",
  "teamStatus.self.id": "আপনার টিম আইডি",
  "teamStatus.self.publicKey": "আপনার পাবলিক কী",
  "teamStatus.self.hint":
    "দুটিই সহকর্মীকে দিন যাতে তিনি আপনাকে যোগ করতে পারেন। আপনার প্রাইভেট কী কখনও এই কম্পিউটার ছেড়ে যায় না।",
  "teamStatus.sharing.title": "আমি যা শেয়ার করি",
  "teamStatus.sharing.master": "আমার অবস্থা আমার টিমের সাথে শেয়ার করুন",
  "teamStatus.sharing.deploying": "ডিপ্লয় করছেন",
  "teamStatus.sharing.agentRun": "দীর্ঘ সময় ধরে এজেন্ট চালাচ্ছেন",
  "teamStatus.sharing.meeting": "মিটিংয়ে আছেন",
  "teamStatus.outgoing.now": "সহকর্মীরা এখন দেখছেন: {kinds}।",
  "teamStatus.outgoing.none": "সহকর্মীরা এখন আপনার কিছুই দেখছেন না।",
  "teamStatus.members.title": "সহকর্মী",
  "teamStatus.members.none": "আপনি এখনও কোনো সহকর্মী যোগ করেননি।",
  "teamStatus.members.removeLabel": "{label} সরান",
  "teamStatus.members.id": "সহকর্মীর টিম আইডি",
  "teamStatus.members.label": "দেখানোর নাম",
  "teamStatus.members.add": "সহকর্মী যোগ করুন",
  "teamStatus.presence.title": "কারা আছেন",
  "teamStatus.presence.none": "দেখানোর মতো কোনো সহকর্মী নেই।",
  "teamStatus.presence.nothing": "কিছুই শেয়ার করা হয়নি",
};
