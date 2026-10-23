// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserProfiles as enBrowserProfiles } from "../../en/browser-profiles";

/** Machine-translated; unreviewed. */
export const browserProfiles: Record<keyof typeof enBrowserProfiles, string> = {
  "browserProfiles.title": "ملفات تعريف المتصفح",
  "browserProfiles.intro":
    "ليس لدى Phoenix متصفح خاص به بعد، لذلك لا تُفتح هنا أي صفحة: ملف التعريف مجرد سجل للإشارات المرجعية واختيار المزامنة والإضافات.",
  "browserProfiles.unavailable":
    "ملفات تعريف المتصفح غير متاحة: لا يملك Phoenix Core مخزن أسرار في نظام التشغيل لحفظها بأمان.",
  "browserProfiles.loadFailed": "تعذّرت قراءة ملفات تعريف المتصفح من Phoenix Core.",
  "browserProfiles.empty": "لا توجد ملفات تعريف بعد.",
  "browserProfiles.list": "ملفات التعريف",
  "browserProfiles.create.name": "اسم ملف التعريف",
  "browserProfiles.create.submit": "إنشاء ملف تعريف",
  "browserProfiles.counts":
    "الإشارات المرجعية: {bookmarks} · السجل: {history} · الإضافات: {extensions}",
  "browserProfiles.sync.label": "مزامنة ملف التعريف هذا بين أجهزتي",
  "browserProfiles.sync.hint":
    "لا تعمل المزامنة إلا إذا كانت مزامنة الحساب مُعدّة أيضًا في الإعدادات ← المزامنة.",
  "browserProfiles.import.label": "الإشارات المرجعية المراد استيرادها (ملف HTML مُصدَّر من متصفح)",
  "browserProfiles.import.hint":
    "الصق محتوى الملف. حتى 256 KiB في كل مرة؛ قسّم التصدير الأكبر إلى أجزاء.",
  "browserProfiles.import.submit": "استيراد الإشارات المرجعية",
  "browserProfiles.import.result": "تم استيراد {imported}، وتم تخطي {skipped}.",
  "browserProfiles.publish.submit": "النشر على أجهزتي الأخرى",
  "browserProfiles.publish.done": "تم النشر.",
  "browserProfiles.remove.start": "إزالة ملف التعريف",
  "browserProfiles.remove.ask":
    "هل تريد إزالة «{name}»؟ سيؤدي هذا إلى حذف إشاراته المرجعية وسجله وإضافاته وبيانات الاعتماد المحفوظة، ولا يمكن التراجع عنه.",
  "browserProfiles.remove.done":
    "تمت إزالة ملف التعريف. حُذفت إشاراته المرجعية وسجله وإضافاته وبيانات الاعتماد المحفوظة. لا يستطيع Phoenix Core بعد مسح التخزين المعزول للويب المسمى {partition}.",
  "browserProfiles.devices.heading": "الأجهزة الأخرى",
  "browserProfiles.devices.check": "البحث عن ملفات تعريف من أجهزتي الأخرى",
  "browserProfiles.devices.none": "لا توجد ملفات تعريف جديدة من أجهزتك الأخرى.",
  "browserProfiles.devices.found": "ملفات تعريف من أجهزتك الأخرى",
  "browserProfiles.devices.adopt": "اعتماد",
  "browserProfiles.devices.adoptLabel": "اعتماد {name} على هذا الجهاز",
  "browserProfiles.devices.adopted": "تم اعتماد ملف التعريف.",
  "browserProfiles.ext.heading": "الإضافات",
  "browserProfiles.ext.admin": "يثبّت مسؤولك الإضافات.",
  "browserProfiles.ext.none": "لا توجد إضافات.",
  "browserProfiles.ext.loadFailed": "تعذّرت قراءة الإضافات.",
  "browserProfiles.ext.version": "الإصدار {version}",
  "browserProfiles.ext.origins": "المواقع: {origins}",
  "browserProfiles.ext.permissions": "الأذونات: {permissions}",
  "browserProfiles.ext.noneListed": "لا شيء",
  "browserProfiles.ext.approved": "موافَق عليها",
  "browserProfiles.ext.notApproved": "غير موافَق عليها",
  "browserProfiles.ext.approve": "موافقة",
  "browserProfiles.ext.approveLabel": "الموافقة على الإضافة {id}",
  "browserProfiles.ext.withdraw": "سحب الموافقة",
  "browserProfiles.ext.withdrawLabel": "سحب الموافقة على الإضافة {id}",
  "browserProfiles.ext.remove": "إزالة",
  "browserProfiles.ext.removeLabel": "إزالة الإضافة {id}",
  "browserProfiles.ext.waiting": "في انتظار إجابتك عن سؤال الموافقة…",
  "browserProfiles.music.title": "مواقع الموسيقى",
  "browserProfiles.music.intro":
    "لا يشغّل Phoenix الموسيقى. تفعيل موقع يتيح لـ Phoenix فقط إنشاء عنوان بحث له تفتحه بنفسك. كل المواقع متوقفة حتى تفعّلها.",
  "browserProfiles.music.unavailable": "مواقع الموسيقى غير متاحة في هذا Phoenix Core.",
  "browserProfiles.music.loadFailed": "تعذّرت قراءة مواقع الموسيقى من Phoenix Core.",
  "browserProfiles.music.list": "مواقع الموسيقى",
  "browserProfiles.music.hosts": "العناوين المستخدمة: {hosts}",
  "browserProfiles.music.adBlocking":
    "أثناء تفعيل YouTube، لا ينطبق حظر الإعلانات على مشغّله الخاص.",
  "browserProfiles.music.site.youtube": "YouTube",
  "browserProfiles.music.site.soundcloud": "SoundCloud",
  "browserProfiles.music.site.bandcamp": "Bandcamp",
  "browserProfiles.music.site.spotify-web": "Spotify Web",
  "browserProfiles.music.site.other": "موقع الموسيقى {site}",
  "browserProfiles.music.search.label": "البحث في {site}",
  "browserProfiles.music.search.submit": "بحث",
  "browserProfiles.music.search.open": "عنوان البحث (يُفتح في علامة تبويب جديدة):",
  "browserProfiles.music.search.badAddress": "أعاد Phoenix Core عنوانًا لا يمكن فتحه.",
};
