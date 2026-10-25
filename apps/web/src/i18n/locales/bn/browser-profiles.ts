// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserProfiles as enBrowserProfiles } from "../../en/browser-profiles";

/** Machine-translated; unreviewed. */
export const browserProfiles: Record<keyof typeof enBrowserProfiles, string> = {
  "browserProfiles.title": "ব্রাউজার প্রোফাইল",
  "browserProfiles.intro":
    "Phoenix-এর এখনও নিজস্ব ব্রাউজার নেই, তাই এখানে কোনো পেজ খোলে না: প্রোফাইল শুধু বুকমার্ক, সিঙ্কের পছন্দ ও এক্সটেনশনের একটি রেকর্ড।",
  "browserProfiles.unavailable":
    "ব্রাউজার প্রোফাইল পাওয়া যাচ্ছে না: Phoenix Core-এর কাছে সেগুলি নিরাপদে রাখার জন্য অপারেটিং সিস্টেমের সিক্রেট স্টোর নেই।",
  "browserProfiles.loadFailed": "Phoenix Core থেকে ব্রাউজার প্রোফাইল পড়া যায়নি।",
  "browserProfiles.empty": "এখনও কোনো প্রোফাইল নেই।",
  "browserProfiles.list": "প্রোফাইল",
  "browserProfiles.create.name": "প্রোফাইলের নাম",
  "browserProfiles.create.submit": "প্রোফাইল তৈরি করুন",
  "browserProfiles.counts": "বুকমার্ক: {bookmarks} · ইতিহাস: {history} · এক্সটেনশন: {extensions}",
  "browserProfiles.sync.label": "আমার ডিভাইসগুলির মধ্যে এই প্রোফাইল সিঙ্ক করুন",
  "browserProfiles.sync.hint": "সেটিংস → সিঙ্কে অ্যাকাউন্ট সিঙ্কও সেট করা থাকলে তবেই সিঙ্ক চলে।",
  "browserProfiles.import.label": "ইমপোর্ট করার বুকমার্ক (ব্রাউজার থেকে এক্সপোর্ট করা HTML ফাইল)",
  "browserProfiles.import.hint":
    "ফাইলের বিষয়বস্তু পেস্ট করুন। একবারে সর্বোচ্চ 256 KiB; বড় এক্সপোর্ট কয়েক ভাগে ভাগ করুন।",
  "browserProfiles.import.submit": "বুকমার্ক ইমপোর্ট করুন",
  "browserProfiles.import.result": "{imported}টি ইমপোর্ট হয়েছে, {skipped}টি বাদ পড়েছে।",
  "browserProfiles.publish.submit": "আমার অন্য ডিভাইসগুলিতে প্রকাশ করুন",
  "browserProfiles.publish.done": "প্রকাশিত হয়েছে।",
  "browserProfiles.remove.start": "প্রোফাইল সরান",
  "browserProfiles.remove.ask":
    "“{name}” সরাবেন? এতে এর বুকমার্ক, ইতিহাস, এক্সটেনশন ও সংরক্ষিত ক্রেডেনশিয়াল মুছে যাবে, এবং এটি ফেরানো যায় না।",
  "browserProfiles.remove.done":
    "প্রোফাইল সরানো হয়েছে। এর বুকমার্ক, ইতিহাস, এক্সটেনশন ও সংরক্ষিত ক্রেডেনশিয়াল মুছে ফেলা হয়েছে। এর সংরক্ষিত ওয়েব ডেটা (কুকি ও সাইট স্টোরেজ) Phoenix ব্রাউজার উইন্ডো খোলা থাকলে মুছে ফেলা হয়, কারণ ডেস্কটপ শেলকে মুছতে বলতে শুধু ওই উইন্ডোই পারে।",
  "browserProfiles.purge.pending":
    "সরানো {count}টি প্রোফাইলের সংরক্ষিত ওয়েব ডেটা মোছার অপেক্ষায় আছে। শেষ করতে Phoenix ব্রাউজার খুলুন।",
  "browserProfiles.devices.heading": "অন্যান্য ডিভাইস",
  "browserProfiles.devices.check": "আমার অন্য ডিভাইসের প্রোফাইল খুঁজুন",
  "browserProfiles.devices.none": "আপনার অন্য ডিভাইস থেকে কোনো নতুন প্রোফাইল নেই।",
  "browserProfiles.devices.found": "আপনার অন্য ডিভাইসের প্রোফাইল",
  "browserProfiles.devices.adopt": "গ্রহণ করুন",
  "browserProfiles.devices.adoptLabel": "{name} এই ডিভাইসে গ্রহণ করুন",
  "browserProfiles.devices.adopted": "প্রোফাইল গ্রহণ করা হয়েছে।",
  "browserProfiles.ext.heading": "এক্সটেনশন",
  "browserProfiles.ext.admin": "এক্সটেনশন আপনার প্রশাসক ইনস্টল করেন।",
  "browserProfiles.ext.none": "কোনো এক্সটেনশন নেই।",
  "browserProfiles.ext.loadFailed": "এক্সটেনশন পড়া যায়নি।",
  "browserProfiles.ext.version": "সংস্করণ {version}",
  "browserProfiles.ext.origins": "সাইট: {origins}",
  "browserProfiles.ext.permissions": "অনুমতি: {permissions}",
  "browserProfiles.ext.noneListed": "কিছু নেই",
  "browserProfiles.ext.approved": "অনুমোদিত",
  "browserProfiles.ext.notApproved": "অনুমোদিত নয়",
  "browserProfiles.ext.revoked": "প্রত্যাহার করা হয়েছে",
  "browserProfiles.ext.untrusted": "স্বাক্ষরকারী বিশ্বস্ত নয়",
  "browserProfiles.ext.approve": "অনুমোদন করুন",
  "browserProfiles.ext.approveLabel": "এক্সটেনশন {id} অনুমোদন করুন",
  "browserProfiles.ext.withdraw": "অনুমোদন প্রত্যাহার করুন",
  "browserProfiles.ext.withdrawLabel": "এক্সটেনশন {id}-এর অনুমোদন প্রত্যাহার করুন",
  "browserProfiles.ext.remove": "সরান",
  "browserProfiles.ext.removeLabel": "এক্সটেনশন {id} সরান",
  "browserProfiles.ext.waiting": "অনুমোদনের প্রশ্নে আপনার উত্তরের অপেক্ষায়…",
  "browserProfiles.music.title": "মিউজিক সাইট",
  "browserProfiles.music.intro":
    "Phoenix গান বাজায় না। কোনো সাইট চালু করলে Phoenix শুধু তার জন্য একটি সার্চ ঠিকানা তৈরি করে, যা আপনি নিজে খোলেন। আপনি চালু না করা পর্যন্ত প্রতিটি সাইট বন্ধ থাকে।",
  "browserProfiles.music.unavailable": "এই Phoenix Core-এ মিউজিক সাইট পাওয়া যায় না।",
  "browserProfiles.music.loadFailed": "Phoenix Core থেকে মিউজিক সাইট পড়া যায়নি।",
  "browserProfiles.music.list": "মিউজিক সাইট",
  "browserProfiles.music.hosts": "ব্যবহৃত ঠিকানা: {hosts}",
  "browserProfiles.music.adBlocking":
    "YouTube চালু থাকলে বিজ্ঞাপন ব্লক করা তার নিজস্ব প্লেয়ারে প্রযোজ্য নয়।",
  "browserProfiles.music.site.youtube": "YouTube",
  "browserProfiles.music.site.soundcloud": "SoundCloud",
  "browserProfiles.music.site.bandcamp": "Bandcamp",
  "browserProfiles.music.site.spotify-web": "Spotify Web",
  "browserProfiles.music.site.other": "মিউজিক সাইট {site}",
  "browserProfiles.music.search.label": "{site}-এ খুঁজুন",
  "browserProfiles.music.search.submit": "খুঁজুন",
  "browserProfiles.music.search.open": "সার্চ ঠিকানা (নতুন ট্যাবে খোলে):",
  "browserProfiles.music.search.badAddress":
    "Phoenix Core এমন একটি ঠিকানা ফেরত দিয়েছে যা খোলা যায় না।",
};
