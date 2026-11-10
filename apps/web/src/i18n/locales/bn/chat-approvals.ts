// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { chatApprovals as enChatApprovals } from "../../en/chat-approvals";

/** Machine-translated; unreviewed. */
export const chatApprovals: Record<keyof typeof enChatApprovals, string> = {
  "chatApprovals.title": "চ্যাট অনুমোদন",
  "chatApprovals.notAvailable": "এই Phoenix Core-এ চ্যাট অনুমোদন পাওয়া যায় না।",
  "chatApprovals.intro":
    "Slack বা Discord থেকে অপেক্ষমাণ এজেন্ট বা Phoenix অনুমোদনের উত্তর দিন এবং Teams-এ বিজ্ঞপ্তি পান। আপনি এখানে চালু না করা পর্যন্ত সবকিছু বন্ধ, প্রতিটি প্রদানকারী ও প্রতিটি প্রকল্পের জন্য।",
  "chatApprovals.limits":
    "বাস্তব Slack, Discord বা Teams ওয়ার্কস্পেসের সঙ্গে কখনও ব্যবহার করা হয়নি: কোড শুধু সিমুলেটেড কলব্যাক দিয়ে পরীক্ষা করা হয়েছে। Teams শুধু বিজ্ঞপ্তির জন্য (Phoenix-এর একটি লিংক, কখনও অনুমতি বোতাম নয়)। বোতাম চাপা প্রদানকারীর স্বাক্ষর ও আপনার অনুমোদনকারী তালিকা দিয়ে যাচাই হয়, এবং সিদ্ধান্তটি নিরীক্ষিত হয়।",
  "chatApprovals.noDm":
    "সারসংক্ষেপ ও বিজ্ঞপ্তি শুধু নিচে নির্ধারিত চ্যানেলে যায়। কোনো ব্যক্তিকে সরাসরি বার্তা তৈরি করা হয়নি।",
  "chatApprovals.capabilityOff": "চ্যাট অনুমোদন সক্ষমতা বন্ধ, তাই কিছু পাঠানো হয় না।",
  "chatApprovals.enable": "সক্ষমতা চালু করুন",
  "chatApprovals.ready": "প্রস্তুত: এই প্রদানকারী কার্ড পোস্ট করতে পারে।",
  "chatApprovals.notReady":
    "প্রস্তুত নয়: এটি চালু করতে হবে, সঙ্গে ওয়ার্কস্পেস আইডি, চ্যানেল আইডি এবং অন্তত একজন অনুমোদনকারী লাগবে।",
  "chatApprovals.teamsNote":
    "Teams শুধু বিজ্ঞপ্তির জন্য। এর ওয়েবহুক ঠিকানা ও লিংক কী নিচে সংরক্ষিত হয়।",
  "chatApprovals.save": "চ্যাট অনুমোদন সংরক্ষণ করুন",
  "chatApprovals.saved": "সংরক্ষিত হয়েছে।",
  "chatApprovals.provider.slack": "Slack",
  "chatApprovals.provider.discord": "Discord",
  "chatApprovals.provider.teams": "Microsoft Teams",
  "chatApprovals.enabledNamed": "{name} চালু করুন",
  "chatApprovals.notifyNamed": "{name}-এ সাধারণ বিজ্ঞপ্তি পাঠান",
  "chatApprovals.digestNamed": "{name} সারসংক্ষেপে অন্তর্ভুক্ত করুন",
  "chatApprovals.notify": "চ্যাটের জন্য চালু নয় এমন অনুরোধে বিজ্ঞপ্তি দিন (বিবরণ ছাড়া)",
  "chatApprovals.digest.send": "সারসংক্ষেপ পান",
  "chatApprovals.workspace.slack": "Slack ওয়ার্কস্পেস (টিম) আইডি",
  "chatApprovals.workspace.discord": "Discord সার্ভার (guild) আইডি",
  "chatApprovals.channel.slack": "Slack চ্যানেল আইডি",
  "chatApprovals.channel.discord": "Discord চ্যানেল আইডি",
  "chatApprovals.approvers.label":
    "সিদ্ধান্ত নিতে পারেন এমন {name} ব্যবহারকারী আইডি (প্রতি লাইনে একটি)",
  "chatApprovals.approvers.hint":
    "শুধু অক্ষর ও অঙ্ক, প্রতিটি সর্বোচ্চ ২৪ অক্ষর, সর্বোচ্চ ২০টি। খালি তালিকার অর্থ কেউ সিদ্ধান্ত নিতে পারবে না।",
  "chatApprovals.projects.title": "অনুমোদিত প্রকল্প",
  "chatApprovals.projects.hint":
    "শুধু এই প্রকল্পগুলোর এজেন্ট অনুমোদনের উত্তর চ্যাট থেকে দেওয়া যাবে। খালি: কোনোটি নয়।",
  "chatApprovals.projects.label": "প্রকল্পের নাম (প্রতি লাইনে একটি)",
  "chatApprovals.digest.title": "নির্ধারিত সারসংক্ষেপ",
  "chatApprovals.digest.intro":
    "ডিফল্টভাবে বন্ধ। উপরের চ্যানেলে গণনা ও ছোট অনুমোদন আইডি পাঠায়, শুধু যেসব প্রদানকারী সারসংক্ষেপ পায় তাদের, নীরব সময়ে কখনও নয় এবং কিছু না ঘটলে কখনও নয়।",
  "chatApprovals.digest.enabled": "নির্ধারিত সারসংক্ষেপ পাঠান",
  "chatApprovals.digest.interval": "সারসংক্ষেপের মধ্যে মিনিট",
  "chatApprovals.digest.hint": "{min} (এক ঘণ্টা) থেকে {max} মিনিট (এক সপ্তাহ) পর্যন্ত।",
  "chatApprovals.cred.title": "ক্রেডেনশিয়াল",
  "chatApprovals.cred.writeOnly":
    "শুধু লেখার জন্য। আপনি যা টাইপ করেন তা Core-এর ক্রেডেনশিয়াল স্টোরে পাঠানো হয় এবং সঙ্গে সঙ্গে এই পৃষ্ঠা থেকে মুছে যায়। সংরক্ষিত মান আর কখনও দেখানো হয় না।",
  "chatApprovals.cred.save": "সংরক্ষণ",
  "chatApprovals.cred.stored": "সংরক্ষিত",
  "chatApprovals.cred.notStored": "সংরক্ষিত নয়",
  "chatApprovals.cred.remove": "সরান",
  "chatApprovals.cred.removeNamed": "সংরক্ষিত {name} সরান",
  "chatApprovals.field.slackBot": "Slack বট টোকেন",
  "chatApprovals.field.slackSigning": "Slack স্বাক্ষর গোপন কী",
  "chatApprovals.field.discordBot": "Discord বট টোকেন",
  "chatApprovals.field.discordKey": "Discord অ্যাপ্লিকেশনের পাবলিক কী",
  "chatApprovals.field.teamsWebhook": "Teams ওয়েবহুক ঠিকানা",
  "chatApprovals.field.teamsKey": "Teams লিংক কী",
  "chatApprovals.error.ids": "ওয়ার্কস্পেস ও চ্যানেল আইডিতে শুধু অক্ষর ও অঙ্ক, সর্বোচ্চ ২৪ অক্ষর।",
  "chatApprovals.error.approvers":
    "অনুমোদনকারী আইডিতে শুধু অক্ষর ও অঙ্ক, প্রতিটি সর্বোচ্চ ২৪ অক্ষর, সর্বোচ্চ ২০টি।",
  "chatApprovals.error.projects":
    "প্রকল্পের নাম ১ থেকে ১২০টি দৃশ্যমান অক্ষরের হতে হবে, সর্বোচ্চ ২০০টি প্রকল্প।",
  "chatApprovals.error.interval":
    "সারসংক্ষেপের ব্যবধান ৬০ থেকে ১০০৮০ এর মধ্যে পূর্ণসংখ্যার মিনিট হতে হবে।",
  "chatApprovals.error.save": "চ্যাট অনুমোদন সেটিং সংরক্ষণ করা যায়নি।",
  "chatApprovals.error.capability": "চ্যাট অনুমোদন সক্ষমতা পরিবর্তন করা যায়নি।",
  "chatApprovals.error.unavailable":
    "এই Phoenix Core-এ OS ক্রেডেনশিয়াল স্টোর নেই, তাই ক্রেডেনশিয়াল রাখা যায় না।",
  "chatApprovals.error.cred": "ক্রেডেনশিয়াল সংরক্ষিত বা সরানো হয়নি।",
  "chatApprovals.error.credShape":
    "এই মানটি এই ক্ষেত্রের জন্য সঠিক মনে হচ্ছে না, তাই পাঠানো হয়নি। দেখে আবার চেষ্টা করুন।",
};
