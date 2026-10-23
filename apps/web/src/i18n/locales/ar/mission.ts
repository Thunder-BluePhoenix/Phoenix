// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { mission as enmission } from "../../en/mission";

/** Machine-translated; unreviewed (see ../../README.md). */
export const mission: Record<keyof typeof enmission, string> = {
  "mission.title": "مركز التحكم بالمهام",
  "mission.nav": "المهام",
  "mission.note":
    "الرموز (التوكنات) والتكلفة هي ما يبلغ عنه الوكلاء أنفسهم. ولم يتم التحقق منها مقابل فاتورة المزوّد.",
  "mission.sourceMissing":
    "تعذّرت قراءة بعض جلسات الوكلاء الآن (ميزة الوكلاء متوقفة أو لا تستجيب)، لذا قد تنقص اللوحة بعض الجلسات.",
  "mission.refresh": "تحديث",
  "mission.loadFailed": "تعذّر تحميل مركز التحكم بالمهام.",

  "mission.filter.search": "بحث في الجلسات",
  "mission.filter.searchPlaceholder": "وكيل أو مشروع أو معرّف جلسة",
  "mission.filter.agent": "الوكيل",
  "mission.filter.project": "المشروع",
  "mission.filter.state": "الحالة",
  "mission.filter.all": "الكل",
  "mission.filter.clear": "مسح عوامل التصفية",

  "mission.state.working": "يعمل",
  "mission.state.waiting": "بانتظارك",
  "mission.state.finished": "انتهى",
  "mission.state.stuck": "عالق",
  "mission.reason.permission": "يحتاج إلى إذنك",
  "mission.reason.input": "لديه سؤال لك",
  "mission.reason.idle": "خامل عند موجّه الأوامر",
  "mission.stuck.noReport": "لا تقرير منذ مدة تتجاوز حد التوقف",
  "mission.stuck.safetyStall": "وسمته شبكة الأمان على أنه متوقف",

  "mission.board.title": "الجلسات",
  "mission.board.empty": "لا توجد جلسات وكلاء لعرضها.",
  "mission.board.noMatch": "لا توجد جلسة تطابق عوامل التصفية.",
  "mission.column.count":
    "{count, plural, zero {# جلسات} one {جلسة واحدة} two {جلستان} few {# جلسات} many {# جلسة} other {# جلسة}}",
  "mission.column.empty": "لا شيء",

  "mission.card.open": "التفاصيل",
  "mission.card.focus": "الانتقال إلى الطرفية",
  "mission.card.focused": "تم إحضار نافذة الطرفية إلى الأمام.",
  "mission.card.unnamedProject": "مشروع غير معروف",
  "mission.card.tokens": "{input} دخل، {output} خرج",
  "mission.card.noTokens": "لم يتم الإبلاغ عن أعداد الرموز",
  "mission.card.cost": "التكلفة {cost}",
  "mission.card.costPartial": "التكلفة {cost} أو أكثر (بعض الاستخدام بلا تكلفة معروفة)",
  "mission.card.costUnknown": "التكلفة غير معروفة",
  "mission.card.lastSeen": "آخر رد {ago}",
  "mission.card.steps":
    "{count, plural, zero {# خطوات} one {خطوة واحدة} two {خطوتان} few {# خطوات} many {# خطوة} other {# خطوة}}",

  "mission.totals.title": "الرموز والتكلفة",
  "mission.totals.window":
    "آخر {days, plural, zero {# أيام} one {يوم} two {يومين} few {# أيام} many {# يومًا} other {# يوم}}",
  "mission.totals.input": "رموز الإدخال",
  "mission.totals.output": "رموز الإخراج",
  "mission.totals.cost": "التكلفة",
  "mission.totals.unknown": "غير معروفة",
  "mission.totals.partial": "{cost} أو أكثر",
  "mission.totals.unpriced":
    "لم يُحدَّد سعر لـ: {models}. تكلفتها غير معروفة وليست صفرًا. أضف سعرًا أدناه لرؤية التكلفة.",
  "mission.totals.empty": "لم يبلغ أي وكيل عن رموز أو تكلفة في هذه الفترة.",

  "mission.by.day": "حسب اليوم",
  "mission.by.agent": "حسب الوكيل",
  "mission.by.project": "حسب المشروع",
  "mission.by.session": "حسب الجلسة",
  "mission.col.day": "اليوم",
  "mission.col.agent": "الوكيل",
  "mission.col.project": "المشروع",
  "mission.col.session": "الجلسة",
  "mission.col.input": "الإدخال",
  "mission.col.output": "الإخراج",
  "mission.col.cost": "التكلفة",

  "mission.budgets.title": "الميزانيات",
  "mission.budgets.note":
    "يصلك تنبيه قبل بلوغ الحد، عند {thresholds} منه، مرة واحدة لكل ميزانية في اليوم. ميزانيات التكلفة لا تحتسب إلا الاستخدام ذا التكلفة المعروفة.",
  "mission.budgets.none": "لا توجد ميزانيات بعد.",
  "mission.budgets.line": "{scope}، {metric}{agent}: {used} من {limit} ({pct}%)",
  "mission.budgets.lineAtLeast":
    "{scope}، {metric}{agent}: {used} على الأقل من {limit} ({pct}%)؛ بعض الاستخدام بلا تكلفة معروفة ولم يُحتسب",
  "mission.ingest.notice":
    "اليوم قلّص Core {clamped, plural, one {# تقرير} other {# تقارير}} إلى حد معين ورفض {refused, plural, one {# تقرير} other {# تقارير}}، لذا قد تكون الأرقام أدناه أقل مما أبلغت عنه الوكلاء. الوكلاء: {agents}.",
  "mission.budgets.lineUnknown": "{scope}، {metric}{agent}: الاستخدام غير معروف، الحد {limit}",
  "mission.budgets.agentSuffix": " ({agent})",
  "mission.budgets.scope": "تنطبق على",
  "mission.budgets.scope.daily": "اليوم كله",
  "mission.budgets.scope.session": "كل جلسة",
  "mission.budgets.metric": "تُقاس بـ",
  "mission.budgets.metric.tokens": "الرموز",
  "mission.budgets.metric.cost": "الدولار الأمريكي",
  "mission.budgets.limit": "الحد",
  "mission.budgets.agent": "الوكيل (اختياري)",
  "mission.budgets.add": "إضافة ميزانية",
  "mission.budgets.remove": "إزالة الميزانية {id}",
  "mission.budgets.invalid": "أدخل حدًا أكبر من صفر.",

  "mission.prices.title": "الأسعار",
  "mission.prices.note":
    "لا يتضمن Phoenix أسعارًا مدمجة. أدخل أسعارك بنفسك، بالدولار الأمريكي لكل مليون رمز، تحت اسم النموذج الذي يبلغ عنه الوكيل.",
  "mission.prices.aiNote": "نماذج لها سعر أيضًا في إعدادات الذكاء الاصطناعي: {models}.",
  "mission.prices.none": "لا توجد أسعار بعد.",
  "mission.prices.model": "النموذج",
  "mission.prices.input": "الإدخال لكل مليون رمز",
  "mission.prices.output": "الإخراج لكل مليون رمز",
  "mission.prices.line": "{model}: {input} دخل، {output} خرج لكل مليون رمز",
  "mission.prices.add": "حفظ السعر",
  "mission.prices.remove": "إزالة سعر {model}",
  "mission.prices.invalid": "أدخل اسم نموذج وسعرين لا يقلان عن صفر.",

  "mission.stall.label": "وسم الجلسة النشطة بأنها عالقة بعد هذا العدد من الدقائق دون تقرير",
  "mission.stall.save": "حفظ",

  "mission.keep.label": "حذف سجلات الاستخدام الأقدم من هذا العدد من الأيام (من 7 إلى 3650)",
  "mission.keep.save": "حفظ",

  "mission.saved": "تم الحفظ",
  "mission.delete.button": "حذف كل استخدام الوكلاء",
  "mission.delete.warning":
    "هل تريد حذف كل أرقام الرموز والتكلفة المخزّنة؟ ستبقى الميزانيات والأسعار. لا يمكن التراجع عن ذلك.",
  "mission.delete.confirm": "نعم، احذف",
  "mission.delete.done":
    "{count, plural, zero {تم حذف # سجلات} one {تم حذف سجل واحد} two {تم حذف سجلين} few {تم حذف # سجلات} many {تم حذف # سجلًا} other {تم حذف # سجل}}",
};
