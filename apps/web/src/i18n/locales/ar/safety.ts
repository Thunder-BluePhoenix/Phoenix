// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { safety as ensafety } from "../../en/safety";

/** Machine-translated; unreviewed (see ../../README.md). */
export const safety: Record<keyof typeof ensafety, string> = {
  "safety.title": "شبكة أمان الوكلاء",
  "safety.intro":
    "قبل أول تعديل يُبلِغ عنه وكيل برمجة في جلسة ما، يحفظ Phoenix لقطة من المشروع في مستودع git الخاص بالمشروع نفسه (مرجع مخفي؛ لا تُمَسّ فروعك ولا الفهرس ولا المخبأ أبدًا). يمكنك إرجاع الملفات إليها بعد المعاينة وموافقتك.",
  "safety.timing":
    "يُبلِغ Claude Code عن الخطوة بعد تشغيل الأداة، لذلك تُؤخذ اللقطة عند أول إبلاغ عن تعديل: وعادةً يكون هذا التعديل الأول موجودًا فيها بالفعل. يتراجع الإرجاع عمّا فعله الوكيل بعدها، لا عن التعديل الأول نفسه.",
  "safety.ignored":
    "الملفات التي يتجاهلها git (مخرجات البناء والسجلات والاعتماديات) لا تُحفظ ولا تُستعاد ولا تُحذف أبدًا.",
  "safety.loadFailed": "تعذّر تحميل شبكة الأمان: {error}",
  "safety.killSwitch": "مفتاح الإيقاف الطارئ مُفعّل، لذلك لا تُؤخذ نقاط حفظ جديدة.",

  "safety.warnings.title": "تحذيرات من Fawkes",
  "safety.warnings.loop": "حلقة",
  "safety.warnings.stall": "متوقف",
  "safety.warnings.line": "{kind} · {agent} في {repository}: {reason}",

  "safety.checkpoints.title": "نقاط الحفظ",
  "safety.checkpoints.none": "لا توجد نقطة حفظ بعد. تُؤخذ واحدة عند الإبلاغ عن أول تعديل لوكيل.",
  "safety.checkpoints.row": "{agent} في {repository}",
  "safety.checkpoints.facts":
    "أُخذت {taken} · {count, plural, zero {# ملف} one {ملف واحد} two {ملفان} few {# ملفات} many {# ملفًا} other {# ملف}} · تُحفظ حتى {expires}",
  "safety.checkpoints.rolledBack": "تم الإرجاع {when}",
  "safety.checkpoints.preview": "معاينة الإرجاع…",
  "safety.checkpoints.previewLabel": "معاينة الإرجاع إلى نقطة حفظ {agent} في {repository}",
  "safety.checkpoints.close": "إغلاق المعاينة",

  "safety.skipped.title": "جلسات بلا نقطة حفظ",
  "safety.skipped.line": "{agent} في {repository}: {reason}",
  "safety.skipped.disabled": "شبكة الأمان متوقفة",
  "safety.skipped.kill_switch": "كان مفتاح الإيقاف الطارئ مُفعّلًا",
  "safety.skipped.not_git": "هذا المجلد ليس مستودع git، فلا شيء يمكن أخذ لقطة منه",
  "safety.skipped.git_unavailable": "تعذّر تشغيل git",
  "safety.skipped.too_many_files": "عدد ملفات المشروع يتجاوز الحد",
  "safety.skipped.too_large": "حجم المشروع يتجاوز الحد المسموح",
  "safety.skipped.throttled": "تم أخذ نقطة حفظ في هذا المشروع خلال الدقيقة الأخيرة",
  "safety.skipped.snapshot_failed": "تعذّر على git أخذ اللقطة",

  "safety.preview.title": "معاينة الإرجاع",
  "safety.preview.counts":
    "{restore, plural, zero {لن يُستعاد أي ملف} one {سيُستعاد ملف واحد} two {سيُستعاد ملفان} few {ستُستعاد # ملفات} many {سيُستعاد # ملفًا} other {سيُستعاد # ملف}}، {remove, plural, zero {ولن يُحذف أي ملف جديد} one {وسيُحذف ملف جديد واحد} two {وسيُحذف ملفان جديدان} few {وستُحذف # ملفات جديدة} many {وسيُحذف # ملفًا جديدًا} other {وسيُحذف # ملف جديد}}، {kept, plural, zero {ولن يُترك أي اختلاف} one {وسيُترك اختلاف واحد} two {وسيُترك اختلافان} few {وستُترك # اختلافات} many {وسيُترك # اختلافًا} other {وسيُترك # اختلاف}} كما هو.",
  "safety.preview.restore": "تُستعاد إلى نقطة الحفظ",
  "safety.preview.remove": "ملفات جديدة ستُحذف",
  "safety.preview.kept": "تُترك كما هي",
  "safety.preview.change.modified": "معدَّل",
  "safety.preview.change.deleted": "حذفه الوكيل",
  "safety.preview.change.type_changed": "تغيّر النوع",
  "safety.preview.why.tracked_by_head": "يتتبعه git، لذلك لا يُحذف",
  "safety.preview.why.ignored": "يتجاهله git",
  "safety.preview.why.submodule": "وحدة فرعية",
  "safety.preview.why.unsafe_path": "مسار غير آمن للمساس به",
  "safety.preview.why.not_a_file": "ليس ملفًا عاديًا",
  "safety.preview.truncated": "القوائم مقتطعة؛ الأعداد أعلاه دقيقة.",
  "safety.preview.diff": "التغييرات منذ نقطة الحفظ",
  "safety.preview.diffTruncated": "اقتُطع الفرق عند حد حجمه.",
  "safety.preview.diffRedacted": "حُجب نص بدا وكأنه سرّ.",
  "safety.preview.diffEmpty": "لا توجد تغييرات نصية لعرضها.",
  "safety.preview.nothing": "الملفات مطابقة لنقطة الحفظ بالفعل. لا شيء للإرجاع.",
  "safety.preview.refusal.repository_missing": "لم يعد المشروع مستودع git هنا.",
  "safety.preview.refusal.checkpoint_gone": "لم تعد اللقطة موجودة في المستودع.",
  "safety.preview.refusal.head_moved":
    "تحرّك HEAD في المستودع منذ نقطة الحفظ (بسبب إيداع أو تبديل فرع). لن يُرجِع Phoenix عبره؛ ولم يتغير أي شيء.",
  "safety.preview.refusal.snapshot_failed": "تعذّر على Git قراءة شجرة العمل.",
  "safety.preview.approvalNote":
    "يطلب الإرجاع موافقتك أولًا. وهو لا يغيّر سجل git ولا الفروع ولا الفهرس ولا المخبأ أبدًا، ويرفض التنفيذ إذا تغيّرت الملفات بعد هذه المعاينة.",

  "safety.rollback.button": "إرجاع…",
  "safety.rollback.waiting": "بانتظار موافقتك في قائمة الموافقات أعلاه…",
  "safety.rollback.done":
    "تم الإرجاع: {restored, plural, zero {لم يُستعد أي ملف} one {استُعيد ملف واحد} two {استُعيد ملفان} few {استُعيدت # ملفات} many {استُعيد # ملفًا} other {استُعيد # ملف}}، {removed, plural, zero {ولم يُحذف أي ملف جديد} one {وحُذف ملف جديد واحد} two {وحُذف ملفان جديدان} few {وحُذفت # ملفات جديدة} many {وحُذف # ملفًا جديدًا} other {وحُذف # ملف جديد}}.",
  "safety.rollback.exact": "الملفات الآن مطابقة لنقطة الحفظ.",
  "safety.rollback.inexact":
    "تُركت بعض الاختلافات كما هي، لذلك لا تطابق الملفات نقطة الحفظ تمامًا.",

  "safety.settings.title": "الإعدادات",
  "safety.settings.enabled": "أخذ نقطة حفظ عند الإبلاغ عن أول تعديل لوكيل",
  "safety.settings.notify": "إرسال إشعار عندما يحذّر Fawkes من حلقة أو توقف",
  "safety.settings.retention": "الاحتفاظ بنقاط الحفظ لمدة (أيام)",
  "safety.settings.maxFiles": "تخطّي المشاريع التي تحتوي على ملفات أكثر من",
  "safety.settings.loopThreshold": "التحذير من حلقة بعد هذا العدد من التكرارات",
  "safety.settings.waitingMin": "التحذير عندما ينتظرك وكيل لمدة (دقائق)",
  "safety.settings.idleMin": "التحذير عندما يصمت وكيل نشط لمدة (دقائق)",
  "safety.settings.saved": "تم الحفظ.",
  "safety.settings.detectNote":
    "لا تُبلِغ الخطافات (hooks) عن رموز الخروج ولا عن محتويات الملفات، لذلك تعني الحلقة تشغيل الأمر نفسه مرارًا وتكرارًا، أو ملفًا تُلغي تعديلاته بعضها بعضًا (بحسب أعداد الأسطر).",
};
