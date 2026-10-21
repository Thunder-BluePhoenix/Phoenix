// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { power as enpower } from "../../en/power";

/** Machine-translated; unreviewed (see ../../README.md). */
export const power: Record<keyof typeof enpower, string> = {
  "power.awake.duration.minutes":
    "{minutes, plural, zero {# دقيقة} one {دقيقة} two {دقيقتان} few {# دقائق} many {# دقيقة} other {# دقيقة}}",
  "power.awake.duration.hours":
    "{hours, plural, zero {# ساعة} one {ساعة} two {ساعتان} few {# ساعات} many {# ساعة} other {# ساعة}}",
  "power.awake.heading": "إبقاء الجهاز مستيقظًا",
  "power.awake.disabled": "ميزة إبقاء الجهاز مستيقظًا متوقفة. فعّل القدرة لاستخدامها.",
  "power.awake.waiting": "في انتظار موافقتك…",
  "power.awake.idle": "ينام الحاسوب كالمعتاد. ابدأ جلسة محددة المدة لإبقائه مستيقظًا.",
  "power.awake.start.heading": "إبقاء مستيقظًا لمدة",
  "power.awake.custom.label": "الدقائق",
  "power.awake.reason.label": "السبب (اختياري)",
  "power.awake.custom.start": "ابدأ",
  "power.awake.custom.invalid": "أدخل عددًا صحيحًا من الدقائق بين {min} و{max}.",
  "power.awake.agents.start": "أثناء عمل الوكلاء",
  "power.awake.agents.help":
    "يبقى مستيقظًا ما دام أي وكيل برمجة يعمل، وينتهي بعد دقائق من انتهاء آخر وكيل (يستخدم الدقائق أعلاه).",
  "power.awake.agents.working":
    "{count, plural, zero {لا وكلاء يعملون} one {وكيل واحد يعمل} two {وكيلان يعملان} few {# وكلاء يعملون} many {# وكيلًا يعملون} other {# وكيل يعملون}}",
  "power.awake.agents.grace":
    "ينتهي بعد {minutes, plural, zero {# دقيقة} one {دقيقة} two {دقيقتين} few {# دقائق} many {# دقيقة} other {# دقيقة}} من انتهاء آخر وكيل.",
  "power.awake.running": "يتم إبقاء الحاسوب مستيقظًا",
  "power.awake.remaining": "الوقت المتبقي: {time}",
  "power.awake.endsAt": "ينتهي في {time}",
  "power.awake.extend.label": "إضافة وقت",
  "power.awake.extend.button": "+{duration}",
  "power.awake.end.hold": "اضغط مطولًا للإنهاء",
  "power.awake.end.holding": "استمر في الضغط…",
  "power.awake.end.hint":
    "اضغط على الزر 1.5 ثانية (أو اضغط مطولًا على المسافة أو Enter) لإنهاء الجلسة.",
  "power.awake.battery":
    "تنتهي الجلسة أيضًا إذا انخفضت البطارية عن {percent}٪ أثناء عدم التوصيل بالطاقة.",
  "power.awake.lid":
    "إغلاق الغطاء ما زال يضع الحاسوب في وضع النوم؛ البقاء مستيقظًا مع الغطاء مغلقًا يحتاج إلى وضع الغطاء المغلق المنفصل.",
  "power.awake.indicator": "مستيقظ {time}",
  "power.recovery.heading": "وضع الغطاء المغلق والاسترداد",
  "power.recovery.waiting": "في انتظار موافقتك…",
  "power.recovery.unreadable": "تعذّرت قراءة حالة الاسترداد.",
  "power.recovery.journal.clean": "لا يوجد ما ينتظر التراجع عنه.",
  "power.recovery.journal.pending":
    "تعذّر على Phoenix استعادة {count, plural, zero {# تغيير في النظام} one {تغيير واحد في النظام} two {تغييرين في النظام} few {# تغييرات في النظام} many {# تغييرًا في النظام} other {# تغيير في النظام}}. قد تبقى إعدادات النوم متغيرة.",
  "power.recovery.journal.kind.disablesleep": "عدم النوم مع الغطاء مغلقًا",
  "power.recovery.journal.kind.lowpowermode": "وضع الطاقة المنخفضة",
  "power.recovery.journal.kind.other": "تغيير آخر",
  "power.recovery.journal.at": "منذ {time}",
  "power.recovery.journal.undo": "تراجع الآن",
  "power.recovery.journal.untrusted":
    "تم تجاهل {count, plural, zero {# سطر غير مقروء} one {سطر غير مقروء واحد} two {سطرين غير مقروءين} few {# أسطر غير مقروءة} many {# سطرًا غير مقروء} other {# سطر غير مقروء}} من السجل وعدم الوثوق بها.",
  "power.recovery.journal.cannotQuit": "سيُرفض إغلاق Phoenix إلى أن يتم التراجع عن هذه التغييرات.",
  "power.recovery.lid.open": "الغطاء مفتوح.",
  "power.recovery.lid.closed": "الغطاء مغلق.",
  "power.recovery.lid.unknown": "حالة الغطاء غير معروفة.",
  "power.recovery.lid.unsupported":
    "لا يحتوي هذا الحاسوب على مستشعر للغطاء، لذا فإن وضع الغطاء المغلق غير متاح.",
  "power.recovery.helper.installed": "المساعد ذو الصلاحيات مثبّت",
  "power.recovery.helper.missing":
    "المساعد ذو الصلاحيات غير مثبّت (وضع الغطاء المغلق غير متاح). راجع docs/awake-helper.md.",
  "power.recovery.helper.unknown": "من غير المعروف ما إذا كان المساعد ذو الصلاحيات مثبّتًا.",
  "power.recovery.floors.off": "الحدود الدنيا متوقفة",
  "power.recovery.floors.rule":
    "وضع الطاقة المنخفضة عند أقل من {low} ٪، وإنهاء الجلسة عند أقل من {end} ٪؛ الحرارة: وضع الطاقة المنخفضة عند {heatLow}، والإنهاء عند {heatEnd}.",
  "power.recovery.floors.lowPowerActive": "وضع الطاقة المنخفضة قيد التشغيل",
  "power.recovery.floors.battery.none": "البطارية: لا توجد",
  "power.recovery.floors.battery.unknown": "البطارية: غير معروفة",
  "power.recovery.floors.battery.level": "البطارية {percent} ٪",
  "power.recovery.floors.battery.unplugged": "البطارية {percent} ٪، غير موصول بالطاقة",
  "power.recovery.floors.battery.plugged": "البطارية {percent} ٪، موصول بالطاقة",
  "power.recovery.floors.thermal.nominal": "طبيعية",
  "power.recovery.floors.thermal.fair": "دافئة",
  "power.recovery.floors.thermal.serious": "ساخنة",
  "power.recovery.floors.thermal.critical": "حرجة",
  "power.recovery.floors.thermal.level": "الحرارة: {level}",
  "power.recovery.floors.thermal.unsupported": "الحرارة: غير مُبلَّغ عنها",
  "power.recovery.floors.thermal.unknown": "الحرارة: غير معروفة",
  "power.recovery.safety.warning":
    "لا تحمل الحاسوب أبدًا داخل حقيبة أو علبة أو أي مكان مغلق أثناء تشغيل وضع الغطاء المغلق: فقد يسخن بشدة. أبقِ فتحات التهوية مكشوفة.",
  "power.recovery.safety.understand": "أنا أفهم",
  "power.recovery.safety.acknowledge": "إقرار",
  "power.recovery.safety.done": "لقد أقررت بتحذير السلامة الخاص بالغطاء المغلق.",
  "power.recovery.start": "بدء وضع الغطاء المغلق",
  "power.recovery.end": "إنهاء وضع الغطاء المغلق",
  "power.recovery.engaged": "وضع الغطاء المغلق قيد التشغيل.",
  "power.recovery.engagedSince": "وضع الغطاء المغلق قيد التشغيل منذ {time}.",
  "power.recovery.needsSession":
    "ابدأ جلسة إبقاء الجهاز مستيقظًا أولًا؛ يحتاجها وضع الغطاء المغلق.",
  "power.recovery.journal.discard": "تجاهل هذا الإدخال",
  "power.recovery.lockBlocked":
    "عملية استرداد أخرى تحتفظ بالقفل، لذلك لم يُتراجع عن أي شيء بعد. التغيير ما زال معلقًا.",
  "power.recovery.sleepUnjournaled":
    "السكون معطّل على هذا الكمبيوتر، لكن Phoenix لا يملك سجلًا بأنه عطّله. لقد غيّره شيء آخر.",
  "power.recovery.journalPath": "السجل: {path}",
  "power.continuity.heading": "استمرارية الوكيل",
  "power.continuity.intro":
    "إضافات لعمليات الوكيل الطويلة. كل واحدة منها متوقفة حتى تفعّلها، ولا تختار أيٌّ منها شبكة أو طرفية أو برنامجًا نيابةً عنك.",
  "power.continuity.needsAwake":
    "تسري هذه الإعدادات فقط عندما تكون ميزة «إبقاء الجهاز مستيقظًا» (Keep awake) مفعّلة.",
  "power.continuity.saved":
    "تم الحفظ. تُطبَّق التغييرات في المرة القادمة التي يبدأ فيها «إبقاء الجهاز مستيقظًا».",
  "power.continuity.applyNote":
    "تُحفظ التغييرات في ميزة «إبقاء الجهاز مستيقظًا» وتُطبَّق في المرة القادمة التي تُفعَّل فيها.",
  "power.continuity.network.title": "مراقبة الشبكة",
  "power.continuity.network.help":
    "تتحقق كل بضع ثوانٍ من إمكانية الوصول إلى حاسوب تحدده، وتُبلغ Phoenix عند انقطاع الشبكة وعند عودتها. تكتفي بالاتصال فقط؛ فلا ترسل شيئًا ولا تقرأ شيئًا.",
  "power.continuity.hosts.label": "المضيفات المراد فحصها (الاسم أو الاسم:المنفذ)",
  "power.continuity.hotspot.title": "التحويل التلقائي إلى نقطة الاتصال",
  "power.continuity.hotspot.help":
    "عند انقطاع Wi-Fi أثناء تشغيل جلسة إبقاء الجهاز مستيقظًا، ينضم الجهاز إلى نقطة اتصال iPhone التي تحددها. تتطلب مراقبة الشبكة أعلاه وقائمة مضيفات. تعمل على macOS فقط ولم تُختبر على جهاز Mac حقيقي.",
  "power.continuity.hotspot.ssid": "اسم نقطة الاتصال (SSID)",
  "power.continuity.hotspot.disclosure":
    "قبل أن تفعّل هذا الخيار: يستطيع macOS الانضمام إلى شبكة يعرفها مسبقًا دون أي كلمة مرور في سطر الأوامر، لذا انضم إلى نقطة الاتصال يدويًا مرة واحدة أولًا. فقط إذا سمحتَ أيضًا باستخدام كلمة المرور المحفوظة أدناه، ستمررها Phoenix إلى أداة networksetup في macOS، وعندها يستطيع أي برنامج على هذا الـ Mac قراءتها من سطر الأوامر خلال الثواني القليلة التي يستغرقها الانضمام. لا توجد طريقة مدمجة أكثر أمانًا لتنفيذ ذلك دون سؤالك. ارفض إذا لم يكن ذلك مقبولًا لديك.",
  "power.continuity.hotspot.allowPassword":
    "أقبل ذلك: استخدم كلمة مرور نقطة الاتصال المحفوظة في سطر الأوامر",
  "power.continuity.hotspot.passwordSaved":
    "كلمة مرور نقطة الاتصال محفوظة في سلسلة المفاتيح (keychain).",
  "power.continuity.hotspot.passwordMissing":
    "لا توجد كلمة مرور محفوظة لنقطة الاتصال. احفظ واحدة باعتبارها السر “hotspot_password” لميزة «إبقاء الجهاز مستيقظًا»، أو اترك هذا المربع غير مفعّل وانضم إلى نقطة الاتصال يدويًا مرة واحدة.",
  "power.continuity.hotspot.join": "الانضمام إلى نقطة الاتصال الآن",
  "power.continuity.hotspot.rejoin": "العودة إلى شبكتي السابقة",
  "power.continuity.hotspot.confirmNote":
    "الانضمام إلى شبكة يغيّر شبكة Wi-Fi التي يستخدمها هذا الـ Mac. تطلب منك Phoenix التأكيد في كل مرة.",
  "power.continuity.hotspot.joined": "تم الانضمام.",
  "power.continuity.nudge.title": "تنبيه الوكلاء",
  "power.continuity.nudge.help":
    "إذا لم تتوفر شبكة طوال المدة المحددة أدناه، تُكتب الكلمة “continue” في الطرفيات التي تدرجها. لا يُكتب شيء أثناء اجتماع أو إملاء صوتي، وتتلقى كل طرفية الكلمة مرة واحدة على الأكثر في كل انقطاع.",
  "power.continuity.nudge.after": "عدد الثواني بلا شبكة قبل التنبيه (من 30 إلى 3600)",
  "power.continuity.nudge.panes": "لوحات tmux (مثال: %12)",
  "power.continuity.nudge.sessions": "جلسات وكيل Phoenix (ph- و16 رقمًا ست عشريًا)",
  "power.continuity.nudge.sessionsNote":
    "غير متاح بعد: ليس لدى Phoenix طريقة آمنة للكتابة في جلسة متتبَّعة، لذا تُتجاهل الجلسات المدرجة ويُبلَّغ عنها. تُنبَّه لوحات tmux فقط.",
  "power.continuity.nudge.commands": "البرامج التي قد تعمل في اللوحة (مثال: claude)",
  "power.continuity.nudge.commandsNote":
    "تتحقق Phoenix من أن اللوحة ما زالت موجودة وأنها تشغّل أحد هذه البرامج قبل الكتابة. وإذا كانت القائمة فارغة فلن يُكتب شيء أبدًا.",
  "power.continuity.nudge.enter": "اضغط Enter أيضًا",
  "power.continuity.nudge.enterHelp":
    "متوقف افتراضيًا. بدونه تُكتب الكلمة “continue” ولكن لا تُرسل، فتضغط Enter بنفسك.",
  "power.continuity.throttle.title": "فحص تقليل أداء المتصفح",
  "power.continuity.throttle.help":
    "تُبطئ المتصفحات Chrome وArc وComet وEdge وBrave علامات التبويب في الخلفية، ما قد يعطّل صفحة ويب يعمل عليها الوكيل. تعرض هذه الأداة المتصفحات التي تعمل بهذه الطريقة. ولا تغيّر أي متصفح أبدًا إلا إذا اخترتَ «إعادة التشغيل» وأكدتَ ذلك.",
  "power.continuity.throttle.unsupported": "فحص المتصفحات يعمل على macOS فقط.",
  "power.continuity.throttle.notRunning": "غير قيد التشغيل",
  "power.continuity.throttle.throttled": "يعمل مع تقليل الأداء في الخلفية",
  "power.continuity.throttle.fine": "يعمل دون تقليل الأداء",
  "power.continuity.throttle.relaunch": "إعادة تشغيل {name} دون تقليل الأداء",
  "power.continuity.throttle.confirm":
    "هل تريد إعادة تشغيل {name} دون تقليل الأداء في الخلفية؟ سيُغلق {name} ثم يُفتح من جديد، وسيُعاد تحميل علامات التبويب فيه، وقد يضيع أي شيء غير محفوظ في أي صفحة. يُرفض هذا الإجراء أثناء اجتماع أو إملاء صوتي.",
  "power.continuity.throttle.confirmYes": "إغلاق وإعادة التشغيل",
  "power.continuity.throttle.relaunched": "تمت إعادة تشغيل {name}.",
  "power.continuity.outage.title": "آخر انقطاع للشبكة",
  "power.continuity.outage.none": "لم يُرصد أي انقطاع للشبكة حتى الآن.",
  "power.continuity.outage.down": "الشبكة منقطعة منذ {time}.",
  "power.continuity.outage.ended": "كانت الشبكة منقطعة من {from} إلى {to}.",
  "power.continuity.outage.nudged":
    "{count, plural, zero {لم تُنبَّه أي طرفية} one {تم تنبيه طرفية واحدة} two {تم تنبيه طرفيتين} few {تم تنبيه # طرفيات} many {تم تنبيه # طرفية} other {تم تنبيه # طرفية}}",
  "power.continuity.outage.hotspot.joined": "تم الانضمام إلى نقطة الاتصال",
  "power.continuity.outage.hotspot.failed": "فشل الانضمام إلى نقطة الاتصال",
  "power.continuity.outage.hotspot.skipped":
    "لم تُجرَّب نقطة الاتصال (الميزة متوقفة، أو لا توجد جلسة قيد التشغيل)",
  "power.continuity.outage.hotspot.notTried": "لم تُجرَّب نقطة الاتصال بعد",
  "power.continuity.list.empty": "لا يوجد شيء في القائمة.",
  "power.continuity.list.remove": "إزالة {item}",
  "power.continuity.invalid.host":
    "استخدم اسم مضيف أو عنوانًا، مع إمكانية إضافة :المنفذ (من 1 إلى 65535).",
  "power.continuity.invalid.pane":
    "استخدم معرّف لوحة tmux مثل %12: علامة نسبة مئوية يتبعها ستة أرقام على الأكثر.",
  "power.continuity.invalid.session": "استخدم معرّف جلسة مثل ph-0123456789abcdef.",
  "power.continuity.invalid.command": "استخدم اسم برنامج مثل claude: أحرف وأرقام و . _ + - فقط.",
  "power.continuity.invalid.ssid": "استخدم نصًا مرئيًا طوله من 1 إلى 32 بايت ولا يبدأ بواصلة.",
  "power.continuity.invalid.seconds": "أدخل عددًا صحيحًا من الثواني بين {min} و{max}.",
  "power.continuity.problem.duplicate": "هذا الإدخال موجود في القائمة بالفعل.",
  "power.continuity.problem.full": "القائمة ممتلئة ({max} إدخالًا على الأكثر).",
  "power.continuity.reason.unsupported_platform": "هذه الميزة تعمل على macOS فقط.",
  "power.continuity.reason.no_wifi_device":
    "تعذّر على Phoenix العثور على جهاز Wi-Fi في هذا الـ Mac.",
  "power.continuity.reason.no_hotspot_configured":
    "لا توجد نقطة اتصال أو شبكة سابقة صالحة للانضمام إليها.",
  "power.continuity.reason.bad_password":
    "لا يمكن استخدام كلمة المرور المحفوظة. تحقق منها في سلسلة المفاتيح (keychain).",
  "power.continuity.reason.join_failed": "تعذّر على macOS الانضمام إلى الشبكة.",
  "power.continuity.reason.unknown_browser": "هذا المتصفح ليس من المتصفحات التي تديرها Phoenix.",
  "power.continuity.reason.protected": "ليس الآن: هناك اجتماع أو إملاء صوتي قيد التنفيذ.",
  "power.continuity.reason.not_running": "هذا المتصفح غير قيد التشغيل.",
  "power.continuity.reason.already_unthrottled":
    "هذا المتصفح يعمل بالفعل دون تقليل الأداء في الخلفية.",
  "power.continuity.reason.unavailable": "هذا الإجراء غير متاح الآن.",
  "power.continuity.reason.quit_failed": "لم يقبل المتصفح طلب الإغلاق.",
  "power.continuity.reason.still_running":
    "المتصفح ما زال مفتوحًا، لذلك لم تتم إعادة فتحه. أغلقه بنفسك ثم حاول مرة أخرى.",
  "power.continuity.reason.open_failed": "أُغلق المتصفح لكن تعذّرت إعادة فتحه.",
  "power.continuity.reason.other": "لم تنجح العملية.",
  "power.lid.heading": "إجراءات إغلاق الغطاء",
  "power.lid.intro":
    "أثناء جلسة إبقاء الجهاز مستيقظاً، عند إغلاق الغطاء يمكن لـ Phoenix توفير الطاقة وتهدئة هذا الكمبيوتر. يُتراجع عن كل شيء عند فتح الغطاء وعند انتهاء الجلسة وعند بدء Phoenix من جديد بعد انهيار.",
  "power.lid.needsAwake": "تعمل هذه الإجراءات فقط أثناء تفعيل ميزة إبقاء الجهاز مستيقظاً.",
  "power.lid.master.title": "تنفيذ الإجراءات عند إغلاق الغطاء",
  "power.lid.master.help": "المفتاح الرئيسي. إيقافه يعني ألا يعمل أي شيء أدناه.",
  "power.lid.display.title": "إطفاء الشاشة",
  "power.lid.display.help":
    "يضع الشاشة في وضع السكون. يُحفظ السطوع ويُستعاد إذا كانت أداة السطوع المجانية مثبتة.",
  "power.lid.freeze.title": "تجميد تطبيقات المحادثة",
  "power.lid.freeze.help":
    "يوقف تطبيقات المحادثة المختارة مؤقتاً كي لا تستهلك الطاقة ثم يستأنفها. لا يحدث أبداً أثناء اجتماع أو تسجيل أو إملاء، ولا لوحدات الطرفية أو المحررات أو وكلاء البرمجة العاملة.",
  "power.lid.freeze.apps": "التطبيقات المراد تجميدها",
  "power.lid.mute.title": "كتم الصوت",
  "power.lid.mute.help": "يكتم خرج الصوت ويستعيده تماماً كما كان، حتى لو بدّلت الخرج في الأثناء.",
  "power.lid.lowPower.title": "وضع الطاقة المنخفضة",
  "power.lid.lowPower.help":
    "يشغّل وضع الطاقة المنخفضة. يحتاج إلى المساعد المميز الاختياري؛ وبدونه يُتجاوز.",
  "power.lid.docker.title": "تجميد Docker Desktop",
  "power.lid.docker.help":
    "يوقف Docker Desktop مؤقتاً ما دامت لا توجد حاويات قيد التشغيل. لا يحدث أبداً إذا كانت حاوية تعمل أو كانت حالة Docker مجهولة.",
  "power.lid.nap.title": "إبعاد تطبيقات الوكلاء عن App Nap",
  "power.lid.nap.help":
    "يمنع macOS من إبطاء التطبيقات التي تدرجها. يُحفظ إعدادها السابق ويُعاد كما كان تماماً.",
  "power.lid.nap.apps": "التطبيقات (معرّفات الحزمة، مثل com.example.App)",
  "power.lid.protected.title": "لا تُجمَّد أبداً",
  "power.lid.protected.help":
    "تُترك هذه دائماً. يمكنك الإضافة إلى القائمة لكن لا يمكن إزالة الحمايات المضمنة.",
  "power.lid.protected.builtIn": "مضمّنة",
  "power.lid.protected.extra": "أضف اسم برنامج أو تطبيق",
  "power.lid.list.empty": "لم تتم إضافة شيء.",
  "power.lid.list.remove": "إزالة {item}",
  "power.lid.list.duplicate": "هذا موجود في القائمة بالفعل.",
  "power.lid.list.full": "القائمة ممتلئة ({max} إدخالاً).",
  "power.lid.invalid.bundle":
    "استخدم معرّف حزمة مثل com.example.App: أحرف وأرقام وشرطات، مع نقطة واحدة على الأقل.",
  "power.lid.invalid.name": "استخدم اسم برنامج أو تطبيق بسيطاً: أحرف وأرقام ومسافات و . _ + -",
  "power.lid.unsupported": "غير متاح هنا: {reason}",
  "power.lid.gapNote":
    "بعضها يعمل جزئياً فقط على هذا الكمبيوتر. راجع README-lid.md لمعرفة المدعوم وغير المدعوم.",
  "power.lid.last.title": "آخر حدث للغطاء",
  "power.lid.last.closed": "أُغلق الغطاء في {time}.",
  "power.lid.last.opened": "فُتح الغطاء في {time}.",
  "power.lid.last.none": "لم يحدث شيء بعد.",
  "power.lid.last.mismatched":
    "{count, plural, other {لم تُستأنف # عملية لأنها لم تعد تطابق ما جمّده Phoenix.}}",
  "power.lid.last.stillClosed": "الغطاء مغلق الآن والإجراءات أعلاه مطبّقة.",
  "power.lid.outcome.applied": "تم",
  "power.lid.outcome.skipped": "تم تخطيه",
  "power.lid.outcome.failed": "فشل",
  "power.lid.outcome.undone": "تم التراجع",
  "power.lid.outcome.undo_failed": "تعذّر التراجع (سيحاول Phoenix مجدداً)",
  "power.lid.reason.unsupported_platform": "مدعوم على Mac فقط.",
  "power.lid.reason.helper_unavailable": "المساعد المميز غير مثبّت.",
  "power.lid.reason.tool_missing": "أداة لازمة غير مثبّتة.",
  "power.lid.reason.already_on": "مفعّل بالفعل لسبب آخر.",
  "power.lid.reason.state_unknown":
    "لا يستطيع Phoenix معرفة ما إذا كنت في اجتماع، لذلك لم يفعل شيئاً.",
  "power.lid.reason.protected_state": "اجتماع أو تسجيل أو إملاء جارٍ.",
  "power.lid.reason.docker_busy": "هناك حاوية قيد التشغيل.",
  "power.lid.reason.docker_unknown": "حالة Docker مجهولة.",
  "power.lid.reason.process_list_unavailable": "تعذّرت قراءة قائمة البرامج العاملة.",
  "power.lid.reason.audio_unavailable": "تعذّرت قراءة مخارج الصوت.",
  "power.lid.reason.no_targets": "لم يكن هناك ما يُغيَّر.",
  "power.lid.reason.nothing_to_do": "لم يكن هناك ما يُغيَّر.",
  "power.lid.reason.journal_unwritable": "تعذّرت كتابة سجل الاسترداد، لذلك لم يتغير شيء.",
  "power.lid.reason.not_applied": "لم يتغير شيء.",
  "power.lid.reason.apply_failed": "تعذّر إجراء التغيير.",
  "power.lid.reason.undo_failed": "تعذّر التراجع عن التغيير.",
  "power.lid.reason.assertions_unknown":
    "لا يستطيع Phoenix معرفة ما إذا كان تطبيق في مكالمة، لذلك لم يجمّد شيئًا.",
  "power.lid.reason.holds_assertion":
    "جميع تطبيقات الدردشة قيد الاستخدام (مكالمة أو تشغيل)، لذلك لم يُجمَّد أي منها.",
  "power.lid.reason.output_changed":
    "تم تبديل خرج الصوت أثناء إغلاق الغطاء، لذلك لم يلمس Phoenix الخرج الجديد. يبقى الخرج الذي كتمه مكتومًا حتى يصبح الافتراضي مرة أخرى.",
  "power.lid.reason.retry_or_alert":
    "يبدو أن تطبيقًا مجمّدًا أُعيد تشغيله، لذلك لم يستأنفه Phoenix. تحقق من أن تطبيقات الدردشة تعمل بشكل طبيعي.",
  "power.lid.reason.not_ours": "تعذّر استئناف بعض العمليات لأنها ليست من صلاحية Phoenix.",
  "power.lid.limit.output_identity_unknown":
    "لا يستطيع Phoenix قراءة اسم خرج الصوت، لذلك لا يعرف ما إذا كان قد تغيّر.",
  "power.lid.limit.brightness_tool_untrusted":
    "ملف أداة السطوع غير آمن (مالك خاطئ أو قابل للكتابة من الآخرين)، لذلك لم يُستخدم.",
  "power.lid.reason.other": "لم تنجح العملية.",
  "power.lid.limit.brightness_tool_missing":
    "أداة السطوع المجانية غير مثبّتة، لذلك يُستخدم سكون الشاشة فقط ولا يتغير السطوع.",
  "power.lid.limit.keyboard_backlight_unsupported":
    "لا يمكن التحكم في إضاءة لوحة المفاتيح دون برنامج من جهة خارجية.",
  "power.lid.limit.default_output_only": "يمكن كتم خرج الصوت الافتراضي الحالي فقط.",
  "power.lid.applyNote":
    "تسري التغييرات عندما ترى الجلسة التالية إغلاق الغطاء. كل شيء يُسجَّل في السجل قبل تنفيذه.",
  "power.lid.saved": "تم الحفظ.",
  "power.lid.glance.closed": "الغطاء مغلق: إجراءات الإغلاق مطبّقة.",
  "power.lid.glance.failed":
    "تعذّر التراجع عن أحد إجراءات إغلاق الغطاء. افتح إبقاء الجهاز مستيقظاً للتفاصيل.",
};
