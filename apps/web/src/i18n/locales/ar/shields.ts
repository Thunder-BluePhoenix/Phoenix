// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { shields as enShields } from "../../en/shields";

/** Machine-translated; unreviewed. */
export const shields: Record<keyof typeof enShields, string> = {
  "shields.title": "حظر الإعلانات وأدوات التتبع",
  "shields.intro":
    "تُطبَّق هذه الإعدادات في متصفح Phoenix عند صدوره. ليس لدى Phoenix نافذة متصفح بعد، لذلك لا يُحظر اليوم أي شيء في أي صفحة. بهذه الطريقة يمكن حظر طلبات الشبكة فقط: إخفاء عناصر الصفحة غير مدعوم، وهذا ليس نسخة من حماية أي متصفح آخر.",
  "shields.unavailable": "إعدادات حظر الإعلانات وأدوات التتبع غير متاحة من Phoenix Core.",
  "shields.loadFailed": "تعذّرت قراءة إعدادات الحظر من Phoenix Core.",
  "shields.global.label": "حظر الإعلانات وأدوات التتبع",
  "shields.global.hint":
    "عند الإيقاف لا تُطبَّق أي قائمة على أي موقع. وعند التشغيل مع عدم تنزيل أي قائمة تُستخدم قائمة مدمجة قصيرة بمضيفات الإعلانات والتحليلات المعروفة.",
  "shields.lists.title": "قوائم المرشِّحات",
  "shields.lists.note":
    "القوائم ليست مضمَّنة في Phoenix ولا تُنزَّل من تلقاء نفسها. الضغط على «تحديث» يتصل بـ easylist.to مرة واحدة لتنزيل تلك القائمة. لا يُرسَل أي شيء عنك أو عن صفحاتك.",
  "shields.list.purpose.ads": "يحظر الإعلانات",
  "shields.list.purpose.trackers": "يحظر التتبع",
  "shields.list.never": "لم تُنزَّل أبدًا.",
  "shields.list.damaged": "النسخة المحفوظة تالفة ولا تُستخدم. اضغط «تحديث» لتنزيلها مجددًا.",
  "shields.list.status":
    "نُزّلت في {date} · {rules} قاعدة حظر · {cosmetic} قاعدة لعناصر الصفحة متجاهَلة",
  "shields.list.version": "إصدار القائمة {version}",
  "shields.list.due":
    "تقترح القائمة البحث عن إصدار جديد بعد {date}. لا يتحقق Phoenix من تلقاء نفسه أبدًا.",
  "shields.list.licence": "الترخيص: {licence}. الإسناد: {attribution}.",
  "shields.list.source": "يتصل التحديث بـ {source}",
  "shields.list.enable": "استخدام {name}",
  "shields.list.enableNeedsDownload": "نزّل القائمة قبل تشغيلها.",
  "shields.list.update": "تحديث",
  "shields.list.updateFirst": "تنزيل",
  "shields.list.updating": "جارٍ التنزيل…",
  "shields.list.updated": "تم تحديث {name}.",
  "shields.list.remove": "حذف النسخة المنزَّلة",
  "shields.list.removed": "حُذفت النسخة المنزَّلة من {name}.",
  "shields.sites.title": "مواقع الحظر فيها متوقف",
  "shields.sites.empty": "لا يوجد موقع الحظر فيه متوقف.",
  "shields.sites.add.label": "اسم الموقع، مثل example.com",
  "shields.sites.add.submit": "إيقاف الحظر لهذا الموقع",
  "shields.sites.remove": "إعادة تشغيل الحظر لـ {site}",
  "shields.sites.hint":
    "اكتب اسم الموقع فقط وليس عنوانًا. يشمل ذلك الموقع ونطاقاته الفرعية. تُترك إعلانات YouTube نفسها دون حظر ما دام موقع موسيقى YouTube مسموحًا، ويُضبط ذلك في مواقع الموسيقى وليس هنا.",
};
