// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { mcp as enmcp } from "../../en/mcp";

/** Machine-translated; unreviewed (see ../../README.md). */
export const mcp: Record<keyof typeof enmcp, string> = {
  "mcp.title": "Phoenix MCP সার্ভার",
  "mcp.intro":
    "এই কম্পিউটারের কোডিং এজেন্ট ও অন্য MCP ক্লায়েন্টকে Phoenix-এর প্রসঙ্গ পড়তে এবং আপনার অনুমোদন চাইতে দেয়। আপনি চালু না করা পর্যন্ত এটি বন্ধ থাকে, আর আপনি অনুমতি না দেওয়া পর্যন্ত কোনো ক্লায়েন্ট কিছুই পায় না।",
  "mcp.unavailable": "MCP সার্ভারের সেটিংস লোড করা যায়নি।",
  "mcp.demoUnavailable": "ডেমো মোডে MCP সার্ভার পাওয়া যায় না।",
  "mcp.warning.title": "চালু করার আগে",
  "mcp.warning.local":
    "এটি শুধু এই কম্পিউটারেই (127.0.0.1) একটি আলাদা শ্রোতা খোলে। অন্য কম্পিউটার ও ওয়েব পেজ এতে পৌঁছাতে পারে না।",
  "mcp.warning.token":
    "প্রতিটি ক্লায়েন্টের নিজস্ব টোকেন আছে, যা শুধু একবার দেখানো হয়। টোকেন থাকা যেকোনো প্রোগ্রাম সেই ক্লায়েন্টকে আপনার দেওয়া সবকিছু ব্যবহার করতে পারে।",
  "mcp.warning.untrusted":
    "Phoenix যা ফেরত দেয় তা অবিশ্বস্ত ডেটা হিসেবে চিহ্নিত, তবু যে মডেল তা পড়ে সে ভেতরের লেখায় বিভ্রান্ত হতে পারে। শুধু যতটুকু দরকার ততটুকুই দিন।",
  "mcp.warning.approval":
    "ক্লায়েন্টের চাওয়া অনুমোদন আপনার অন্যান্য এজেন্ট অনুমোদনের সঙ্গে দেখা যায়। শুধু আপনি, এখানে বা যুক্ত করা ফোনে, এর উত্তর দিতে পারেন।",
  "mcp.enable.label": "এই কম্পিউটারের MCP ক্লায়েন্টকে সংযোগ করতে দিন",
  "mcp.saved.on": "MCP সার্ভার চালু আছে।",
  "mcp.saved.off": "MCP সার্ভার বন্ধ আছে।",
  "mcp.port.label": "পোর্ট",
  "mcp.port.save": "পোর্ট সংরক্ষণ করুন",
  "mcp.port.saved": "পোর্ট সংরক্ষিত হয়েছে।",
  "mcp.killSwitch":
    "জরুরি বন্ধ চালু আছে: MCP সার্ভার বন্ধ। জরুরি বন্ধ তুলে নেওয়ার পর এখানে আবার চালু করুন।",
  "mcp.notListening": "MCP সার্ভার চালু করা আছে কিন্তু শুনছে না। পোর্টটি ফাঁকা কি না দেখুন।",
  "mcp.listening.url": "ঠিকানা",
  "mcp.new.title": "ক্লায়েন্ট যোগ করুন",
  "mcp.new.name": "ক্লায়েন্টের নাম",
  "mcp.new.create": "ক্লায়েন্ট তৈরি করুন",
  "mcp.new.created": "ক্লায়েন্ট তৈরি হয়েছে। এখনো কোনো অনুমতি নেই।",
  "mcp.token.title": "এই টোকেনটি এখনই কপি করুন",
  "mcp.token.note":
    "এটি শুধু একবার দেখানো হয় এবং Phoenix শুধু এর একটি ফিঙ্গারপ্রিন্ট রাখে। এটি ক্লায়েন্টের পরিবেশে PHOENIX_MCP_TOKEN হিসেবে রাখুন, কখনো কমান্ড লাইনে নয়।",
  "mcp.token.label": "ক্লায়েন্ট টোকেন",
  "mcp.token.copy": "টোকেন কপি করুন",
  "mcp.token.copied": "টোকেন কপি হয়েছে।",
  "mcp.token.copyFailed": "কপি করা যায়নি। টোকেন নির্বাচন করে হাতে কপি করুন।",
  "mcp.token.done": "আমি এটি সংরক্ষণ করেছি",
  "mcp.clients.title": "ক্লায়েন্ট",
  "mcp.clients.none": "এখনো কোনো ক্লায়েন্ট নেই।",
  "mcp.client.created": "{date} তারিখে তৈরি",
  "mcp.client.id": "ক্লায়েন্ট ID {id} (এই ক্লায়েন্টের অনুমোদন কার্ডে দেখানো হয়)",
  "mcp.client.lastUsed": "সর্বশেষ ব্যবহার {when}",
  "mcp.client.neverUsed": "কখনো ব্যবহৃত হয়নি",
  "mcp.client.revokedOn": "{date} তারিখে বাতিল",
  "mcp.client.noGrants":
    "কোনো অনুমতি নেই: এই ক্লায়েন্ট সংযোগ করতে পারে, কিন্তু সবকিছু প্রত্যাখ্যাত হয়।",
  "mcp.grants.title": "{name} কী করতে পারে",
  "mcp.grants.tools": "পড়ার টুল",
  "mcp.grants.tool.phoenix_activity": "সাম্প্রতিক এজেন্ট সেশন",
  "mcp.grants.tool.phoenix_meetings": "সভার সিদ্ধান্ত ও সারাংশ",
  "mcp.grants.tool.phoenix_graph_query": "জ্ঞান-গ্রাফের প্রশ্ন",
  "mcp.grants.tool.phoenix_ci_git_state": "Git ও CI-এর অবস্থা",
  "mcp.grants.tool.phoenix_memory_search": "মেমরি অনুসন্ধান",
  "mcp.grants.actions": "কাজ",
  "mcp.grants.requestApproval": "আমার অনুমোদন চাইতে পারে",
  "mcp.grants.notify": "Fawkes-কে নিজের অবস্থা জানাতে পারে (কাজ করছে, অপেক্ষায়, শেষ)",
  "mcp.grants.memory": "যে মেমরি পড়তে পারে",
  "mcp.grants.memory.note":
    "মেমরি অনুসন্ধান, গ্রাফ ও সভা শুধু নিচের পরিধি দেখে, আপনি যা দেখতে পান তার সবটা নয়।",
  "mcp.grants.memory.none": "কোনো মেমরি পরিধি দেওয়া হয়নি।",
  "mcp.grants.memory.scope": "পরিধি",
  "mcp.grants.memory.sensitivity": "সর্বোচ্চ সংবেদনশীলতা",
  "mcp.grants.memory.add": "পরিধি যোগ করুন",
  "mcp.grants.memory.remove": "পরিধি {scope} সরান",
  "mcp.grants.memory.invalid": "পরিধি হলো *, global, অথবা repo:, path: বা meeting: এবং তারপর লেখা।",
  "mcp.sensitivity.public": "সর্বজনীন",
  "mcp.sensitivity.internal": "অভ্যন্তরীণ",
  "mcp.sensitivity.sensitive": "সংবেদনশীল (সভা)",
  "mcp.grants.save": "অনুমতি সংরক্ষণ করুন",
  "mcp.grants.saved": "অনুমতি সংরক্ষিত হয়েছে।",
  "mcp.revoke": "{name} বাতিল করুন",
  "mcp.revoke.ask": "{name} বাতিল করবেন? সঙ্গে সঙ্গে প্রত্যাখ্যাত হবে, চলমান কলের মাঝেও।",
  "mcp.revoke.yes": "হ্যাঁ, বাতিল করুন",
  "mcp.revoke.no": "রাখুন",
  "mcp.revoke.done": "ক্লায়েন্ট বাতিল করা হয়েছে।",
};
