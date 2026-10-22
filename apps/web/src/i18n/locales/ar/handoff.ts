// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { handoff as enhandoff } from "../../en/handoff";

/** Machine-translated; unreviewed (see ../../README.md). */
export const handoff: Record<keyof typeof enhandoff, string> = {
  "handoff.title": "ملاحظات التسليم",
  "handoff.intro":
    "ملاحظة التسليم ملخص قصير يبنيه Phoenix بقواعد ثابتة ودون أي نموذج، من الأمور التي أبلغ عنها وكيل البرمجة أثناء الجلسة: الهدف (فقط عندما أبلغ الوكيل عن عنوان مهمة)، والملفات التي غيّرها مع عدد الأسطر، والأوامر التي نفّذها (بعد إزالة الأسرار)، والأسئلة المفتوحة. لم يتحقق Phoenix من أي شيء من ذلك، فاعتبره كلام الوكيل لا دليلًا. تُحفظ الملاحظات على هذا الحاسوب في مجلد بيانات Phoenix ولا يقرؤها غيرك؛ تُحفظ أحدث 50 ملاحظة، وتحذفها «حذف الكل» الخاصة بـ«handoff» في الخصوصية.",

  "handoff.settings.legend": "إعدادات التسليم",
  "handoff.settings.auto": "اكتب ملاحظة عند انتهاء جلسة الوكيل",
  "handoff.settings.allowCloud":
    "السماح لنموذج سحابي بكتابة الملخص الاختياري (معطّل: نموذج على هذا الجهاز فقط)",
  "handoff.settings.cloudWarning":
    "إذا فعّلت هذا الخيار، فقد يغادر نص الملاحظة (الأوامر المنقّحة وأسماء الملفات) هذا الحاسوب إلى نموذج سحابي عندما تطلب ملخصًا. وتظل أذونات السحابة في إعدادات الذكاء الاصطناعي سارية فوق هذا الاختيار.",
  "handoff.settings.saved": "حُفظت الإعدادات.",
  "handoff.settings.unavailable": "تعذّر تحميل إعدادات التسليم.",
  "handoff.notes.unavailable": "تعذّر تحميل ملاحظات التسليم.",
  "handoff.guard.unavailable": "تعذّر تحميل نتائج حارس الأسرار.",
  "handoff.notes.title": "الملاحظات المحفوظة",
  "handoff.notes.listLabel": "ملاحظات التسليم",
  "handoff.notes.empty": "لم تُكتب أي ملاحظة تسليم بعد.",
  "handoff.notes.open": "{date} {time} · {agent}",
  "handoff.notes.meta": "{project} · {files} · {lines}",
  "handoff.notes.files":
    "{count, plural, zero {لا ملفات} one {ملف واحد} two {ملفان} few {# ملفات} many {# ملفًا} other {# ملف}}",
  "handoff.notes.lines": "+{added} −{removed}",
  "handoff.notes.noProject": "بلا مشروع",
  "handoff.notes.hasSummary": "ملخص النموذج",
  "handoff.notes.detailLabel": "الملاحظة المحددة",
  "handoff.notes.loading": "جارٍ تحميل الملاحظة…",
  "handoff.notes.trigger.auto": "كُتبت تلقائيًا",
  "handoff.notes.trigger.user": "طلبتَها أنت",
  "handoff.notes.textLabel": "نص الملاحظة",

  "handoff.summary.title": "ملخص النموذج",
  "handoff.summary.processedBy": "كتبه: {by}",
  "handoff.summary.warning": "كتب نموذجٌ هذا الملخص وقد يكون خاطئًا. راجعه قبل أن تعتمد عليه.",
  "handoff.summary.add": "إضافة ملخص من نموذج",
  "handoff.summary.note":
    "لا يستخدم Phoenix إلا نموذجًا على هذا الجهاز، ما لم تسمح بنموذج سحابي أعلاه.",
  "handoff.summary.added": "أُضيف الملخص.",

  "handoff.delete.button": "حذف الملاحظة",
  "handoff.delete.done": "حُذفت الملاحظة.",

  "handoff.generate.title": "اكتب ملاحظة لجلسة",
  "handoff.generate.sessionLabel": "الجلسة",
  "handoff.generate.choose": "اختر جلسة",
  "handoff.generate.option": "{agent} · {repository} · {time}",
  "handoff.generate.none": "لا توجد جلسة وكيل برمجة معروفة بعد، لذا لا شيء يمكن كتابة ملاحظة عنه.",
  "handoff.generate.button": "اكتب ملاحظة",
  "handoff.generate.done": "كُتبت الملاحظة.",

  "handoff.attach.title": "استخدام هذه الملاحظة",
  "handoff.attach.targetLabel": "إلى أين تذهب",
  "handoff.attach.target.commit_message": "رسالة commit",
  "handoff.attach.target.pr_description": "وصف طلب سحب",
  "handoff.attach.target.task": "مشكلة (issue) على GitHub",
  "handoff.attach.repositoryLabel": "مستودع GitHub (owner/name)",
  "handoff.attach.repositoryInvalid": "أدخل المستودع بصيغة owner/name، مثل acme/app.",
  "handoff.attach.preview": "معاينة",
  "handoff.attach.previewAgain": "عاين مرة أخرى",
  "handoff.attach.confirm": "تأكيد",
  "handoff.attach.previewLabel": "معاينة ما سيُرفق",
  "handoff.attach.issueTitle": "عنوان المشكلة: {title}",
  "handoff.attach.textLabel": "هذا النص بالضبط",
  "handoff.attach.delivery.copy": "لا يكتب Phoenix هذا في أي مكان: أكّد لنسخه، ثم الصقه بنفسك.",
  "handoff.attach.delivery.copyPr":
    "ليس لدى Phoenix بعد أمر يعدّل وصف طلب السحب: نسخ فقط. أكّد لنسخه، ثم الصقه بنفسك.",
  "handoff.attach.delivery.issue":
    "سينشئ Phoenix مشكلة على GitHub في {repository} عبر قدرة github. ستُطلب منك مرة أخرى موافقة إضافية، ويحتاج إلى رمز الكتابة.",
  "handoff.attach.stale": "تغيّرت الملاحظة بعد هذه المعاينة، لذا لم يُرفق شيء. عاين مرة أخرى.",
  "handoff.attach.copied": "نُسخ إلى الحافظة. الصقه حيث تحتاج إليه.",
  "handoff.attach.copyByHand": "تعذّر على Phoenix استخدام الحافظة. حدّد النص أدناه وانسخه يدويًا.",
  "handoff.attach.issueCreated": "أُنشئت المشكلة #{number} في {repository}.",
  "handoff.attach.issueExisting": "المشكلة #{number} في {repository} موجودة مسبقًا.",
  "handoff.attach.issueAddress": "العنوان: {url}",

  "handoff.guard.title": "حارس الأسرار",
  "handoff.guard.intro":
    "يُثبَّت حارس الأسرار مع مثبّت خطافات الوكلاء أعلاه: فهو جزء من الخطافات التي يضيفها Phoenix إلى Claude Code وCodex. يحظر استدعاء أداة أو git commit أو git push إذا احتوى مدخله أو تغييراته المجهّزة على سرّ يتعرف عليه كاشف Phoenix، ويخبر الوكيل بنوع السر ومكانه، ولا يخبره بالسر نفسه أبدًا.",
  "handoff.guard.override": "يمكنك تجاوز حظر واحد فقط عبر بطاقة موافقة؛ ولا يستطيع الوكيل تجاوزه.",
  "handoff.guard.heuristic":
    "الكاشف استدلالي وليس وعدًا بألا يتسرب شيء: السر الذي لا يتعرف عليه لا يُكتشف.",
  "handoff.guard.failOpen":
    "إذا تعذّر تشغيل Phoenix Core أو الخطاف، يستمر عمل الوكيل (يفشل الحارس مفتوحًا)، إلا أن السر الذي يُعثر عليه يُحظر دائمًا.",
  "handoff.guard.countsLabel": "نتائج حارس الأسرار",
  "handoff.guard.allowed": "المسموح بعد الفحص: {count}",
  "handoff.guard.blocked": "المحظور: {count}",
  "handoff.guard.overridden": "المسموح بعد موافقتك: {count}",
  "handoff.guard.since": "محسوب منذ {date} {time}",
  "handoff.guard.noResults": "لا نتائج بعد.",
  "handoff.guard.recentLabel": "أحدث نتائج حارس الأسرار",
  "handoff.guard.row": "{date} {time} · {agent} · {tool}",
  "handoff.guard.outcome.blocked": "محظور",
  "handoff.guard.outcome.overridden": "مسموح بعد موافقتك",
  "handoff.guard.finding": "{kind} في {location}",
};
