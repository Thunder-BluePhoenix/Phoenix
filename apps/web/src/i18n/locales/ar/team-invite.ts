// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamInvite as enTeamInvite } from "../../en/team-invite";

/** Machine-translated; unreviewed. */
export const teamInvite: Record<keyof typeof enTeamInvite, string> = {
  "teamInvite.share.title": "مشاركة هويتي",
  "teamInvite.share.intro":
    "أرسل هذه الدعوة إلى زميل عبر الدردشة أو البريد. تحتوي فقط على معرّف فريقك ومفتاحك العام والاسم الذي تكتبه أدناه. لا يوجد فيها أي سر، ومفتاحك الخاص لا يغادر هذا الحاسوب أبدًا.",
  "teamInvite.share.label": "الاسم الذي يوضع في الدعوة (اختياري)",
  "teamInvite.share.invalid": "تعذّر إنشاء دعوة من هذه الهوية.",
  "teamInvite.share.invite": "دعوتك",
  "teamInvite.share.copy": "نسخ الدعوة",
  "teamInvite.share.copied": "تم نسخ الدعوة إلى الحافظة.",
  "teamInvite.share.copyFailed":
    "تعذّر على Phoenix استخدام الحافظة. حدّد الدعوة أعلاه وانسخها يدويًا.",
  "teamInvite.share.fingerprintHint":
    "اقرأ البصمة لزميلك صوتيًا أو في دردشة أخرى ليتحقق من أن الدعوة التي وصلته هي دعوتك.",
  "teamInvite.fingerprint": "بصمة المفتاح",
  "teamInvite.checksumNote":
    "الرمز القصير في نهاية الدعوة يكشف أخطاء النسخ فقط. لا يثبت من أنشأ الدعوة؛ مقارنة البصمة وحدها تثبت ذلك.",
  "teamInvite.refusal.empty": "الصق دعوة أولًا.",
  "teamInvite.refusal.tooLong": "هذا أطول من أن يكون دعوة فريق.",
  "teamInvite.refusal.format": "هذه ليست دعوة فريق من Phoenix.",
  "teamInvite.refusal.version": "هذه الدعوة من إصدار آخر من Phoenix لا يستطيع هذا الإصدار قراءته.",
  "teamInvite.refusal.checksum":
    "تم تغيير الدعوة أو نسخها بشكل خاطئ. اطلب من زميلك إرسالها مجددًا.",
  "teamInvite.refusal.content": "الدعوة تالفة أو محتواها غير متوقع.",
  "teamInvite.refusal.id": "معرّف الفريق في الدعوة غير صالح.",
  "teamInvite.refusal.key": "المفتاح العام في الدعوة غير صالح.",
  "teamInvite.refusal.label": "الاسم في الدعوة غير صالح.",
  "teamInvite.refusal.unsupported": "لا يستطيع هذا المتصفح فحص الدعوات.",
  "teamInvite.refusal.own": "هذه الدعوة هي هويتك أنت.",
  "teamInvite.refusal.duplicate": "هذا الزميل موجود بالفعل في قائمتك. أزِله أولًا لتغيير مفتاحه.",
  "teamInvite.add.title": "إضافة زميل",
  "teamInvite.add.paste": "الصق دعوة زميل",
  "teamInvite.add.preview": "تحقق من هذه التفاصيل قبل إضافة هذا الزميل.",
  "teamInvite.add.noLabel": "لا يوجد اسم في الدعوة؛ اكتب اسمًا لعرضه.",
  "teamInvite.add.theirLabel": "الاسم في الدعوة هو: {label}",
  "teamInvite.add.confirm": "قارنت هذه البصمة مع زميلي صوتيًا أو في دردشة أخرى وهي مطابقة.",
};
