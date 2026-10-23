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
  "digest.slackHeading": "Slack-এ পাঠান",
  "digest.slackDisclosure":
    "পাঠালে এই সারাংশ, উদ্ধৃত কার্যকলাপ, অযাচাইকৃত ইভেন্ট দাবি এবং সম্ভাব্য মিটিং-ভিত্তিক বিষয়বস্তু কনফিগার করা Slack চ্যানেলে শেয়ার হবে। Core প্রতিটি পাঠানোর আগে নিশ্চিতকরণ চায়।",
  "digest.slackOptIn": "Slack-এ দৈনিক সারাংশ পাঠানো অনুমতি দিন",
  "digest.sendSlack": "Slack-এ পাঠান",
  "digest.slack.disabled": "দৈনিক সারাংশ Slack পাঠানো বন্ধ আছে।",
  "digest.slack.chat_unavailable": "আগে চ্যাট অনুমোদন চালু করুন।",
  "digest.slack.slack_unconfigured": "আগে চ্যাট অনুমোদনে Slack কনফিগার ও চালু করুন।",
  "digest.slack.missing_token": "কনফিগার করা Slack বট টোকেন অনুপলব্ধ।",
  "digest.slack.emergency_stop": "জরুরি বন্ধে পাঠানো আটকে আছে।",
  "digest.slack.ready": "Slack পাঠানো প্রস্তুত।",
  "digest.slackUnavailable": "দৈনিক সারাংশ Slack পাঠানো অনুপলব্ধ।",
  "digest.slackWaiting": "আপনার Core নিশ্চিতকরণের অপেক্ষায়…",
  "digest.slackError": "Slack পাঠানো সম্পন্ন করা যায়নি। স্বয়ংক্রিয় পুনরায় চেষ্টা করা হয়নি।",
  "digest.slackSent": "{day}-এর দৈনিক সারাংশ Slack-এ পাঠানো হয়েছে。",
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
