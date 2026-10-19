// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { shell as enShell } from "../../en/shell";

/** Machine-translated; unreviewed (see ../../README.md). */
export const shell: Record<keyof typeof enShell, string> = {
  "shell.nav.home": "الصفحة الرئيسية لـ Phoenix",
  "shell.nav.main": "الرئيسية",
  "shell.nav.meetings": "الاجتماعات",
  "shell.nav.provenance": "المصدر والأصل",
  "shell.nav.agents": "الوكلاء",
  "shell.nav.workflows": "سير العمل",
  "shell.nav.recap": "الملخص",
  "shell.nav.settings": "الإعدادات",
  "shell.nav.recording": "يسجّل",
  "shell.app.skipToContent": "انتقل إلى المحتوى",
  "shell.app.tagline": "Phoenix هو المنصة. Fawkes هو الرفيق.",
  "shell.app.noToken": "ليس لهذه الصفحة رمز جلسة. افتح Phoenix من العنوان الذي يطبعه {command}.",
  "shell.app.hint": "انقر على Fawkes في الشريط العلوي لترى ما يفعله Phoenix.",
  "shell.language.title": "اللغة",
  "shell.language.label": "لغة الواجهة",
  "shell.language.available":
    "{count, plural, zero {لا توجد لغات متاحة.} one {تتوفر لغة واحدة.} two {تتوفر لغتان.} few {تتوفر # لغات.} many {تتوفر # لغة.} other {تتوفر # لغة.}}",
  "shell.language.machineNote":
    "النصوص بغير الإنجليزية مترجمة آليًا ولم يراجعها ناطقون أصليون بعد.",
  "shell.language.saved": "تم تغيير اللغة.",
  "shell.language.failed": "تعذّر حفظ اللغة. حاول مرة أخرى.",

  "shell.palette.title": "لوحة الأوامر",
  "shell.palette.inputLabel": "ابحث في الأوامر",
  "shell.palette.placeholder": "اكتب أمرًا…",
  "shell.palette.results": "الأوامر",
  "shell.palette.hint": "السهمان للأعلى وللأسفل للاختيار، وEnter للتنفيذ، وEscape للإغلاق.",
  "shell.palette.count":
    "{count, plural, zero {لا أوامر} one {أمر واحد} two {أمران} few {# أوامر} many {# أمرًا} other {# أمر}}",
  "shell.palette.empty": "لا يوجد أمر يطابق “{query}”.",

  "shell.cmd.palette.open": "فتح لوحة الأوامر",
  "shell.cmd.nav.home": "الانتقال إلى الصفحة الرئيسية",
  "shell.cmd.nav.meetings": "الانتقال إلى الاجتماعات",
  "shell.cmd.nav.provenance": "الانتقال إلى المصدر والأصل",
  "shell.cmd.nav.agents": "الانتقال إلى الوكلاء",
  "shell.cmd.nav.workflows": "الانتقال إلى سير العمل",
  "shell.cmd.nav.recap": "الانتقال إلى الملخص",
  "shell.cmd.nav.settings": "الانتقال إلى الإعدادات",
  "shell.cmd.settings.language": "فتح الإعدادات: اللغة",
  "shell.cmd.panel.overview": "لوحة Fawkes: نظرة عامة",
  "shell.cmd.panel.chat": "لوحة Fawkes: الدردشة",
  "shell.cmd.panel.activity": "لوحة Fawkes: النشاط",
  "shell.cmd.panel.capabilities": "لوحة Fawkes: القدرات",
  "shell.cmd.panel.memory": "لوحة Fawkes: الذاكرة",
  "shell.cmd.panel.wardrobe": "فتح خزانة الملابس",
  "shell.cmd.demo.start": "بدء العرض التجريبي",
  "shell.cmd.demo.stop": "إيقاف العرض التجريبي",
  "shell.cmd.mute.toggle": "كتم الأصوات والإشعارات أو إلغاء كتمها",

  "shell.shortcuts.title": "الاختصارات العامة",
  "shell.shortcuts.desktopOnly":
    "الاختصارات العامة ميزة في تطبيق Phoenix لسطح المكتب. وهي غير متاحة في المتصفح.",
  "shell.shortcuts.intro":
    "تعمل الاختصارات العامة من أي تطبيق ما دام تطبيق Phoenix لسطح المكتب قيد التشغيل.",
  "shell.shortcuts.loading": "جارٍ تحميل الاختصارات…",
  "shell.shortcuts.loadFailed": "تعذّرت قراءة الاختصارات من تطبيق سطح المكتب.",
  "shell.shortcuts.enable": "تفعيل الاختصارات العامة",
  "shell.shortcuts.warning":
    "تحذير: عند تفعيل الاختصارات العامة، يسحب كل اختصار تركيبة مفاتيحه من كل التطبيقات الأخرى. وهي معطّلة حتى تفعّلها. يحتاج كل اختصار إلى مفتاحَي تعديل على الأقل (Ctrl أو Alt أو Shift أو Cmd)، فلا يتعارض مع الكتابة العادية.",
  "shell.shortcuts.mute": "كتم الأصوات والإشعارات",
  "shell.shortcuts.muteHelp": "لا يزال Fawkes يعرض ما يفعله؛ يُكتم فقط صوته وفقاعات إشعاراته.",
  "shell.shortcuts.list": "إجراءات الاختصارات",
  "shell.shortcuts.action.open_chat": "فتح الدردشة",
  "shell.shortcuts.action.jump_to_alert": "الانتقال إلى التنبيه",
  "shell.shortcuts.action.jump_to_terminal": "الانتقال إلى الطرفية",
  "shell.shortcuts.action.switch_pills": "تبديل الشارات",
  "shell.shortcuts.action.mute": "كتم الأصوات والإشعارات",
  "shell.shortcuts.action.send_to_desktop": "إرسال Fawkes إلى سطح المكتب",
  "shell.shortcuts.action.wardrobe": "فتح خزانة الملابس",
  "shell.shortcuts.binding.none": "غير محدد",
  "shell.shortcuts.default": "الافتراضي: {keys}",
  "shell.shortcuts.state.active": "نشط",
  "shell.shortcuts.state.off": "غير نشط: الاختصارات العامة معطّلة",
  "shell.shortcuts.state.unbound": "غير نشط: لم تُحدَّد تركيبة مفاتيح",
  "shell.shortcuts.state.rejected": "غير نشط: تركيبة المفاتيح هذه غير مسموح بها",
  "shell.shortcuts.state.unavailable":
    "غير نشط: قد يكون تطبيق آخر يستخدم تركيبة المفاتيح هذه، أو أن النظام لا يسمح بها",
  "shell.shortcuts.changeFor": "تغيير اختصار {action}",
  "shell.shortcuts.capture": "اضغط تركيبة المفاتيح الجديدة",
  "shell.shortcuts.captureFor": "تركيبة مفاتيح جديدة لـ {action}",
  "shell.shortcuts.captureHelp": "اضغط المفاتيح معًا. يلغي Escape العملية.",
  "shell.shortcuts.resetFor": "إعادة اختصار {action} إلى قيمته الافتراضية",
  "shell.shortcuts.resetAll": "إعادة تعيين كل الاختصارات",
  "shell.shortcuts.saved": "اختصار {action} هو الآن {keys}.",
  "shell.shortcuts.resetDone": "تمت إعادة تعيين اختصار {action}.",
  "shell.shortcuts.resetAllDone": "تمت إعادة تعيين كل الاختصارات.",
  "shell.shortcuts.reason.invalid": "هذا اختصار غير صالح.",
  "shell.shortcuts.reason.unsupportedKey":
    "لا يمكن استخدام هذا المفتاح. استخدم حرفًا أو رقمًا أو مفتاح F أو مفتاح سهم مع مفاتيح التعديل.",
  "shell.shortcuts.reason.needs_modifiers":
    "يحتاج الاختصار إلى مفتاحَي تعديل على الأقل (Ctrl أو Alt أو Shift أو Cmd) حتى لا يعترض الكتابة العادية.",
  "shell.shortcuts.reason.needs_third_modifier":
    "يكتب Ctrl+Alt وAlt+Shift مع حرف أو رقم رموزًا على كثير من لوحات المفاتيح (AltGr أو Option). أضف مفتاح تعديل ثالثًا.",
  "shell.shortcuts.reason.reserved": "النظام يستخدم تركيبة المفاتيح هذه بالفعل.",
  "shell.shortcuts.reason.dictation_chord":
    "تُستخدم تركيبة المفاتيح هذه في الإملاء الصوتي (اللصق مرة أخرى).",
  "shell.shortcuts.reason.conflict": "اختصار آخر في Phoenix يستخدم تركيبة المفاتيح هذه بالفعل.",
  "shell.shortcuts.reason.unavailable":
    "لم يسجّل النظام تركيبة المفاتيح هذه. قد يكون تطبيق آخر يستخدمها بالفعل.",
  "shell.shortcuts.reason.forbidden": "لا يمكن لهذه النافذة تغيير الاختصارات.",
  "shell.shortcuts.reason.unknown_action": "هذا ليس إجراء اختصار.",
  "shell.shortcuts.reason.unknown": "تعذّر تغيير الاختصار.",
};
