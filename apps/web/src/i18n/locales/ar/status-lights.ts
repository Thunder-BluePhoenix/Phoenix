// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { statusLights as enStatusLights } from "../../en/status-lights";

/** Machine-translated; unreviewed. */
export const statusLights: Record<keyof typeof enStatusLights, string> = {
  "statusLights.limits":
    "تُرسَل ألوان ثابتة فقط، ولا يُرسَل أي نص أبدًا. بيانات الاعتماد (مفتاح تطبيق Hue، ورمز Luxafor) للكتابة فقط: بعد حفظها لا تُعرَض مرة أخرى. تُعرَض الأسماء والمعرّفات التي يبلغ عنها الضوء كنص عادي.",
  "statusLights.line.luxafor": "تطبيق Luxafor على {address}",
  "statusLights.line.hue": "ضوء Hue على الجسر {bridge}",

  "statusLights.error.unavailable":
    "ليس لدى Phoenix Core هذا مخزن بيانات اعتماد لنظام التشغيل، لذا لا يمكن الاحتفاظ ببيانات الاعتماد.",
  "statusLights.error.save": "تعذّر حفظ قائمة الأضواء. تحقق من الاسم والعنوان.",
  "statusLights.error.capability": "تعذّر تغيير إعداد أضواء الحالة.",
  "statusLights.error.hueName": "أعطِ الجسر اسمًا من الحروف والأرقام و . _ : - (حتى 160 حرفًا).",
  "statusLights.error.hueInspect":
    "لم يستجب الجسر على هذا العنوان. استخدم عنوان IPv4 الخاص به على شبكتك.",
  "statusLights.error.huePair":
    "فشل الاقتران. اضغط على زر الربط المستدير في الجسر ثم حاول مرة أخرى.",
  "statusLights.error.hueRemove": "تعذّرت إزالة الجسر.",
  "statusLights.error.hueLights": "تعذّر سرد الأضواء على هذا الجسر.",
  "statusLights.error.luxaforToken":
    "لم يُحفَظ الرمز. يجب أن يتكوّن من 1 إلى 128 حرفًا قابلًا للطباعة دون مسافات.",
  "statusLights.error.lifx": "لم يكتمل اكتشاف LIFX. انتظر بضع ثوانٍ وحاول مرة أخرى.",
  "statusLights.error.quietInvalid": "أدخل وقتين ومنطقة زمنية حقيقية، مثل Europe/Paris.",

  "statusLights.hue.title": "Philips Hue",
  "statusLights.hue.notAvailable":
    "Hue غير متاح: ليس لدى Phoenix Core هذا مخزن بيانات اعتماد لنظام التشغيل.",
  "statusLights.hue.loadFailed": "تعذّر تحميل جسور Hue.",
  "statusLights.hue.intro":
    "لا يكون الجسر المقترن موثوقًا إلا ما دام يقدّم الشهادة التي أكدت بصمة SHA-256 الخاصة بها. يُحفَظ مفتاح تطبيقه في مخزن بيانات اعتماد نظام التشغيل لديك ولا يُعرَض أبدًا.",
  "statusLights.hue.empty": "لا يوجد جسر مقترن.",
  "statusLights.hue.bridgeLine": "على {address}:{port}",
  "statusLights.hue.fingerprint": "بصمة SHA-256:",
  "statusLights.hue.find": "عرض الأضواء",
  "statusLights.hue.findNamed": "عرض الأضواء على الجسر {name}",
  "statusLights.hue.remove": "إزالة الجسر",
  "statusLights.hue.removeNamed": "إزالة الجسر {name}",
  "statusLights.hue.removeNote":
    "تؤدي إزالة الجسر إلى حذف مفتاحه المخزَّن. ولا يُتصل بعد ذلك بالأضواء التي تستخدمه.",
  "statusLights.hue.noLights": "لم يبلغ هذا الجسر عن أي أضواء.",
  "statusLights.hue.alreadyAdded": "تمت الإضافة",
  "statusLights.hue.add": "إضافة",
  "statusLights.hue.addNamed": "إضافة ضوء Hue {name}",
  "statusLights.hue.pairTitle": "اقتران جسر",
  "statusLights.hue.name": "اسم هذا الجسر",
  "statusLights.hue.address": "عنوان الجسر على شبكتك (مثل 192.168.1.2)",
  "statusLights.hue.lookup": "قراءة شهادة الجسر",
  "statusLights.hue.confirmGroup": "تأكيد شهادة الجسر",
  "statusLights.hue.found": "استجاب جسر على {address}:{port}.",
  "statusLights.hue.certName": "موضوع الشهادة: {name}",
  "statusLights.hue.linkStep":
    "اضغط الآن على زر الربط المستدير أعلى الجسر، ثم أكّد أدناه. يُرفَض الاقتران ما لم يكن الزر قد ضُغط خلال الثواني الثلاثين الأخيرة تقريبًا.",
  "statusLights.hue.confirm":
    "قارنت هذه البصمة بالبصمة الموجودة على الجسر الخاص بي، وأثق بهذا الجسر.",
  "statusLights.hue.pair": "اقتران وتثبيت هذه البصمة",
  "statusLights.hue.cancel": "إلغاء",

  "statusLights.luxafor.title": "Luxafor",
  "statusLights.luxafor.intro":
    "يتواصل Phoenix فقط مع خطاف الويب المحلي لتطبيق Luxafor، عبر HTTP العادي على شبكتك. يردّ التطبيق بالنجاح أيًّا كان الرمز، لذا فإن حفظ الرمز لا يثبت أن الضوء تغيّر.",
  "statusLights.luxafor.name": "اسم ضوء Luxafor هذا",
  "statusLights.luxafor.address": "عنوان الحاسوب الذي يشغّل تطبيق Luxafor",
  "statusLights.luxafor.add": "إضافة ضوء Luxafor",
  "statusLights.luxafor.token": "رمز خطاف الويب",
  "statusLights.luxafor.tokenNamed": "رمز خطاف الويب لـ {name}",
  "statusLights.luxafor.save": "تعيين الرمز أو استبداله",
  "statusLights.luxafor.saved": "تم حفظ الرمز.",
  "statusLights.luxafor.writeOnly": "لا يُعرَض الرمز مرة أخرى. لمسحه، أزل هذا الضوء.",

  "statusLights.lifx.title": "LIFX",
  "statusLights.lifx.intro":
    "يرسل الاكتشاف بثًّا واحدًا على شبكتك ويسرد الأضواء التي تستجيب. لا تتم إضافة شيء ولا يُرسَل أي لون حتى تفعّل ضوءًا.",
  "statusLights.lifx.discover": "البحث عن أضواء LIFX",
  "statusLights.lifx.none": "لم يستجب أي ضوء LIFX.",
  "statusLights.lifx.line": "ضوء LIFX {serial} على {address}",
  "statusLights.lifx.added": "تمت الإضافة",
  "statusLights.lifx.enable": "إضافة هذا الضوء",
  "statusLights.lifx.enableNamed": "إضافة ضوء LIFX {serial}",

  "statusLights.quiet.title": "ساعات الهدوء",
  "statusLights.quiet.intro":
    "تبقى الأضواء مطفأة بين هذين الوقتين، في المنطقة الزمنية التي تختارها.",
  "statusLights.quiet.off": "ساعات الهدوء متوقفة.",
  "statusLights.quiet.on": "الأضواء مطفأة من {start} إلى {end} ({timezone}).",
  "statusLights.quiet.start": "من",
  "statusLights.quiet.end": "حتى",
  "statusLights.quiet.timezone": "المنطقة الزمنية",
  "statusLights.quiet.save": "حفظ ساعات الهدوء",
  "statusLights.quiet.clear": "إيقاف ساعات الهدوء",
};
