// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { mission as enmission } from "../../en/mission";

/** Machine-translated; unreviewed (see ../../README.md). */
export const mission: Record<keyof typeof enmission, string> = {
  "mission.title": "মিশন কন্ট্রোল",
  "mission.nav": "মিশন",
  "mission.note":
    "টোকেন ও খরচ হলো এজেন্টরা নিজেরাই যা জানায়। প্রদানকারীর বিলের সঙ্গে এগুলো যাচাই করা হয়নি।",
  "mission.sourceMissing":
    "কিছু এজেন্ট সেশন এই মুহূর্তে পড়া যায়নি (এজেন্ট সুবিধা বন্ধ আছে বা সাড়া দিচ্ছে না), তাই বোর্ডে কিছু সেশন বাদ পড়তে পারে।",
  "mission.refresh": "রিফ্রেশ করুন",
  "mission.loadFailed": "মিশন কন্ট্রোল লোড করা যায়নি।",

  "mission.filter.search": "সেশন খুঁজুন",
  "mission.filter.searchPlaceholder": "এজেন্ট, প্রজেক্ট বা সেশন আইডি",
  "mission.filter.agent": "এজেন্ট",
  "mission.filter.project": "প্রজেক্ট",
  "mission.filter.state": "অবস্থা",
  "mission.filter.all": "সব",
  "mission.filter.clear": "ফিল্টার মুছুন",

  "mission.state.working": "কাজ করছে",
  "mission.state.waiting": "আপনার অপেক্ষায়",
  "mission.state.finished": "শেষ হয়েছে",
  "mission.state.stuck": "আটকে আছে",
  "mission.reason.permission": "আপনার অনুমতি দরকার",
  "mission.reason.input": "আপনার জন্য একটি প্রশ্ন আছে",
  "mission.reason.idle": "প্রম্পটে নিষ্ক্রিয়",
  "mission.stuck.noReport": "থেমে থাকার সীমার চেয়ে বেশি সময় ধরে কোনো রিপোর্ট নেই",
  "mission.stuck.safetyStall": "নিরাপত্তা জাল একে থেমে যাওয়া হিসেবে চিহ্নিত করেছে",

  "mission.board.title": "সেশন",
  "mission.board.empty": "দেখানোর মতো কোনো এজেন্ট সেশন নেই।",
  "mission.board.noMatch": "কোনো সেশন ফিল্টারের সঙ্গে মেলেনি।",
  "mission.column.count": "{count, plural, one {#টি সেশন} other {#টি সেশন}}",
  "mission.column.empty": "নেই",

  "mission.card.open": "বিস্তারিত",
  "mission.card.focus": "টার্মিনালে যান",
  "mission.card.focused": "টার্মিনাল উইন্ডোটি সামনে আনা হয়েছে।",
  "mission.card.unnamedProject": "অজানা প্রজেক্ট",
  "mission.card.tokens": "ইনপুট {input}, আউটপুট {output}",
  "mission.card.noTokens": "টোকেনের সংখ্যা জানানো হয়নি",
  "mission.card.cost": "খরচ {cost}",
  "mission.card.costPartial": "খরচ {cost} বা তার বেশি (কিছু ব্যবহারের খরচ জানা নেই)",
  "mission.card.costUnknown": "খরচ অজানা",
  "mission.card.lastSeen": "শেষ সাড়া {ago}",
  "mission.card.steps": "{count, plural, one {#টি ধাপ} other {#টি ধাপ}}",

  "mission.totals.title": "টোকেন ও খরচ",
  "mission.totals.window": "গত {days, plural, one {# দিন} other {# দিন}}",
  "mission.totals.input": "ইনপুট টোকেন",
  "mission.totals.output": "আউটপুট টোকেন",
  "mission.totals.cost": "খরচ",
  "mission.totals.unknown": "অজানা",
  "mission.totals.partial": "{cost} বা তার বেশি",
  "mission.totals.unpriced":
    "এগুলোর দাম ঠিক করা নেই: {models}। এদের খরচ অজানা, শূন্য নয়। খরচ দেখতে নিচে দাম যোগ করুন।",
  "mission.totals.empty": "এই সময়সীমায় কোনো এজেন্ট টোকেন বা খরচ জানায়নি।",

  "mission.by.day": "দিন অনুযায়ী",
  "mission.by.agent": "এজেন্ট অনুযায়ী",
  "mission.by.project": "প্রজেক্ট অনুযায়ী",
  "mission.by.session": "সেশন অনুযায়ী",
  "mission.col.day": "দিন",
  "mission.col.agent": "এজেন্ট",
  "mission.col.project": "প্রজেক্ট",
  "mission.col.session": "সেশন",
  "mission.col.input": "ইনপুট",
  "mission.col.output": "আউটপুট",
  "mission.col.cost": "খরচ",

  "mission.budgets.title": "বাজেট",
  "mission.budgets.note":
    "সীমায় পৌঁছানোর আগেই, সীমার {thresholds} এ পৌঁছালে, প্রতিটি বাজেটের জন্য দিনে একবার সতর্কতা আসে। খরচের বাজেট শুধু সেই ব্যবহারই গোনে যার খরচ জানা আছে।",
  "mission.budgets.none": "এখনও কোনো বাজেট নেই।",
  "mission.budgets.line": "{scope}, {metric}{agent}: {limit} এর মধ্যে {used} ({pct}%)",
  "mission.budgets.lineAtLeast":
    "{scope}, {metric}{agent}: কমপক্ষে {used}, সীমা {limit} ({pct}%); কিছু ব্যবহারের খরচ অজানা এবং গোনা হয়নি",
  "mission.ingest.notice":
    "আজ Core {clamped, plural, one {# রিপোর্ট} other {# রিপোর্ট}} সীমায় ছেঁটেছে এবং {refused, plural, one {# রিপোর্ট} other {# রিপোর্ট}} প্রত্যাখ্যান করেছে, তাই নিচের সংখ্যা এজেন্টদের জানানো সংখ্যার চেয়ে কম হতে পারে। এজেন্ট: {agents}।",
  "mission.budgets.lineUnknown": "{scope}, {metric}{agent}: ব্যবহার অজানা, সীমা {limit}",
  "mission.budgets.agentSuffix": " ({agent})",
  "mission.budgets.scope": "প্রযোজ্য হবে",
  "mission.budgets.scope.daily": "পুরো দিনের জন্য",
  "mission.budgets.scope.session": "প্রতিটি সেশনের জন্য",
  "mission.budgets.metric": "পরিমাপের একক",
  "mission.budgets.metric.tokens": "টোকেন",
  "mission.budgets.metric.cost": "মার্কিন ডলার",
  "mission.budgets.limit": "সীমা",
  "mission.budgets.agent": "এজেন্ট (ঐচ্ছিক)",
  "mission.budgets.add": "বাজেট যোগ করুন",
  "mission.budgets.remove": "বাজেট {id} সরান",
  "mission.budgets.invalid": "শূন্যের চেয়ে বড় একটি সীমা দিন।",

  "mission.prices.title": "দাম",
  "mission.prices.note":
    "Phoenix-এ কোনো বিল্ট-ইন দাম নেই। এজেন্ট যে মডেলের নাম জানায় সেটির অধীনে নিজের দাম দিন, প্রতি দশ লক্ষ টোকেনে মার্কিন ডলারে।",
  "mission.prices.aiNote": "যেসব মডেলের দাম AI সেটিংসেও আছে: {models}।",
  "mission.prices.none": "এখনও কোনো দাম নেই।",
  "mission.prices.model": "মডেল",
  "mission.prices.input": "প্রতি দশ লক্ষ টোকেন ইনপুট",
  "mission.prices.output": "প্রতি দশ লক্ষ টোকেন আউটপুট",
  "mission.prices.line": "{model}: প্রতি দশ লক্ষ টোকেনে ইনপুট {input}, আউটপুট {output}",
  "mission.prices.add": "দাম সংরক্ষণ করুন",
  "mission.prices.remove": "{model} এর দাম সরান",
  "mission.prices.invalid": "একটি মডেলের নাম এবং শূন্য বা তার বেশি দুটি দাম দিন।",

  "mission.stall.label":
    "রিপোর্ট ছাড়া এত মিনিট পার হলে সক্রিয় সেশনকে আটকে থাকা হিসেবে চিহ্নিত করুন",
  "mission.stall.save": "সংরক্ষণ করুন",

  "mission.keep.label": "এত দিনের চেয়ে পুরোনো ব্যবহারের রেকর্ড মুছে ফেলুন (৭ থেকে ৩৬৫০)",
  "mission.keep.save": "সংরক্ষণ করুন",

  "mission.saved": "সংরক্ষিত হয়েছে",
  "mission.delete.button": "এজেন্টের সব ব্যবহার মুছুন",
  "mission.delete.warning":
    "সংরক্ষিত প্রতিটি টোকেন ও খরচের সংখ্যা মুছবেন? বাজেট ও দাম থেকে যাবে। এটি আর ফেরানো যাবে না।",
  "mission.delete.confirm": "হ্যাঁ, মুছুন",
  "mission.delete.done":
    "{count, plural, one {#টি রেকর্ড মোছা হয়েছে} other {#টি রেকর্ড মোছা হয়েছে}}",
};
