// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { phone as enphone } from "../../en/phone";

/** Machine-translated; unreviewed (see ../../README.md). */
export const phone: Record<keyof typeof enphone, string> = {
  "phone.title": "ربط الهاتف",
  "phone.intro":
    "اقرن هاتفًا ليتمكن من الموافقة على ما يسأل عنه Phoenix أو رفضه. يبقى معطّلًا حتى تشغّله.",
  "phone.unavailable": "تعذّر تحميل إعدادات ربط الهاتف.",
  "phone.warning.title": "قبل التشغيل",
  "phone.warning.network":
    "يؤدي التشغيل إلى فتح مستمع HTTPS منفصل يمكن للأجهزة الأخرى في شبكتك المحلية الوصول إليه (وليس الإنترنت).",
  "phone.warning.pairing":
    "فقط الهواتف التي تقرنها ثم تؤكدها هنا يمكنها الموافقة على أي شيء. يتطلب الاقتران رمزًا يظهر على هذه الشاشة.",
  "phone.warning.trust": "شغّله فقط على الشبكات الموثوقة، مثل شبكة منزلك.",
  "phone.warning.presence":
    "لا يستطيع Phoenix التحقق من وجود شخص أمام هذا الكمبيوتر: أي برنامج على هذا الكمبيوتر يملك رمز جلسة Core يمكنه أيضًا اقتران الهواتف.",
  "phone.enable.label": "السماح للهواتف في شبكتي المحلية بالاتصال",
  "phone.saved.on": "ربط الهاتف مفعّل.",
  "phone.saved.off": "ربط الهاتف معطّل.",
  "phone.saved.verifyOn": "ستطلب الموافقات من الهاتف الآن التحقق البيومتري أو التحقق من الجهاز.",
  "phone.saved.verifyOff": "لن تطلب الموافقات من الهاتف التحقق من الجهاز بعد الآن.",
  "phone.killSwitch":
    "مفتاح الإيقاف الطارئ مفعّل، لذا فإن مستمع الهاتف مغلق. أعد تشغيل ربط الهاتف هنا بعد تعطيل مفتاح الإيقاف الطارئ.",
  "phone.lockedOut": "الاقتران مقفل حتى {time} بسبب إدخال رموز خاطئة كثيرة.",
  "phone.notListening": "ربط الهاتف مفعّل، لكن المستمع لم يبدأ العمل بعد.",
  "phone.addressChanged":
    "عنوان الشبكة الذي اخترته لم يعد متاحًا، لذا يبقى ربط الهاتف متوقفًا. اختر عنوانًا مرة أخرى لتشغيله من جديد.",
  "phone.listen.address": "العنوان والمنفذ",
  "phone.listen.fingerprint": "بصمة الشهادة (SHA-256)",
  "phone.pair.show": "إظهار رمز الاقتران",
  "phone.pair.cancel": "إلغاء الرمز",
  "phone.pair.cancelled": "تم إلغاء رمز الاقتران.",
  "phone.pair.expired": "انتهت صلاحية رمز الاقتران. أظهر رمزًا جديدًا لاقتران هاتف.",
  "phone.pair.instruction":
    "على الهاتف، أدخل هذا الرمز أو امسحه ضوئيًا، وتحقق من أن البصمة المعروضة تطابق البصمة أدناه. إذا لم تتطابق فلا تتابع.",
  "phone.pair.codeLabel": "رمز الاقتران",
  "phone.pair.remaining": "تنتهي الصلاحية خلال {time}",
  "phone.pair.fingerprint": "بصمة الشهادة:",
  "phone.pair.link": "رابط الاقتران (رمز QR غير متاح):",
  "phone.pair.hiddenActive":
    "رمز اقتران نشط حتى {time}. لا يُعرض مرة أخرى؛ ألغِه وأظهر رمزًا جديدًا.",
  "phone.pending.question": 'هل تقرن "{name}"؟',
  "phone.pending.fingerprint": "بصمة المفتاح",
  "phone.pending.yes": "نعم، اقرن هذا الهاتف",
  "phone.pending.no": "لا، ارفض",
  "phone.pending.waiting": "بانتظار أن يطلب Phoenix تأكيدك.",
  "phone.pending.approved": "تم اقتران الهاتف.",
  "phone.pending.rejected": "تم رفض الاقتران.",
  "phone.verify.label": "اشتراط التحقق البيومتري أو التحقق من الجهاز عند الموافقات",
  "phone.verify.note":
    "يبلغ الهاتف عمّا إذا تم التحقق من الشخص (بصمة أو وجه أو قفل الشاشة). لا يستطيع Phoenix التحقق من هذا التقرير بنفسه.",
  "phone.devices.title": "الهواتف المقترنة",
  "phone.devices.none": "لا توجد هواتف مقترنة.",
  "phone.devices.fingerprint": "بصمة المفتاح",
  "phone.devices.created": "اقترن في {date}",
  "phone.devices.lastSeen": "آخر ظهور {when}",
  "phone.devices.neverSeen": "لم يظهر أبدًا",
  "phone.devices.revoked": "أُلغي في {date}",
  "phone.devices.revoke": "إلغاء {name}",
  "phone.devices.revokeAsk": 'هل تلغي "{name}"؟ لن يتمكن بعد الآن من الموافقة على أي شيء.',
  "phone.devices.revokeYes": "نعم، ألغِه",
  "phone.devices.revokeNo": "أبقِه",
  "phone.devices.revokedDone": "تم إلغاء الهاتف.",
  "phone.device.unnamed": "هاتف بلا اسم",
};
