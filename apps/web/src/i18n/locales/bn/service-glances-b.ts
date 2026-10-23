// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { serviceGlancesB as enServiceGlancesB } from "../../en/service-glances-b";

/** Machine-translated; unreviewed (see ../../README.md). */
export const serviceGlancesB: Record<keyof typeof enServiceGlancesB, string> = {
  "services.glance.resend.notConfigured":
    "এখানে ডেলিভারির অবস্থা দেখতে Resend সক্ষমতার সিক্রেটে একটি Resend API কী যোগ করুন।",
  "services.glance.resend.empty": "গণনা করার মতো সম্প্রতি পাঠানো কোনো ইমেইল নেই।",
  "services.glance.resend.summary":
    "{count, plural, one {# টি সাম্প্রতিক ইমেইল} other {# টি সাম্প্রতিক ইমেইল}}",
  "services.glance.resend.newest": "সর্বশেষ: {time}",
  "services.glance.resend.privacy": "শুধু সংখ্যা। বিষয় ও প্রাপকদের এখানে কখনোই দেখানো হয় না।",
  "services.glance.resend.state.delivered": "পৌঁছেছে",
  "services.glance.resend.state.inFlight": "পথে আছে",
  "services.glance.resend.state.delayed": "দেরি হয়েছে",
  "services.glance.resend.state.bounced": "ফেরত এসেছে",
  "services.glance.resend.state.complained": "স্প্যাম হিসেবে চিহ্নিত",
  "services.glance.resend.state.failed": "ব্যর্থ",
  "services.glance.resend.state.other": "অন্যান্য",

  "services.glance.notion.notConfigured":
    "আপনার নজরে রাখা পেজগুলো এখানে দেখতে Notion সক্ষমতার সিক্রেটে একটি Notion ইন্টিগ্রেশন টোকেন যোগ করুন।",
  "services.glance.notion.empty":
    "দেখানোর মতো কোনো নজরে রাখা পেজ বা ডেটাবেস নেই। Notion সক্ষমতার সেটিংসে আইডি দিয়ে সেগুলো তালিকাভুক্ত করুন।",
  "services.glance.notion.summary":
    "{count, plural, one {# টি নজরে রাখা আইটেম} other {# টি নজরে রাখা আইটেম}}",
  "services.glance.notion.privacy":
    "শুধু শিরোনাম ও সম্পাদনার সময়। পেজের বিষয়বস্তু কখনোই পড়া হয় না।",
  "services.glance.notion.untitled": "শিরোনামহীন",
  "services.glance.notion.kind.page": "পেজ",
  "services.glance.notion.kind.database": "ডেটাবেস",
  "services.glance.notion.kind.archived": "আর্কাইভ করা",
  "services.glance.notion.edited": "সম্পাদনা করা হয়েছে {time}",
  "services.glance.notion.open": "Notion-এ খুলুন",
  "services.glance.notion.openNamed": "{title} Notion-এ খুলুন",

  "services.glance.calcom.notConfigured":
    "আপনার বুকিংগুলো এখানে দেখতে Cal.com সক্ষমতার সিক্রেটে একটি Cal.com API কী যোগ করুন।",
  "services.glance.calcom.empty": "কোনো আসন্ন বুকিং নেই।",
  "services.glance.calcom.summary":
    "{count, plural, one {# টি আসন্ন বুকিং} other {# টি আসন্ন বুকিং}}",
  "services.glance.calcom.privacy":
    "শুধু সময় ও অংশগ্রহণকারীর সংখ্যা। নাম ও ইমেইল ঠিকানা এখানে কখনোই দেখানো হয় না।",
  "services.glance.calcom.booking": "বুকিং",
  "services.glance.calcom.status.accepted": "নিশ্চিত",
  "services.glance.calcom.status.pending": "নিশ্চিতকরণের অপেক্ষায়",
  "services.glance.calcom.status.other": "অন্যান্য",
  "services.glance.calcom.attendees":
    "{count, plural, one {# জন অংশগ্রহণকারী} other {# জন অংশগ্রহণকারী}}",
  "services.glance.calcom.more": "{count, plural, one {আরও # টি বুকিং} other {আরও # টি বুকিং}}",
};
