// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { digest as endigest } from "../../en/digest";

/** Machine-translated; unreviewed. */
export const digest: Record<keyof typeof endigest, string> = {
  "digest.title": "দৈনিক সারাংশ",
  "digest.yesterday": "গতকাল",
  "digest.today": "আজ (নিশ্চিত পরিকল্পনা)",
  "digest.blockers": "বাধা",
  "digest.endOfDay": "দিনশেষ",
  "digest.source": "উৎস",
  "digest.none": "কোনো সংযুক্ত কার্যকলাপ নেই",
  "digest.date": "তারিখ",
  "digest.localNote": "সংযুক্ত কার্যকলাপ থেকে স্থানীয়ভাবে তৈরি। ক্লাউড মডেল ব্যবহার করা হয়নি।",
  "digest.error": "সারাংশ লোড বা কপি করা যায়নি।",
  "digest.loading": "সারাংশ লোড হচ্ছে…",
  "digest.copy": "উৎসসহ কপি করুন",
  "digest.copied": "কপি হয়েছে",
  "digest.sendUnavailable":
    "অনুমোদিত ইন্টিগ্রেশন যুক্ত না হওয়া পর্যন্ত Slack ও Teams-এ পাঠানো যাবে না।",
  "digest.back": "সারাংশে ফিরুন",
  "digest.eventTitle": "ইভেন্টের প্রমাণ",
  "digest.eventMissing": "এই ইভেন্টটি আর পাওয়া যাচ্ছে না।",
  "digest.unverified":
    "যাচাইহীন: এটি স্থানীয়ভাবে সংরক্ষিত ইভেন্ট দাবি, প্রদানকারী-যাচাইকৃত প্রমাণ নয়।",
  "digest.commitTitle": "কমিট",
  "digest.commitMissing": "এই কমিট নজরদারির রিপজিটরিতে নেই।",
  "digest.noneIncomplete": "পড়া যাওয়া উৎসগুলিতে কিছু পাওয়া যায়নি।",
  "digest.noticeHeading": "অসম্পূর্ণ সারাংশ",
  "digest.noticeUnavailable": "পড়া যায়নি, তাই সারাংশে কার্যকলাপ বাদ পড়তে পারে: {sources}।",
  "digest.noticePartial":
    "শুধু সাম্প্রতিক রেকর্ড পড়া হয়েছে, পুরোনো কার্যকলাপ বাদ পড়তে পারে: {sources}।",
  "digest.noticeUnattributed":
    "কোনো git পরিচয় (user.email) সেট নেই, তাই কমিটগুলি আপনার কাজ হিসেবে না দেখিয়ে বাদ দেওয়া হয়েছে: {sources}।",
  "digest.sources.git": "git রিপজিটরি",
  "digest.sources.events": "ইভেন্ট ইতিহাস",
  "digest.sources.sessions": "এজেন্ট সেশন",
  "digest.sources.meetings": "মিটিং",
};
