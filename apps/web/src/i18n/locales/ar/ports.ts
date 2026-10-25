// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { ports as enports } from "../../en/ports";

/** Machine-translated; unreviewed (see ../../README.md). */
export const ports: Record<keyof typeof enports, string> = {
  "ports.title": "رادار المنافذ",
  "ports.intro":
    "يعرض أي البرامج تستمع إلى منافذ الشبكة على هذا الحاسوب، وفي أي مشروع تعمل، ومنذ متى. الفحص للقراءة فقط؛ لا يتغير شيء ما لم توقف برنامجًا وتوافق على ذلك.",
  "ports.disabled": "رادار المنافذ متوقف. فعّل قدرة رادار المنافذ والعمليات لاستخدامه.",
  "ports.scan": "افحص الآن",
  "ports.scanning": "جارٍ الفحص…",
  "ports.notScanned": "لم يتم فحص أي شيء بعد. اختر افحص الآن.",
  "ports.empty": "لا يوجد برنامج يستمع إلى منفذ.",
  "ports.loadError": "تعذرت قراءة المنافذ.",
  "ports.scannedAt": "وقت الفحص: {time}",
  "ports.count":
    "{count, plural, zero {لا منافذ مستمعة} one {منفذ مستمع واحد} two {منفذان مستمعان} few {# منافذ مستمعة} many {# منفذًا مستمعًا} other {# منفذ مستمع}}",
  "ports.table.caption": "المنافذ المستمعة",
  "ports.col.port": "المنفذ",
  "ports.col.process": "البرنامج",
  "ports.col.project": "المشروع",
  "ports.col.age": "يعمل منذ",
  "ports.col.notes": "ملاحظات",
  "ports.col.actions": "الإجراءات",
  "ports.pid": "العملية {pid}",
  "ports.age.unknown": "غير معروف",
  "ports.age.minutes":
    "{count, plural, zero {# دقيقة} one {دقيقة} two {دقيقتان} few {# دقائق} many {# دقيقة} other {# دقيقة}}",
  "ports.age.hours":
    "{count, plural, zero {# ساعة} one {ساعة} two {ساعتان} few {# ساعات} many {# ساعة} other {# ساعة}}",
  "ports.age.days":
    "{count, plural, zero {# يوم} one {يوم} two {يومان} few {# أيام} many {# يومًا} other {# يوم}}",
  "ports.project.none": "بلا مشروع",
  "ports.exposure.all": "يمكن الوصول إليه من الشبكة",
  "ports.exposure.loopback": "هذا الحاسوب فقط",
  "ports.exposure.interface": "عنوان شبكة واحد",
  "ports.flag.forgotten": "ربما منسي",
  "ports.flag.heavy": "ثقيل",
  "ports.flag.core": "Phoenix نفسه",
  "ports.usage": "المعالج {percent}٪، الذاكرة {mb} ميغابايت",
  "ports.help.forgotten":
    "ربما منسي: يعمل في مجلد مشروع ومضى على تشغيله أكثر من {hours, plural, zero {# ساعة} one {ساعة} two {ساعتين} few {# ساعات} many {# ساعة} other {# ساعة}}. لا يستطيع Phoenix معرفة ما إذا كان أحد لا يزال يستخدمه.",
  "ports.help.heavy":
    "ثقيل: معالج بنسبة {cpu}٪ أو أكثر، أو ذاكرة بحجم {mb} ميغابايت أو أكثر، كما يبلغ عنها ps (متوسط وليس قراءة مباشرة).",
  "ports.open": "افتح في المتصفح",
  "ports.open.label": "افتح {name} على المنفذ {port} في متصفحك الافتراضي",
  "ports.openPhoenix": "افتح في متصفح Phoenix",
  "ports.openPhoenix.label": "افتح {name} على المنفذ {port} في متصفح Phoenix (يطلب تأكيدك أولًا)",
  "ports.openNote":
    "«افتح في المتصفح» يفتح http://127.0.0.1 في متصفحك الافتراضي. «افتح في متصفح Phoenix» يمرّر العنوان المحلي نفسه إلى تطبيق Phoenix لسطح المكتب (macOS فقط)، ويطلب متصفحه تأكيدك قبل فتح أي شيء. إذا لم يكن التطبيق مثبتًا، استخدم الرابط العادي.",
  "ports.stop": "إيقاف…",
  "ports.stop.label": "إيقاف {name} على المنفذ {port}",
  "ports.refusal.self": "هذا هو Phoenix نفسه، وهو لا يوقف نفسه أبدًا.",
  "ports.refusal.other_user": "يخص مستخدمًا آخر.",
  "ports.refusal.system": "إنها عملية نظام.",
  "ports.refusal.not_dev_tool": "ليست أداة تطوير يجوز لـ Phoenix إيقافها.",
  "ports.refusal.unsupported": "الإيقاف غير متاح على هذا النظام.",
  "ports.refusal.unknown": "تعذر على Phoenix فحص هذه العملية، لذلك لن يوقفها.",
  "ports.confirm.title": "هل تريد إيقاف {name} على المنفذ {port}؟",
  "ports.confirm.body":
    "بعد موافقتك، سيطلب Phoenix من {name} (العملية {pid}) الإغلاق. قد يفقد البرنامج عملًا غير محفوظ.",
  "ports.confirm.go": "اطلب الإيقاف",
  "ports.confirm.cancel": "إلغاء",
  "ports.stop.waiting": "بانتظار موافقتك في الموافقات…",
  "ports.stop.exited": "تم إيقاف {name}.",
  "ports.stop.stillRunning":
    "طُلب من {name} الإغلاق وما زال يعمل. الإيقاف القسري ينهيه فورًا ولا يمكن التراجع عنه وقد يفقد بيانات.",
  "ports.force": "إيقاف قسري…",
  "ports.force.label": "إيقاف {name} قسريًا على المنفذ {port}",
  "ports.force.hint": "يرفض Phoenix الإيقاف القسري في الثواني الأولى بعد طلب الإغلاق.",
  "ports.force.confirm": "إيقاف قسري",
  "ports.restart": "إعادة التشغيل…",
  "ports.restart.label": "إعادة تشغيل {name} على المنفذ {port}",
  "ports.restart.title": "إعادة تشغيل {name} على المنفذ {port}؟",
  "ports.restart.body":
    "بعد موافقتك، يطلب Phoenix من {name} (العملية {pid}) الإنهاء، ولا يشغّل وصفة إعادة التشغيل التي أعددتها، كما هي معروضة أدناه، إلا إذا انتهى البرنامج. قد يفقد البرنامج عملًا غير محفوظ. إذا فشل التشغيل يبقى البرنامج متوقفًا.",
  "ports.restart.recipe": "الوصفة",
  "ports.restart.argv": "البرنامج والوسائط",
  "ports.restart.cwd": "المجلد",
  "ports.restart.go": "اطلب إعادة التشغيل",
  "ports.restart.started":
    "تم إيقاف {name} وبدأت الوصفة {recipe} (العملية {pid}). لا يستطيع Phoenix معرفة ما إذا كان يستمع من جديد؛ افحص مرة أخرى.",
  "ports.restart.note":
    "تُعرض إعادة التشغيل فقط لبرنامج على منفذ كتبتَ له وصفة إعادة تشغيل في إعدادات هذه القدرة. لا يعيد Phoenix بناء أمر من برنامج قيد التشغيل أبدًا.",
  "ports.watch.label": "التحديث تلقائيًا أثناء فتح Phoenix",
  "ports.watch.help":
    "متوقف افتراضيًا. عند التفعيل يقرأ Phoenix قائمة المنافذ كل 15 ثانية، وفقط أثناء فتح نافذة من Phoenix.",
  "ports.noProcessTable": "تعذرت قراءة قائمة العمليات، لذلك لا تتوفر مدد التشغيل ولا الإيقاف.",
  "ports.parseWarnings":
    "لم يتم فهم بعض أسطر قائمة العمليات أو المنافذ في النظام وتم تجاهلها (قد يحتوي اسم البرنامج على أسطر جديدة). قد تتأثر برامج مفقودة أو لا يمكن إيقافها هنا؛ ويعيد الإيقاف فحص كل شيء مرة أخرى.",
  "ports.windows.note":
    "على Windows يعرض الرادار المنافذ وأسماء البرامج فقط؛ لا تتوفر مدد التشغيل ولا المشاريع ولا الإيقاف.",
};
