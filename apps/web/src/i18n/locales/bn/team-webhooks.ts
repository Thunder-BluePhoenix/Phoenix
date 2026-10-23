// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamWebhooks as enTeamWebhooks } from "../../en/team-webhooks";

/** Machine-translated; unreviewed. */
export const teamWebhooks: Record<keyof typeof enTeamWebhooks, string> = {
  "teamWebhooks.title": "ইনকামিং ওয়েবহুক",
  "teamWebhooks.intro":
    "ইনকামিং ওয়েবহুক ডিফল্টরূপে বন্ধ থাকে। একটি সোর্স অন্য টুলকে নিজস্ব ঠিকানা ও গোপন কী দেয়; সেই টুল সঠিকভাবে স্বাক্ষরিত বার্তা পাঠালে Phoenix সেটিকে একটি স্থানীয় ইভেন্টে পরিণত করে। কোথাও কিছু পাঠানো হয় না, এবং সোর্স যা পাঠায় তা অবিশ্বস্ত টেক্সট হিসেবে ধরা হয়।",
  "teamWebhooks.notAvailable":
    "ইনকামিং ওয়েবহুক পাওয়া যাচ্ছে না: এই Phoenix Core-এ সোর্সের গোপন কী রাখার জন্য অপারেটিং সিস্টেমের সিক্রেট স্টোর নেই।",
  "teamWebhooks.loadFailed": "ইনকামিং ওয়েবহুক লোড করা যায়নি।",
  "teamWebhooks.master": "ইনকামিং ওয়েবহুক গ্রহণ করুন",
  "teamWebhooks.secret.title": "{id}-এর গোপন কী",
  "teamWebhooks.secret.warning":
    "এই গোপন কী শুধু একবারই দেখানো হয়। এখনই কপি করে প্রেরণকারী টুলে রাখুন। Phoenix এটি শুধু অপারেটিং সিস্টেমের সিক্রেট স্টোরে রাখে এবং আর দেখাতে পারে না; হারিয়ে গেলে সোর্সটি মুছে নতুন একটি তৈরি করুন।",
  "teamWebhooks.secret.path": "পাঠানোর ঠিকানা (এই Core-এ)",
  "teamWebhooks.secret.label": "স্বাক্ষরের গোপন কী",
  "teamWebhooks.secret.copy": "গোপন কী কপি করুন",
  "teamWebhooks.secret.copied": "ক্লিপবোর্ডে কপি হয়েছে।",
  "teamWebhooks.secret.copyFailed":
    "Phoenix ক্লিপবোর্ড ব্যবহার করতে পারেনি। বন্ধ করার আগে উপরের গোপন কী নির্বাচন করে হাতে কপি করুন।",
  "teamWebhooks.secret.done": "আমি সংরক্ষণ করেছি, বন্ধ করুন",
  "teamWebhooks.sources.title": "সোর্স",
  "teamWebhooks.sources.none": "আপনি এখনও কোনো ওয়েবহুক সোর্স তৈরি করেননি।",
  "teamWebhooks.row.path": "ঠিকানা: {path}",
  "teamWebhooks.row.types": "ইভেন্টের ধরন: {types}",
  "teamWebhooks.row.never": "এখনও কিছু পাওয়া যায়নি।",
  "teamWebhooks.row.last": "সর্বশেষ গৃহীত: {time}",
  "teamWebhooks.delete.label": "সোর্স {id} মুছুন",
  "teamWebhooks.delete.ask":
    "{id} মুছবেন? এর গোপন কী সঙ্গে সঙ্গে কাজ করা বন্ধ করবে এবং প্রেরণকারী টুল বদলাতে হবে।",
  "teamWebhooks.create.title": "একটি সোর্স তৈরি করুন",
  "teamWebhooks.create.id": "সোর্সের নাম",
  "teamWebhooks.create.idHint":
    "৩ থেকে ৩২টি অক্ষর: ছোট হাতের অক্ষর, অঙ্ক, - বা _, শুরু হবে একটি অক্ষর দিয়ে।",
  "teamWebhooks.create.types": "যেসব ইভেন্টের ধরন এটি পাঠাতে পারে",
  "teamWebhooks.create.typesHint":
    "কমা দিয়ে আলাদা করুন, যেমন ci.finished। প্রতিটি ধরন এগুলোর একটি দিয়ে শুরু হয়: {namespaces}।",
  "teamWebhooks.create.typesTooMany": "সর্বোচ্চ {max}টি ইভেন্টের ধরন দিন।",
  "teamWebhooks.create.typesInvalid":
    "ইভেন্টের ধরন হলো বিন্দু দিয়ে যুক্ত ছোট হাতের শব্দ, যেমন ci.finished।",
  "teamWebhooks.create.typesNamespace":
    "ইভেন্টের ধরন এগুলোর একটি দিয়ে শুরু হতে হবে: {namespaces}।",
  "teamWebhooks.create.limit": "আপনি {max}টি সোর্সের সীমায় পৌঁছেছেন। আগে একটি মুছুন।",
  "teamWebhooks.create.submit": "সোর্স তৈরি করুন",
};
