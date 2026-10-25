// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browser as enBrowser } from "../../en/browser";

/** Machine-translated; unreviewed. */
export const browser: Record<keyof typeof enBrowser, string> = {
  "browser.tabs.label": "علامات التبويب",
  "browser.tab.untitled": "علامة تبويب جديدة",
  "browser.tab.loading": "جارٍ التحميل",
  "browser.tab.close": "إغلاق علامة التبويب {title}",
  "browser.tab.new": "علامة تبويب جديدة",
  "browser.nav.back": "رجوع",
  "browser.nav.forward": "تقدّم",
  "browser.nav.reload": "إعادة التحميل",
  "browser.address.label": "عنوان أو بحث",
  "browser.address.placeholder": "ابحث أو اكتب عنوانًا",
  "browser.address.go": "انتقال",
  "browser.address.blocked": "لم يُفتح: {text}",
  "browser.deny.unparseable": "هذا ليس عنوان ويب صالحًا.",
  "browser.deny.scheme_not_allowed": "يمكن فتح عناوين الويب الآمنة (https) فقط.",
  "browser.deny.dangerous_scheme":
    "لا يمكن فتح العناوين التي تشغّل شيفرة أو تحتوي على الصفحة نفسها.",
  "browser.deny.file_blocked": "لا يمكن فتح ملفات هذا الكمبيوتر هنا.",
  "browser.deny.credentials_in_url": "تُرفض العناوين التي تحتوي على اسم مستخدم أو كلمة مرور.",
  "browser.deny.private_network":
    "لا يمكن كتابة عناوين هذا الكمبيوتر أو شبكتك المحلية هنا. افتح صفحة البرنامج من رادار المنافذ بدلًا من ذلك.",
  "browser.deny.bad_port": "هذا المنفذ محظور لأنه يخص خدمة غير ويب.",
  "browser.deny.insecure_blocked": "لا تُفتح عناوين http العادية.",
  "browser.deny.site_denied": "هذا الموقع في قائمة الحظر.",
  "browser.deny.dns_private": "يشير هذا الاسم إلى عنوان على هذا الكمبيوتر أو شبكتك المحلية.",
  "browser.deny.port_radar_invalid":
    "لم يكن طلب رادار المنافذ صفحة عادية على هذا الكمبيوتر، لذا تم تجاهله.",
  "browser.deny.unknown": "تم رفض هذا العنوان.",
  "browser.zoom.label": "التكبير",
  "browser.zoom.out": "تصغير",
  "browser.zoom.in": "تكبير",
  "browser.zoom.reset": "إعادة التكبير إلى {percent}",
  "browser.shields.label": "حظر الإعلانات وأدوات التتبع في {site}",
  "browser.shields.saveFailed": "طُبّق الاختيار هنا لكن تعذّر حفظه في Phoenix Core.",
  "browser.shields.blocked":
    "{count, plural, zero {لا طلبات محظورة} one {طلب واحد محظور} two {طلبان محظوران} few {# طلبات محظورة} many {# طلبًا محظورًا} other {# طلب محظور}}",
  "browser.empty": "لا توجد علامة تبويب مفتوحة. اكتب عنوانًا أو بحثًا أعلاه.",
  "browser.noShell":
    "هذه الصفحة هي شريط أدوات متصفح Phoenix. تعمل فقط داخل تطبيق Phoenix لسطح المكتب.",
  "browser.radar.title": "فتح برنامج من هذا الكمبيوتر؟",
  "browser.radar.body":
    "يطلب رادار المنافذ فتح هذا العنوان. إنه برنامج يعمل على هذا الكمبيوتر وليس موقع ويب، وهو غير مشفّر.",
  "browser.radar.url": "العنوان: {url}",
  "browser.radar.open": "فتح",
  "browser.radar.cancel": "إلغاء",
  "browser.error.action": "تعذّر على المتصفح تنفيذ ذلك.",
  "browser.profile.label": "تُفتح علامات التبويب الجديدة في",
  "browser.profile.private": "خاص (لا يُحفظ شيء)",
  "browser.tab.profile": "ملف التعريف: {name}",
  "browser.deny.profile_invalid": "ملف التعريف هذا غير صالح، لذا لم يُفتح شيء.",
  "browser.deny.profile_unsupported": "ملفات التعريف المحفوظة غير متاحة في هذا الإصدار من المتصفح.",
  "browser.deny.profile_busy": "ملف التعريف هذا قيد الحذف أو مشغول. حاول مرة أخرى بعد قليل.",
  "browser.deny.profile_failed": "تعذّر فتح تخزين الويب لملف التعريف.",
  "browser.purge.running": "جارٍ حذف بيانات الويب المحفوظة لملف تعريف محذوف…",
  "browser.purge.failed":
    "تعذّر حذف بيانات الويب المحفوظة لملف تعريف محذوف حتى الآن. سيحاول Phoenix مرة أخرى.",
};
