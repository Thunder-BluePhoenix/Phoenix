// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { automation as enAutomation } from "../../en/automation";

/** Machine-translated; unreviewed (see ../../README.md). */
export const automation: Record<keyof typeof enAutomation, string> = {
  // ---- workflows: tables and checks (core/workflows.ts) ----
  "automation.workflows.environment.local": "محلي",
  "automation.workflows.environment.dev": "التطوير",
  "automation.workflows.environment.staging": "المرحلة التجريبية",
  "automation.workflows.environment.production": "الإنتاج",
  "automation.workflows.environment.productionLive": "الإنتاج (يغيّر أنظمة فعلية)",

  "automation.workflows.runStatus.queued": "في قائمة الانتظار",
  "automation.workflows.runStatus.running": "قيد التشغيل",
  "automation.workflows.runStatus.waiting_approval": "بانتظار موافقتك",
  "automation.workflows.runStatus.compensating": "جارٍ التراجع عن الخطوات السابقة",
  "automation.workflows.runStatus.succeeded": "نجح",
  "automation.workflows.runStatus.rejected": "رفضتَه أنت",
  "automation.workflows.runStatus.failed": "فشل",
  "automation.workflows.runStatus.failed_needs_attention": "فشل: يحتاج إلى انتباهك",
  "automation.workflows.runStatus.cancelled": "أُلغي",
  "automation.workflows.runStatus.interrupted": "تعطّل (أُعيد تشغيل Phoenix)",
  "automation.workflows.runStatus.refused": "رُفض: لم يكن مسموحًا بتشغيله",

  "automation.workflows.stepStatus.running": "قيد التشغيل",
  "automation.workflows.stepStatus.waiting": "في الانتظار",
  "automation.workflows.stepStatus.succeeded": "نجحت",
  "automation.workflows.stepStatus.failed": "فشلت",
  "automation.workflows.stepStatus.timed_out": "انتهت المهلة (النتيجة غير معروفة)",
  "automation.workflows.stepStatus.rejected": "مرفوضة",
  "automation.workflows.stepStatus.expired": "منتهية الصلاحية",
  "automation.workflows.stepStatus.unknown": "النتيجة غير معروفة",

  "automation.workflows.authorisation.notNeeded": "لا يحتاج إلى تفويض",
  "automation.workflows.authorisation.authorised": "مفوَّض للإنتاج",
  "automation.workflows.authorisation.notAuthorised": "غير مفوَّض: تُرفض المشغِّلات",

  "automation.workflows.expiry.invalid": "هذه ليست قيمة تاريخ ووقت صالحة.",
  "automation.workflows.expiry.past": "يجب أن يكون تاريخ الانتهاء في المستقبل.",
  "automation.workflows.expiry.tooFar": "أقصى مدة لتاريخ الانتهاء هي {days} يومًا من الآن.",
  "automation.workflows.refused.noReason": "لم يُذكر سبب.",
  "automation.workflows.payload.invalidJson": "الحمولة ليست JSON صالحًا.",
  "automation.workflows.payload.notObject": "يجب أن تكون الحمولة كائن JSON، مثل '{}'.",
  "automation.workflows.payload.tooMany": "الحد الأقصى لعدد المفاتيح في الحمولة: {max}.",

  // ---- workflows: the list ----
  "automation.workflows.title": "مسارات العمل",
  "automation.workflows.intro":
    "يستجيب مسار العمل لحدث ما عبر قائمة ثابتة من الخطوات. لا يفعل مسار العمل الذي يغيّر الإنتاج شيئًا إلى أن تفوّض بالضبط التعريف الذي راجعته.",
  "automation.workflows.empty": "لا توجد مسارات عمل بعد. أنشئ واحدًا بمراجعة تعريف أدناه.",
  "automation.workflows.row.runsWhen": "يعمل عند حدوث {event} · الإصدار {version}",
  "automation.workflows.row.cannotRun": "لا يمكن تشغيله: {problems}",
  "automation.workflows.row.metrics": "{started} تشغيل، نجح منها {succeeded}",

  // ---- workflows: the numbers of one workflow ----
  "automation.workflows.metrics.title": "الأرقام",
  "automation.workflows.metrics.label": "المقاييس",
  "automation.workflows.metrics.none": "لم يُشغَّل مسار العمل هذا بعد، لذا لا توجد أرقام.",
  "automation.workflows.metrics.started": "عمليات التشغيل المبدوءة",
  "automation.workflows.metrics.succeeded": "الناجحة",
  "automation.workflows.metrics.failed": "الفاشلة",
  "automation.workflows.metrics.attention": "تحتاج إلى انتباهك",
  "automation.workflows.metrics.cancelled": "الملغاة",
  "automation.workflows.metrics.refused": "المرفوضة",
  "automation.workflows.metrics.interrupted": "المتعطلة",
  "automation.workflows.metrics.stepsFailed": "الخطوات الفاشلة",
  "automation.workflows.metrics.stepsFailedValue": "{count} ({percent}% من الخطوات)",
  "automation.workflows.metrics.approvalsWaiting": "الموافقات المنتظرة",
  "automation.workflows.metrics.approvalsOutcome": "الموافقات المقبولة / المرفوضة / المنتهية",
  "automation.workflows.metrics.approvalsOutcomeValue": "{approved} / {rejected} / {expired}",
  "automation.workflows.metrics.runTime": "زمن التشغيل (الوسيط / المئين التسعين)",
  "automation.workflows.metrics.runTimeValue":
    "{median} ms / {p90} ms على مدى {samples, plural, zero {# عملية تشغيل} one {عملية تشغيل واحدة} two {عمليتي تشغيل} few {# عمليات تشغيل} many {# عملية تشغيل} other {# عملية تشغيل}}",
  "automation.workflows.metrics.noFinishedRuns": "لا توجد عمليات تشغيل منتهية",

  // ---- workflows: the definition editor ----
  "automation.workflows.editor.titleEdit": "تعديل التعريف",
  "automation.workflows.editor.titleCreate": "إنشاء مسار عمل",
  "automation.workflows.editor.introExisting":
    'أدخل تعريف JSON الكامل. أبقِ "enabled": {enabled}؛ يحافظ هذا التعديل على حالة المفتاح الحالية. الحفظ لا يفوّضه ولا يشغّله. الفحص لا يحفظ أبدًا.',
  "automation.workflows.editor.introNew":
    'أدخل تعريف JSON الكامل. يجب أن تحمل التعريفات الجديدة "enabled": false. الحفظ لا يشغّلها ولا يفعّلها ولا يفوّضها. الفحص لا يحفظ أبدًا.',
  "automation.workflows.editor.label": "تعريف مسار العمل (JSON)",
  "automation.workflows.editor.check": "فحص المسودة",
  "automation.workflows.editor.enterJson": "أدخل تعريف مسار عمل بصيغة JSON قبل فحصه.",
  "automation.workflows.editor.notObject": "يجب أن يكون تعريف مسار العمل كائن JSON.",
  "automation.workflows.editor.keepEnabled":
    'أبقِ "enabled": {enabled}. غيّر المفتاح بشكل منفصل بعد الحفظ.',
  "automation.workflows.editor.setDisabled":
    'عيّن "enabled": false. يجب ألا يؤدي حفظ تعريف جديد إلى تشغيله.',
  "automation.workflows.editor.keepId":
    "يجب أن يحافظ التعديل على معرّف مسار العمل نفسه. استخدم «إنشاء مسار عمل» للحصول على معرّف جديد.",
  "automation.workflows.editor.notValid": "غير صالح: {problems}",
  "automation.workflows.editor.noHash": "لم يُرجع التحقق تجزئة تعريف صالحة.",
  "automation.workflows.editor.hashDiffers":
    "تجزئة التعريف المحفوظ تختلف عن التجزئة التي روجعت. راجع التعريف المخزَّن قبل استخدامه.",
  "automation.workflows.editor.savedExisting":
    "حُفظ التعريف. حالة المفتاح الحالية لم تتغير؛ الحفظ لا يفوّضه.",
  "automation.workflows.editor.savedNew": "حُفظ التعريف وهو متوقف. الحفظ لا يفوّضه ولا يفعّله.",
  "automation.workflows.editor.reviewed": "التعريف الذي روجع",
  "automation.workflows.editor.validLead": "مسودة صالحة.",
  "automation.workflows.editor.valid":
    "{lead} راجع هذا التعريف والتجزئة بالضبط قبل الحفظ. أي تغيير يتطلب فحصًا آخر.",
  "automation.workflows.editor.toSave": "التعريف المراد حفظه",
  "automation.workflows.editor.hash": "التجزئة المتحقق منها: {hash}",
  "automation.workflows.editor.authRequired": "التفويض مطلوب بشكل منفصل: {reasons}",
  "automation.workflows.editor.authNotRequired": "لا يلزم تفويض.",
  "automation.workflows.editor.switchOn": "الحفظ لا يفوّض أبدًا؛ يبقى المفتاح قيد التشغيل.",
  "automation.workflows.editor.switchOff": "الحفظ لا يفوّض أبدًا؛ يبقى المفتاح متوقفًا.",
  "automation.workflows.editor.switchNew": "الحفظ لا يفوّض أبدًا؛ يبقى مسار العمل الجديد متوقفًا.",
  "automation.workflows.editor.confirm": "تأكيد: احفظ هذا التعريف بالضبط",
  "automation.workflows.editor.reviewStored": "مراجعة مسار العمل المخزَّن",

  // ---- workflows: checking the stored definition ----
  "automation.workflows.validate.button": "فحص التعريف",
  "automation.workflows.validate.dryRun": "تشغيل تجريبي. لا يُحفظ شيء ولا يُشغَّل شيء.",
  "automation.workflows.validate.validLead": "صالح.",
  "automation.workflows.validate.valid": "{lead} التجزئة {hash}. {authorisation}",
  "automation.workflows.validate.needsAuth": "يحتاج إلى تفويضك: {reasons}.",
  "automation.workflows.validate.noAuth": "لا يحتاج إلى تفويض.",
  "automation.workflows.validate.invalidLead": "غير صالح.",
  "automation.workflows.validate.invalid":
    "{lead} {count, plural, zero {# مشكلة:} one {مشكلة واحدة:} two {مشكلتان:} few {# مشكلات:} many {# مشكلة:} other {# مشكلة:}}",
  "automation.workflows.validate.problems": "المشكلات",

  // ---- workflows: authorising ----
  "automation.workflows.authorise.title": "التفويض للإنتاج",
  "automation.workflows.authorise.notNeeded": "لا يحتاج مسار العمل هذا إلى تفويض.",
  "automation.workflows.authorise.why": "سبب حاجته إلى تفويضك:",
  "automation.workflows.authorise.reasons": "الأسباب",
  "automation.workflows.authorise.intro":
    "سيسمح هذا بتشغيل مسار العمل {name} كلما حدث {event}، دون أي سؤال إضافي بشأن هذه الخطوات ما لم يطلب مسار العمل ذلك:",
  "automation.workflows.authorise.allowed": "ما سيُسمح بتشغيله",
  "automation.workflows.authorise.noTools": "لا يستدعي أي أداة.",
  "automation.workflows.authorise.step": "الخطوة {step} تستدعي {tool}",
  "automation.workflows.authorise.stepUndo": "الخطوة {step} تستدعي {tool} (التراجع: {undo})",
  "automation.workflows.authorise.being": "التعريف قيد التفويض: الإصدار {version}، التجزئة {hash}",
  "automation.workflows.authorise.expires": "تنتهي الصلاحية {hint}",
  "automation.workflows.authorise.expiresHint": "(اختياري، خلال {days} يومًا)",
  "automation.workflows.authorise.submit": "فوّض هذا التعريف بالضبط",
  "automation.workflows.authorise.done":
    "فُوِّض الإصدار {version}. أي تغيير لاحق في التعريف يُنهي هذا التفويض.",

  // ---- workflows: run now ----
  "automation.workflows.runNow.title": "التشغيل الآن",
  "automation.workflows.runNow.intro":
    "يبدأ مسار العمل يدويًا بنفس الفحوص التي تُجرى عند حدوث حدثه: أن يكون مفعّلًا، وغير موقوف بالإيقاف الطارئ، وصالحًا، ومفوَّضًا إذا كان يغيّر الإنتاج.",
  "automation.workflows.runNow.payload": "البيانات التي كان الحدث سيحملها {hint}",
  "automation.workflows.runNow.payloadHint": "(كائن JSON، اختياري)",
  "automation.workflows.runNow.button": "التشغيل الآن",
  "automation.workflows.runNow.cannotRun": "لا يمكن تشغيله: {problems}",
  "automation.workflows.runNow.enableFirst": "فعّل مسار العمل لتشغيله.",
  "automation.workflows.runNow.refusedLead": "رُفض البدء.",
  "automation.workflows.runNow.seeRefused": "عرض التشغيل المرفوض",
  "automation.workflows.runNow.started": "بدأ التشغيل. {link}",
  "automation.workflows.runNow.follow": "تابع التشغيل",

  // ---- workflows: one workflow ----
  "automation.workflows.detail.all": "كل مسارات العمل",
  "automation.workflows.detail.backAll": "← كل مسارات العمل",
  "automation.workflows.detail.productionLead": "الإنتاج.",
  "automation.workflows.detail.production":
    "{lead} يمكن لمسار العمل هذا تغيير أنظمة فعلية. لا يعمل إلا ما دام تعريفه بالضبط مفوَّضًا من جانبك.",
  "automation.workflows.detail.cannotRunNow": "لا يمكن تشغيله الآن:",
  "automation.workflows.detail.definition": "التعريف",
  "automation.workflows.detail.versionHash": "الإصدار {version} · التجزئة {hash}",
  "automation.workflows.detail.runsWhen": "يعمل عند حدوث {event}.",
  "automation.workflows.detail.runsWhenAnd": "يعمل عند حدوث {event} وعندما {condition}.",
  "automation.workflows.detail.tools": "الأدوات التي يمكنه استدعاؤها",
  "automation.workflows.detail.toolsLabel": "الأدوات",
  "automation.workflows.detail.none": "لا شيء.",
  "automation.workflows.detail.toolStep": "الخطوة {step}: {tool}",
  "automation.workflows.detail.flagged": "إجراء إنتاجي أو حرج",
  "automation.workflows.detail.declaredUndo": "التراجع المعلن: {undo}",
  "automation.workflows.detail.definitionText": "التعريف (نص للقراءة فقط، قابل للتمرير)",
  "automation.workflows.detail.unreadable": "تعذّرت قراءة التعريف المخزَّن.",
  "automation.workflows.detail.switch": "المفتاح",
  "automation.workflows.detail.enable": "تفعيل",
  "automation.workflows.detail.disable": "تعطيل",
  "automation.workflows.detail.switchNote":
    "التفعيل لا يفوّض. أي مسار عمل إنتاجي مفعّل وغير مفوَّض يسجّل كل مشغِّل على أنه مرفوض.",
  "automation.workflows.detail.authorisations": "التفويضات",
  "automation.workflows.detail.noneYet": "لا شيء بعد.",
  "automation.workflows.detail.inForce": "ساري",
  "automation.workflows.detail.revoked": "ملغى",
  "automation.workflows.detail.notInForce": "غير ساري",
  "automation.workflows.detail.authorisedBy": "بواسطة {by} في {date}",
  "automation.workflows.detail.authExpires": "تنتهي في {date}",
  "automation.workflows.detail.authChanged": "تغيّر التعريف أو انتهت الصلاحية",
  "automation.workflows.detail.forHash": "للتجزئة {hash}",
  "automation.workflows.detail.confirmRevoke": "تأكيد: إلغاء التفويض",
  "automation.workflows.detail.revoke": "إلغاء التفويض…",
  "automation.workflows.detail.revokeNote": "تتوقف عمليات التشغيل الجارية عند خطوتها التالية.",
  "automation.workflows.detail.recentRuns": "عمليات التشغيل الأخيرة",
  "automation.workflows.detail.noRuns": "لا توجد عمليات تشغيل بعد.",

  // ---- workflows: runs and steps ----
  "automation.workflows.run.needsLook": "(يحتاج إلى نظرة)",
  "automation.workflows.run.notSuccess": "(لم ينجح)",
  "automation.workflows.run.nowAtStep": "عند الخطوة {step} الآن",
  "automation.workflows.run.atStep": "عند الخطوة {step}",
  "automation.workflows.run.backToWorkflow": "العودة إلى مسار العمل",
  "automation.workflows.run.title": "تشغيل {name}",
  "automation.workflows.run.created": "أُنشئ {date}",
  "automation.workflows.run.finished": "انتهى {date}",
  "automation.workflows.run.chainDepth": "عمق السلسلة {depth}",
  "automation.workflows.run.waitingForYou": "بانتظارك",
  "automation.workflows.run.stop": "إيقاف هذا التشغيل",
  "automation.workflows.run.confirmCancel": "تأكيد: إلغاء هذا التشغيل",
  "automation.workflows.run.keepRunning": "متابعة التشغيل",
  "automation.workflows.run.cancel": "إلغاء هذا التشغيل…",
  "automation.workflows.run.cancelNote":
    "الإلغاء لا ينفّذ خطوات التراجع المعلنة. قد تنتهي خطوة قيد التنفيذ بالفعل.",
  "automation.workflows.run.trigger": "ما الذي بدأه",
  "automation.workflows.run.triggerText": "المشغِّل (نص عادي، قابل للتمرير)",
  "automation.workflows.run.stepsHeading": "الخطوات ({count})",
  "automation.workflows.run.stepsLabel": "الخطوات",
  "automation.workflows.run.noSteps": "لم تبدأ أي خطوة.",
  "automation.workflows.step.undo": "التراجع: {step}",
  "automation.workflows.step.attempts":
    "{count, plural, zero {# محاولة} one {محاولة واحدة} two {محاولتان} few {# محاولات} many {# محاولة} other {# محاولة}}",
  "automation.workflows.step.changesState": "يغيّر الحالة",
  "automation.workflows.step.destructive": "{lead}: يمكن لهذه الخطوة تغيير نظام فعلي.",
  "automation.workflows.step.tool": "الأداة {tool}",
  "automation.workflows.step.input": "مدخلات الخطوة {step} (نص عادي، قابل للتمرير)",
  "automation.workflows.step.output": "مخرجات الخطوة {step} (نص عادي، قابل للتمرير)",

  // ---- plans: tables and checks (core/plans.ts) ----
  "automation.plans.status.draft": "مسودة: لم تُقترح بعد",
  "automation.plans.status.proposed": "مقترحة: بانتظار موافقتك",
  "automation.plans.status.approved": "موافَق عليها: جاهزة للإنشاء",
  "automation.plans.status.creating": "جارٍ إنشاء المهام…",
  "automation.plans.status.created": "أُنشئت",
  "automation.plans.status.failed": "فشلت: لم تُنشأ بعض المهام",
  "automation.plans.status.cancelled": "أُلغيت",
  "automation.plans.basis.meeting": "من الاجتماع",
  "automation.plans.basis.suggested": "اقترحه النموذج",
  "automation.plans.basis.user": "كتبتَه أنت",
  "automation.plans.run.pending": "لم تبدأ",
  "automation.plans.run.attempting": "قيد التنفيذ",
  "automation.plans.run.created": "أُنشئت",
  "automation.plans.run.failed": "فشلت",
  "automation.plans.tool.githubIssue": "إنشاء بلاغ على GitHub",
  "automation.plans.tool.frappeTask": "إنشاء مهمة في Frappe",
  "automation.plans.kind.decision": "قرار",
  "automation.plans.kind.action_item": "بند إجراء",
  "automation.plans.kind.requirement": "متطلب",
  "automation.plans.authorship.rules":
    "مسودة قائمة على القواعد: لم يكتبها أي ذكاء اصطناعي، بل تعيد صياغة بند الاجتماع فقط.",
  "automation.plans.authorship.model": "مخرجات النموذج ({model}): قارنها بالاجتماع قبل الموافقة.",
  "automation.plans.destination.github": "مستودع GitHub {repository}",
  "automation.plans.destination.frappe": "موقع Frappe {site}",
  "automation.plans.problem.repository": 'يجب أن يكون المستودع بصيغة "owner/name".',
  "automation.plans.problem.site": "هذا ليس اسم موقع Frappe صالحًا.",
  "automation.plans.problem.titleEmpty": "لا يمكن أن يكون العنوان فارغًا.",
  "automation.plans.problem.titleLong": "العنوان أطول من {max}.",
  "automation.plans.problem.summaryEmpty": "لا يمكن أن يكون الملخص فارغًا.",
  "automation.plans.problem.summaryLong": "الملخص أطول من {max}.",
  "automation.plans.problem.taskCount": "عدد المهام في الخطة يجب أن يكون بين 1 و{max}.",
  "automation.plans.problem.taskTitle": "المهمة {n} تحتاج إلى عنوان.",
  "automation.plans.problem.bodyLong": "النص أطول من {max}.",
  "automation.plans.problem.labelCount": "الحد الأقصى للتسميات: {max}.",
  "automation.plans.problem.labelLong": "إحدى التسميات أطول من {max}.",

  // ---- plans: make a plan from a meeting item ----
  "automation.plans.off": "التخطيط متوقف.",
  "automation.plans.make.open": "إنشاء خطة…",
  "automation.plans.make.openFrom": "إنشاء خطة من {kind}: {text}",
  "automation.plans.make.intro":
    "الخطة مسودة لمهام هندسية. لا يُنشأ شيء إلى أن توافق عليها وتؤكد كل مهمة.",
  "automation.plans.make.where": "أين ستذهب المهام؟",
  "automation.plans.make.githubIssues": "بلاغات GitHub",
  "automation.plans.make.frappeTasks": "مهام Frappe",
  "automation.plans.make.repository": "المستودع (owner/name)",
  "automation.plans.make.site": "موقع Frappe",
  "automation.plans.make.chooseSite": "اختر موقعًا",
  "automation.plans.make.drafting": "جارٍ إعداد مسودة الخطة…",
  "automation.plans.make.draft": "إعداد مسودة خطة",
  "automation.plans.make.localModel":
    "قد يستغرق النموذج المحلي دقيقة. لا يُرسل شيء إلى أي مكان آخر.",
  "automation.plans.make.drafted": "أُعدّت مسودة الخطة.",
  "automation.plans.make.openPlan": "فتح الخطة",

  // ---- plans: on a meeting ----
  "automation.plans.meeting.title": "الخطط والمهام من هذا الاجتماع",
  "automation.plans.meeting.plans": "الخطط",
  "automation.plans.meeting.summary":
    "{status} · {count, plural, zero {# مهمة} one {مهمة واحدة} two {مهمتان} few {# مهام} many {# مهمة} other {# مهمة}} · {system}",
  "automation.plans.meeting.tasksCreated": "المهام المنشأة",
  "automation.plans.meeting.tasksLabel": "المهام المنشأة من هذا الاجتماع",
  "automation.plans.link.frappeTask": "المهمة {id}",
  "automation.plans.link.detail": "المهمة {index} من {plan} · وُفق عليها {date}",
  "automation.plans.link.itsPlan": "خطتها",

  // ---- plans: the editor ----
  "automation.plans.editor.label": "تعديل الخطة",
  "automation.plans.editor.title": "العنوان {hint}",
  "automation.plans.editor.summary": "الملخص {hint}",
  "automation.plans.editor.upTo": "(حتى {max})",
  "automation.plans.editor.tasks": "المهام {hint}",
  "automation.plans.editor.tasksRange": "(من 1 إلى {max})",
  "automation.plans.editor.task": "المهمة {n}",
  "automation.plans.editor.taskTitle": "عنوان المهمة {n}",
  "automation.plans.editor.taskBody": "نص المهمة {n} {hint}",
  "automation.plans.editor.taskLabels": "تسميات المهمة {n} {hint}",
  "automation.plans.editor.labelsHint": "(مفصولة بفواصل، حتى {max})",
  "automation.plans.editor.removeTask": "إزالة المهمة {n}",
  "automation.plans.editor.addTask": "إضافة مهمة",
  "automation.plans.editor.note":
    "الحفظ يعيد الخطة إلى مسودة ويمسح أي موافقة. ثم تقترحها وتوافق عليها من جديد.",
  "automation.plans.editor.save": "حفظ التغييرات",

  // ---- plans: preview and results ----
  "automation.plans.preview.title": "ما سيُرسل بالضبط",
  "automation.plans.preview.intro":
    "كل مهمة هي استدعاء واحد يُجرى باسمك. هذا هو المدخل الفعلي، معروضًا كنص عادي.",
  "automation.plans.preview.calls": "الاستدعاءات التي ستُجرى",
  "automation.plans.preview.task": "المهمة {n}: {tool}",
  "automation.plans.preview.decision": "(الأثر: {effect}، الخطورة: {risk})",
  "automation.plans.preview.input": "مدخلات المهمة {n} (نص عادي، قابل للتمرير)",
  "automation.plans.runs.title": "مهمة بمهمة",
  "automation.plans.runs.label": "نتائج المهام",
  "automation.plans.runs.task": "المهمة {n}:",
  "automation.plans.runs.attempts":
    "{count, plural, zero {# محاولة} one {محاولة واحدة} two {محاولتان} few {# محاولات} many {# محاولة} other {# محاولة}}",
  "automation.plans.runs.frappeTask": "مهمة Frappe {id}",
  "automation.plans.runs.stopped":
    "توقف عند المهمة {n}: {message}. لم يُنشأ شيء بعدها. يمكنك تشغيل «إنشاء» مرة أخرى: المهام الموجودة يُعثر عليها ولا تتكرر.",

  // ---- plans: one plan ----
  "automation.plans.page.allMeetings": "كل الاجتماعات",
  "automation.plans.page.meeting": "← الاجتماع",
  "automation.plans.page.rules": "مسودة قائمة على القواعد",
  "automation.plans.page.model": "مخرجات النموذج",
  "automation.plans.page.destination": "الوجهة: {destination}",
  "automation.plans.page.from": "من {kind}: {text}",
  "automation.plans.page.owner": "المالك {owner}",
  "automation.plans.page.due": "الاستحقاق {due}",
  "automation.plans.page.proposedNotice": "اقتُرحت. تحقق من المعاينة ثم وافق.",
  "automation.plans.page.approvedNotice": "وُفق عليها. لم يُنشأ شيء بعد.",
  "automation.plans.page.savedNotice": "حُفظت. عادت الخطة مسودة؛ اقترحها لتتمكن من الموافقة عليها.",
  "automation.plans.page.cancelledNotice": "أُلغيت. لم يُنشأ شيء.",
  "automation.plans.page.plan": "الخطة",
  "automation.plans.page.tasks": "المهام ({count})",
  "automation.plans.page.tasksLabel": "المهام",
  "automation.plans.page.labels": "التسميات:",
  "automation.plans.page.edit": "تعديل الخطة",
  "automation.plans.page.acceptance": "معايير القبول",
  "automation.plans.page.risks": "المخاطر",
  "automation.plans.page.questions": "الأسئلة المفتوحة",
  "automation.plans.frappe.doctype": "DocType مقترح في Frappe: {doctype}",
  "automation.plans.frappe.note":
    "تصميم مقترح فقط. إنشاء المهام لا ينشئ هذا الـ DocType ولا حقوله ولا سير عمله ولا صلاحياته.",
  "automation.plans.frappe.fields": "الحقول",
  "automation.plans.frappe.fieldsLabel": "حقول Frappe المقترحة",
  "automation.plans.frappe.required": "مطلوب",
  "automation.plans.frappe.noFields": "لم تُقترح حقول.",
  "automation.plans.frappe.states": "حالات سير العمل",
  "automation.plans.frappe.statesLabel": "حالات سير عمل Frappe المقترحة",
  "automation.plans.frappe.noStates": "لم تُقترح حالات لسير العمل.",
  "automation.plans.frappe.permissions": "الصلاحيات",
  "automation.plans.frappe.permissionsLabel": "صلاحيات Frappe المقترحة",
  "automation.plans.frappe.noPermissions": "لم تُقترح صلاحيات.",
  "automation.plans.frappe.access": "{role}: {access}",
  "automation.plans.frappe.read": "قراءة",
  "automation.plans.frappe.write": "كتابة",
  "automation.plans.frappe.create": "إنشاء",
  "automation.plans.frappe.noAccess": "بلا وصول",
  "automation.plans.decide.title": "القرار",
  "automation.plans.decide.fingerprint":
    "بصمة ما تراه الآن: {hash}. تشمل الموافقة هذا المحتوى بالضبط؛ وإذا تغيّرت الخطة تُرفض.",
  "automation.plans.decide.propose": "اقتراح هذه الخطة",
  "automation.plans.decide.nameMeeting": "ذكر اسم الاجتماع في المهام المنشأة",
  "automation.plans.decide.approve": "الموافقة على هذه الخطة بالضبط",
  "automation.plans.decide.approved": "وافق عليها {by} في {date}.",
  "automation.plans.decide.approvedNamed":
    "وافق عليها {by} في {date} · اسم الاجتماع مذكور في المهام.",
  "automation.plans.decide.understand":
    "أدرك أن هذا سينشئ {count, plural, zero {# مهمة} one {مهمة واحدة} two {مهمتين} few {# مهام} many {# مهمة} other {# مهمة}} في {destination} باسمي.",
  "automation.plans.decide.createRemaining": "إنشاء المهام المتبقية",
  "automation.plans.decide.create": "إنشاء المهام",
  "automation.plans.decide.waiting": "بانتظار موافقتك على المهمة {n} من {total}.",
  "automation.plans.decide.waitingNote":
    "يسألك Core قبل إنشاء كل مهمة. أجب أدناه؛ تنتظر هذه الصفحة طالما لزم الأمر.",
  "automation.plans.decide.cancel": "إلغاء هذه الخطة",

  // ---- automation settings (AutomationSettings.tsx) ----
  "automation.settings.title": "الأتمتة",
  "automation.settings.intro":
    "الأتمتة متوقفة إلى أن تشغّلها. وهي متوقفة، لا يبدأ Fawkes أي مهمة ولا يشغّل شيئًا من تلقاء نفسه. وعند تشغيلها، لا يمكن لـ Fawkes بدء مهمة إلا عندما تطلبها، مثل «تشخيص فشل CI» في علامة تبويب الدردشة. يقرأ البيانات ويقترح؛ وكل ما يغيّر شيئًا ينتظر موافقتك، ويمكنك إلغاء أي مهمة في أي وقت. إيقاف الأتمتة يلغي كل مهمة قيد التشغيل.",
  "automation.settings.allow": "السماح لـ Fawkes بتشغيل المهام التي أبدؤها",
  "automation.settings.statusOn":
    "الأتمتة قيد التشغيل. {active, plural, zero {لا توجد مهام قيد التشغيل} one {مهمة واحدة قيد التشغيل} two {مهمتان قيد التشغيل} few {# مهام قيد التشغيل} many {# مهمة قيد التشغيل} other {# مهمة قيد التشغيل}} (بحد أقصى {max} في وقت واحد).",
  "automation.settings.statusOff":
    "الأتمتة متوقفة. {active, plural, zero {لا توجد مهام قيد التشغيل} one {مهمة واحدة قيد التشغيل} two {مهمتان قيد التشغيل} few {# مهام قيد التشغيل} many {# مهمة قيد التشغيل} other {# مهمة قيد التشغيل}} (بحد أقصى {max} في وقت واحد).",
  "automation.settings.unavailable": "إعدادات الأتمتة غير متاحة من Phoenix Core ({error}).",

  // ---- proactive suggestions (ProactiveSettings.tsx) ----
  "automation.proactive.title": "الاقتراحات الاستباقية",
  "automation.proactive.intro":
    "متوقفة افتراضيًا. المصدر الوحيد المدعوم هو بنود الإجراءات المقبولة وغير المسندة من اجتماعات Kage. يجب أن يكون Kage متاحًا. لا يتوفر أي موفّر لتوقع النشر أو الحوادث أو التبعيات. التقييم يدوي ما لم تختر وتيرة صراحةً بعد الاشتراك. يعمل التقييم المجدول محليًا ويراعي ساعات الهدوء وحدود المعدل والإيقاف الطارئ.",
  "automation.proactive.status": "مصدر Kage: {source}. الاقتراحات {state} ({cadence}).",
  "automation.proactive.sourceAvailable": "متاح",
  "automation.proactive.sourceUnavailable": "غير متاح",
  "automation.proactive.stateOn": "قيد التشغيل",
  "automation.proactive.stateOff": "متوقفة",
  "automation.proactive.cadenceEvery":
    "كل {minutes, plural, zero {# دقيقة} one {دقيقة} two {دقيقتين} few {# دقائق} many {# دقيقة} other {# دقيقة}}",
  "automation.proactive.cadenceManual": "يدوي فقط",
  "automation.proactive.optIn": "الاشتراك",
  "automation.proactive.enable": "تفعيل الاقتراحات الاستباقية",
  "automation.proactive.kageItems": "بنود الإجراءات المقبولة وغير المسندة في Kage",
  "automation.proactive.cadence": "وتيرة التقييم التلقائي",
  "automation.proactive.cadenceOff": "يدوي فقط (متوقف)",
  "automation.proactive.cadence15": "كل 15 دقيقة",
  "automation.proactive.cadence30": "كل 30 دقيقة",
  "automation.proactive.cadence60": "كل ساعة",
  "automation.proactive.cadence1440": "كل يوم",
  "automation.proactive.quietHours": "ساعات الهدوء",
  "automation.proactive.useQuiet": "استخدام ساعات الهدوء",
  "automation.proactive.timezone": "المنطقة الزمنية (IANA)",
  "automation.proactive.quietFrom": "الهدوء من",
  "automation.proactive.quietUntil": "الهدوء حتى",
  "automation.proactive.maxPerHour": "الحد الأقصى للاقتراحات في الساعة",
  "automation.proactive.preview": "معاينة الاقتراحات",
  "automation.proactive.evaluate": "التقييم الآن",
  "automation.proactive.refreshNoise": "تحديث مقاييس الضوضاء",
  "automation.proactive.delivered": "الاقتراحات المسلَّمة",
  "automation.proactive.dismiss": "تجاهل {title}",
  "automation.proactive.previewHeading": "معاينة مستندة إلى الأدلة",
  "automation.proactive.previewLabel": "معاينة الاقتراحات",
  "automation.proactive.previewEmpty": "لا توجد بنود إجراءات مقبولة وغير مسندة مؤهلة في Kage.",
  "automation.proactive.evidence": "الدليل: الاجتماع {meeting}، البند {item} ({source}): “{quote}”",
  "automation.proactive.sourceTranscript": "النص المفرَّغ",
  "automation.proactive.sourceSummary": "الملخص",
  "automation.proactive.noiseLabel": "مقاييس ضوضاء الاقتراحات",
  "automation.proactive.noiseDelivered": "المسلَّمة",
  "automation.proactive.noiseDismissed": "المتجاهَلة",
  "automation.proactive.noiseSuppressed": "المكتومة",
  "automation.proactive.noiseRate": "معدل التجاهل",
  "automation.proactive.saved": "حُفظت تفضيلات الاقتراحات.",
  "automation.proactive.previewCount":
    "{count, plural, zero {لا توجد اقتراحات مستندة إلى الأدلة في المعاينة.} one {اقتراح واحد مستند إلى الأدلة في المعاينة.} two {اقتراحان مستندان إلى الأدلة في المعاينة.} few {# اقتراحات مستندة إلى الأدلة في المعاينة.} many {# اقتراحًا مستندًا إلى الأدلة في المعاينة.} other {# اقتراح مستند إلى الأدلة في المعاينة.}}",
  "automation.proactive.evaluated": "سُلِّم {delivered}؛ كُتم {suppressed}.",
  "automation.proactive.dismissed": "تُجوهل الاقتراح.",

  // ---- capability registry (RegistrySettings.tsx) ----
  "automation.registry.title": "سجل القدرات",
  "automation.registry.intro":
    "تصفّح البيانات الوصفية من فهرس موقَّع مُهيَّأ محليًا وموثوق من المضيف. يتحقق Phoenix Core من توقيع الفهرس قبل إرجاع المدخلات. التصفح لا يثبّت ولا يشغّل شيفرة جهات خارجية.",
  "automation.registry.noInstall":
    "التثبيت غير متاح: لا توجد بيئة معزولة مدققة في نظام التشغيل. لا يمكن تثبيت قدرات الجهات الخارجية هنا.",
  "automation.registry.unavailable": "السجل غير متاح",
  "automation.registry.loadFailed": "تعذّر تحميل السجل: {error}",
  "automation.registry.loading": "جارٍ تحميل السجل…",
  "automation.registry.notConfigured":
    "لم يُهيَّأ أي سجل محلي. اطلب من مسؤول المضيف تهيئة مفتاح موثوق وفهرس موقَّع لتصفح القدرات.",
  "automation.registry.indexSignature":
    "توقيع الفهرس: جرى التحقق منه بالموقِّع {signer} من نوع Ed25519 الموثوق من المضيف.",
  "automation.registry.signature": "التوقيع: {signature}",
  "automation.registry.indexHash": "SHA-256 للفهرس الموقَّع: {hash}",
  "automation.registry.empty": "لا يحتوي السجل الموقَّع على أي قدرات.",
  "automation.registry.preview": "معاينة {name} {version}",
  "automation.registry.previewFailed": "المعاينة غير متاحة: {error}",
  "automation.registry.previewLoading": "جارٍ تحميل المعاينة الموثَّقة…",
  "automation.registry.permissions": "الصلاحيات",
  "automation.registry.noDescription": "لم يُقدَّم وصف",
  "automation.registry.noneDeclared": "لم يُعلن عن شيء.",
  "automation.registry.dataCategories": "فئات البيانات",
  "automation.registry.licence": "الترخيص",
  "automation.registry.licenceLine": "{licence}. {policy}",
  "automation.registry.security": "الأمان",
  "automation.registry.securityContact": "جهة الاتصال الأمنية",
  "automation.registry.advisories": "التنبيهات الأمنية",
  "automation.registry.provenance": "المصدر الموقَّع",
  "automation.registry.artifact":
    "SHA-256 للحزمة كما أعلنه الفهرس الموقَّع: {hash} ({bytes, plural, zero {# بايت} one {بايت واحد} two {بايتان} few {# بايتات} many {# بايتًا} other {# بايت}}). التحقق من الحزمة: لم يُجرَ؛ لم تُجلب بايتات الحزمة ولم تُفحص. التصفح لا ينفّذ الحزمة.",
  "automation.registry.sandbox":
    "البيئة المعزولة: غير متاحة. التثبيت معطّل؛ لن يُرسل أي طلب تثبيت.",

  // ---- encrypted sync (SyncSettings.tsx) ----
  "automation.sync.title": "المزامنة المشفّرة",
  "automation.sync.intro":
    "اختيارية ومتوقفة افتراضيًا. تتطلب المزامنة مرحِّل HTTPS خاصًا بك ومتاحًا ومصادقة المرحِّل؛ ولا يوفّر Phoenix مرحِّلًا مستضافًا. التهيئة اشتراك صريح: لا ترسل شيئًا أثناء الإعداد، لكن السجلات الموضوعة في قائمة الانتظار تُزامَن تلقائيًا بعد ذلك عند الاتصال بالإنترنت. «المزامنة الآن» تبدأ محاولة فورية. يجهّز المحوِّل فقط الإعدادين غير المحتويين المحددين صراحةً؛ وتتطلب التغييرات المحلية اللاحقة «نشر الحالي». لا يشمل هذا المحوِّل أبدًا نص الاجتماعات أو الأشخاص أو الذاكرة.",
  "automation.sync.unavailable":
    "إعدادات المزامنة غير متاحة من Phoenix Core. لم يتصل طلب الحالة هذا بالمرحِّل.",
  "automation.sync.relayNone": "غير مهيَّأ",
  "automation.sync.relayUnknown": "مرحِّل مهيَّأ (عنوان URL غير متاح)",
  "automation.sync.statusOn":
    "المزامنة قيد التشغيل. {pending} في قائمة الانتظار؛ {conflicts, plural, zero {# تعارض} one {تعارض واحد} two {تعارضان} few {# تعارضات} many {# تعارضًا} other {# تعارض}}.",
  "automation.sync.statusOff":
    "المزامنة متوقفة. {pending} في قائمة الانتظار؛ {conflicts, plural, zero {# تعارض} one {تعارض واحد} two {تعارضان} few {# تعارضات} many {# تعارضًا} other {# تعارض}}.",
  "automation.sync.chooseExclusions":
    "اختر الاستثناءات قبل الاشتراك؛ لا تُرفع الفئات والمشاريع المستثناة.",
  "automation.sync.excludeClasses": "استثناء فئات البيانات",
  "automation.sync.class.preference": "التفضيلات",
  "automation.sync.class.context": "السياق",
  "automation.sync.class.project_profile": "ملف المشروع",
  "automation.sync.excludeProject": "استثناء مشروع بالاسم",
  "automation.sync.excludeProjectButton": "استثناء المشروع",
  "automation.sync.removeExclusion": "إزالة الاستثناء عن {name}",
  "automation.sync.exclusionsSaved": "حُفظت الاستثناءات.",
  "automation.sync.adapterLegend": "الاشتراك في الإعدادات الحالية كلًا على حدة",
  "automation.sync.adapterNote":
    "يؤهَّل فقط تقليل الحركة المرتبط بمالك الحساب (تفضيل) وعدد نتائج البحث (تهيئة السياق)؛ ولا توجد مصادر مرتبطة بمشروع. الاختيار يجهّز القيمة الحالية. انشر أي تغيير محلي لاحق صراحةً. تبقى القيم الواردة مجهَّزة إلى أن تراجعها وتؤكد تطبيقها محليًا. استثناء فئة يزيل اختيارها من المحوِّل أيضًا عند الإمكان؛ أما السجلات المنشورة بالفعل فيجب حذفها ومزامنتها أولًا. إلغاء الاختيار لا يمحو النص المشفّر المرفوع؛ احذف عنصره المزامَن بشكل منفصل إن لزم.",
  "automation.sync.adapter.reducedMotion": "تفضيل تقليل الحركة",
  "automation.sync.adapter.searchCount": "بيانات وصفية لعدد نتائج البحث",
  "automation.sync.adapterSaved":
    "حُفظ اختيار المحوِّل. جُهِّزت الإعدادات الحالية المختارة حديثًا؛ ولا تُضمَّن أي مصادر أخرى.",
  "automation.sync.adapterApplied": "طُبِّق الإعداد المزامَن المحدد محليًا.",
  "automation.sync.adapterPublished": "جُهِّز الإعداد المحلي الحالي للمزامنة المشفّرة.",
  "automation.sync.publish": "نشر {key} الحالي",
  "automation.sync.reviewApply": "مراجعة تطبيق {key}",
  "automation.sync.applyPreview": "معاينة تطبيق الإعداد",
  "automation.sync.applyText":
    "هل تريد تطبيق المراجعة {revision} المجهَّزة والمفكوكة التشفير من {key} على الإعداد المحلي الحالي؟ لن تحل محل القيمة الحالية إلا بعد التأكيد. القيمتان الحالية والواردة مخفيتان؛ حدّد الإصدارين بحسب المصدر والمراجعة، أو ألغِ. أي تغيير في القيمة المحلية أو المراجعة المجهَّزة يُبطل هذه المعاينة.",
  "automation.sync.confirmApply": "تأكيد تطبيق الإعداد",
  "automation.sync.cancelApply": "إلغاء التطبيق",
  "automation.sync.relayLine":
    "المرحِّل: {relay}. الهوية: {identity}. يلزم مرحِّل يمكن الوصول إليه؛ هذه الحالة لا تثبت أن المرحِّل متاح.",
  "automation.sync.identityNone": "غير متاحة",
  "automation.sync.identityNote":
    "تمثل هذه الهوية حساب مفتاح الاسترداد المشترك، لا جهازًا بعينه. لا يمكن إلغاء الأجهزة التي تملك المفتاح نفسه ورمز المرحِّل نفسه فرديًا، ولم تُقرَّر حماية المرحِّل من إعادة التشغيل.",
  "automation.sync.syncNow": "المزامنة الآن",
  "automation.sync.turnOff": "إيقاف المزامنة",
  "automation.sync.turnedOff": "المزامنة متوقفة. تبقى السجلات الموضوعة في قائمة الانتظار محلية.",
  "automation.sync.offlineNote":
    "إذا كان المرحِّل غير متصل، تُبلغ المزامنة اليدوية عن خطأ وتبقى العناصر المعلّقة في قائمة الانتظار لإعادة المحاولة لاحقًا. لا يحدث أي استبدال صامت عند التعارض.",
  "automation.sync.syncedPending":
    "{pending, plural, zero {# عنصر} one {عنصر واحد} two {عنصران} few {# عناصر} many {# عنصرًا} other {# عنصر}} ما زال في قائمة الانتظار. راجع الحالة والتعارضات أدناه.",
  "automation.sync.syncedDone": "انتهت المزامنة. راجع العناصر والتعارضات أدناه.",
  "automation.sync.items": "العناصر المزامَنة",
  "automation.sync.itemsNote": "بيانات وصفية فقط؛ لا تُعرض محتويات العناصر ولا القيم المتعارضة.",
  "automation.sync.noItems": "لا توجد سجلات مزامنة مجهَّزة.",
  "automation.sync.itemLine":
    "{id} · {dataClass} · المالك {owner} · النطاق {scope} · المشروع {project} · المراجعة {revision} · آخر تحديث {updated} · {state}",
  "automation.sync.projectNone": "لا شيء",
  "automation.sync.updatedUnknown": "غير معروف",
  "automation.sync.state.deletionQueued": "الحذف في قائمة الانتظار",
  "automation.sync.state.deleted": "محذوف",
  "automation.sync.state.queued": "في قائمة الانتظار",
  "automation.sync.state.synced": "مزامَن",
  "automation.sync.conflictMissing":
    "تعارض: هذا السجل مفقود على المرحِّل. أبقِ المحلي لاستعادته على المرحِّل، أو اقبل الحذف البعيد لحذف سجل المزامنة المحلي المجهَّز. لا يُستبدل شيء تلقائيًا.",
  "automation.sync.conflictRemote":
    "تعارض: المراجعة البعيدة {revision}، آخر تحديث {updated}. لا يُستبدل شيء إلى أن تختار أحد الجانبين.",
  "automation.sync.reviewKeepLocal": "مراجعة إبقاء المحلي لـ {id}",
  "automation.sync.reviewKeepRemote": "مراجعة إبقاء البعيد لـ {id}",
  "automation.sync.reviewAcceptDeletion": "مراجعة قبول الحذف البعيد لـ {id}",
  "automation.sync.reviewDeletion": "مراجعة الحذف البعيد لـ {id}",
  "automation.sync.resolutionPreview": "معاينة حل التعارض",
  "automation.sync.previewFor": "معاينة {id} ({scope}):",
  "automation.sync.previewAcceptDeletion":
    "قبول الحذف البعيد: يُحذف سجل المزامنة المحلي المجهَّز الآن؛ ولا يُرفع شيء.",
  "automation.sync.previewRestore":
    "استعادة المفقود البعيد: تُوضع النسخة المحلية في قائمة الانتظار للرفع عند المزامنة الناجحة التالية.",
  "automation.sync.previewKeepRemote":
    "إبقاء البعيد: يُستبدل سجل المزامنة المحلي المجهَّز بالنسخة البعيدة الآن.",
  "automation.sync.previewKeepLocal":
    "إبقاء المحلي: تُوضع هذه النسخة في قائمة الانتظار للرفع عند المزامنة الناجحة التالية. وسيظل أي تغيير بعيد أحدث يتطلب حلًا.",
  "automation.sync.previewTail":
    "محتويات العناصر مخفية هنا؛ وإذا لم تستطع تحديد الإصدارين من البيانات الوصفية فألغِ. لا يمكن التراجع عن هذا من هنا.",
  "automation.sync.confirmAcceptDeletion": "تأكيد قبول الحذف البعيد",
  "automation.sync.confirmRestore": "تأكيد استعادة المفقود البعيد",
  "automation.sync.confirmKeepLocal": "تأكيد إبقاء المحلي",
  "automation.sync.confirmKeepRemote": "تأكيد إبقاء البعيد",
  "automation.sync.cancelResolution": "إلغاء الحل",
  "automation.sync.resolvedDeletion":
    "قُبل الحذف البعيد. حُذف سجل المزامنة المحلي المجهَّز الآن؛ ولم يوضع شيء في قائمة الانتظار للرفع.",
  "automation.sync.resolvedChoice":
    "حُفظ خيار التعارض. تُزامَن التغييرات المعلّقة تلقائيًا عند الاتصال بالإنترنت؛ و«المزامنة الآن» تبدأ محاولة فورية.",
  "automation.sync.deletionConfirmation": "تأكيد الحذف البعيد",
  "automation.sync.deletionText":
    "هل تريد حذف {id} ({scope}) من المرحِّل؟ يضع هذا علامة حذف في قائمة الانتظار محليًا؛ ولا تُزال النسخة البعيدة إلا بعد مزامنة ناجحة. لا يمكن التراجع عن هذا من هنا.",
  "automation.sync.confirmDeletion": "تأكيد الحذف البعيد",
  "automation.sync.cancelDeletion": "إلغاء الحذف",
  "automation.sync.deletionQueued":
    "الحذف في قائمة الانتظار. لا تُحذف النسخة البعيدة إلا بعد مزامنة ناجحة.",
  "automation.sync.relayUrl": "عنوان HTTPS للمرحِّل",
  "automation.sync.relayToken": "رمز مصادقة المرحِّل",
  "automation.sync.restoreKey": "مفتاح الاسترداد الحالي (اختياري، لاستعادة هوية)",
  "automation.sync.optInNote":
    "اشتراك صريح: تخزّن التهيئة بيانات اعتماد المرحِّل محليًا وتفعّل المزامنة التلقائية للسجلات الموضوعة في قائمة الانتظار عند الاتصال بالإنترنت. تعرض الهوية الجديدة مفتاح الاسترداد مرة واحدة: احفظه فورًا؛ لا يمكن استرجاعه لاحقًا. تعيد إعادة التهيئة بعد إيقاف المزامنة استخدام الهوية المخزّنة محليًا عند توفرها. لا تشارك مفتاحك أبدًا مع مشغّل المرحِّل.",
  "automation.sync.configure": "تهيئة المزامنة المشفّرة",
  "automation.sync.configured":
    "المزامنة مهيَّأة. تُزامَن السجلات الموضوعة في قائمة الانتظار تلقائيًا عند الاتصال بالإنترنت؛ و«المزامنة الآن» تبدأ محاولة فورية.",
  "automation.sync.recoveryGroup": "مفتاح الاسترداد لمرة واحدة",
  "automation.sync.recoveryText":
    "انسخ مفتاح الاسترداد هذا واحفظه في مكان آمن الآن. يُعرض مرة واحدة فقط ولا يمكن استرجاعه لاحقًا. لا تشاركه.",
  "automation.sync.copyKey": "نسخ مفتاح الاسترداد",
  "automation.sync.savedKey": "حفظتُ المفتاح — إغلاق",
  "automation.sync.refresh": "تحديث حالة المزامنة",
};
