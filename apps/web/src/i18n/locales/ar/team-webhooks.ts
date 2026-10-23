// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamWebhooks as enTeamWebhooks } from "../../en/team-webhooks";

/** Machine-translated; unreviewed. */
export const teamWebhooks: Record<keyof typeof enTeamWebhooks, string> = {
  "teamWebhooks.title": "الـ Webhooks الواردة",
  "teamWebhooks.intro":
    "الـ Webhooks الواردة متوقفة افتراضيًا. يمنح المصدر أداةً أخرى عنوانه الخاص وسرّه الخاص؛ وعندما ترسل تلك الأداة رسالة موقّعة بشكل صحيح يحوّلها Phoenix إلى حدث محلي. لا يُرسَل شيء إلى أي مكان، ويُعامَل ما يرسله المصدر على أنه نص غير موثوق.",
  "teamWebhooks.notAvailable":
    "الـ Webhooks الواردة غير متاحة: لا يملك هذا الـ Phoenix Core مخزن أسرار في نظام التشغيل لحفظ أسرار المصادر.",
  "teamWebhooks.loadFailed": "تعذّر تحميل الـ Webhooks الواردة.",
  "teamWebhooks.master": "قبول الـ Webhooks الواردة",
  "teamWebhooks.secret.title": "سرّ {id}",
  "teamWebhooks.secret.warning":
    "يُعرض هذا السر مرة واحدة فقط. انسخه الآن واحتفظ به في الأداة المرسِلة. يحتفظ Phoenix به فقط في مخزن أسرار نظام التشغيل ولا يستطيع عرضه مجددًا؛ وإذا فقدته فاحذف المصدر وأنشئ مصدرًا جديدًا.",
  "teamWebhooks.secret.path": "عنوان الإرسال (على هذا الـ Core)",
  "teamWebhooks.secret.label": "سر التوقيع",
  "teamWebhooks.secret.copy": "نسخ السر",
  "teamWebhooks.secret.copied": "تم النسخ إلى الحافظة.",
  "teamWebhooks.secret.copyFailed":
    "تعذّر على Phoenix استخدام الحافظة. حدّد السر أعلاه وانسخه يدويًا قبل الإغلاق.",
  "teamWebhooks.secret.done": "لقد حفظته، إغلاق",
  "teamWebhooks.sources.title": "المصادر",
  "teamWebhooks.sources.none": "لم تنشئ أي مصدر Webhook بعد.",
  "teamWebhooks.row.path": "العنوان: {path}",
  "teamWebhooks.row.types": "أنواع الأحداث: {types}",
  "teamWebhooks.row.never": "لم يُستلَم شيء بعد.",
  "teamWebhooks.row.last": "آخر ما قُبل: {time}",
  "teamWebhooks.delete.label": "حذف المصدر {id}",
  "teamWebhooks.delete.ask": "حذف {id}؟ سيتوقف سرّه عن العمل فورًا ويجب تغيير الأداة المرسِلة.",
  "teamWebhooks.create.title": "إنشاء مصدر",
  "teamWebhooks.create.id": "اسم المصدر",
  "teamWebhooks.create.idHint": "من 3 إلى 32 حرفًا: أحرف صغيرة وأرقام و - أو _ وتبدأ بحرف.",
  "teamWebhooks.create.types": "أنواع الأحداث التي يجوز له إرسالها",
  "teamWebhooks.create.typesHint":
    "افصل بينها بفواصل، مثل ci.finished. يبدأ كل نوع بأحد ما يلي: {namespaces}.",
  "teamWebhooks.create.typesTooMany": "اذكر {max} نوع حدث على الأكثر.",
  "teamWebhooks.create.typesInvalid":
    "نوع الحدث كلمات بأحرف صغيرة تربط بينها نقاط، مثل ci.finished.",
  "teamWebhooks.create.typesNamespace": "يجب أن يبدأ نوع الحدث بأحد ما يلي: {namespaces}.",
  "teamWebhooks.create.limit": "بلغت الحد الأقصى وهو {max} مصدرًا. احذف واحدًا أولًا.",
  "teamWebhooks.create.submit": "إنشاء المصدر",
};
