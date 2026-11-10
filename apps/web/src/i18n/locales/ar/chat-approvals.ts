// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { chatApprovals as enChatApprovals } from "../../en/chat-approvals";

/** Machine-translated; unreviewed. */
export const chatApprovals: Record<keyof typeof enChatApprovals, string> = {
  "chatApprovals.title": "الموافقات عبر الدردشة",
  "chatApprovals.notAvailable": "الموافقات عبر الدردشة غير متاحة في هذا Phoenix Core.",
  "chatApprovals.intro":
    "أجب عن موافقة معلّقة لوكيل أو لـ Phoenix من Slack أو Discord، وتلقَّ إشعارًا في Teams. كل شيء معطّل حتى تفعّله هنا، لكل مزوّد ولكل مشروع.",
  "chatApprovals.limits":
    "لم يُستخدم قط مع مساحة عمل حقيقية في Slack أو Discord أو Teams: اختُبرت الشيفرة بعمليات استدعاء محاكاة فقط. Teams للإشعارات فقط (رابط إلى Phoenix، وليس زر سماح أبدًا). يُتحقق من الضغط على الزر بتوقيع المزوّد وقائمة المعتمدين لديك، ويُدقَّق القرار.",
  "chatApprovals.noDm":
    "تذهب الملخصات والإشعارات إلى القناة المحددة أدناه فقط. الرسائل المباشرة إلى شخص غير مبنية.",
  "chatApprovals.capabilityOff": "قدرة الموافقات عبر الدردشة معطّلة، لذلك لا يُرسل شيء.",
  "chatApprovals.enable": "تفعيل القدرة",
  "chatApprovals.ready": "جاهز: يمكن لهذا المزوّد نشر البطاقات.",
  "chatApprovals.notReady":
    "غير جاهز: يجب تفعيله مع معرّف مساحة العمل ومعرّف القناة ومعتمِد واحد على الأقل.",
  "chatApprovals.teamsNote": "Teams للإشعارات فقط. عنوان خطاف الويب ومفتاح الرابط محفوظان أدناه.",
  "chatApprovals.save": "حفظ الموافقات عبر الدردشة",
  "chatApprovals.saved": "تم الحفظ.",
  "chatApprovals.provider.slack": "Slack",
  "chatApprovals.provider.discord": "Discord",
  "chatApprovals.provider.teams": "Microsoft Teams",
  "chatApprovals.enabledNamed": "تفعيل {name}",
  "chatApprovals.notifyNamed": "إرسال إشعار عام على {name}",
  "chatApprovals.digestNamed": "تضمين {name} في الملخصات",
  "chatApprovals.notify": "إشعار (دون تفاصيل) للطلبات غير المفعّلة",
  "chatApprovals.digest.send": "استلام الملخص",
  "chatApprovals.workspace.slack": "معرّف مساحة عمل Slack (الفريق)",
  "chatApprovals.workspace.discord": "معرّف خادم Discord (guild)",
  "chatApprovals.channel.slack": "معرّف قناة Slack",
  "chatApprovals.channel.discord": "معرّف قناة Discord",
  "chatApprovals.approvers.label": "معرّفات مستخدمي {name} المسموح لهم بالقرار (واحد في كل سطر)",
  "chatApprovals.approvers.hint":
    "أحرف وأرقام فقط، حتى 24 حرفًا لكل معرّف، وبحد أقصى 20. القائمة الفارغة تعني أن لا أحد يستطيع القرار.",
  "chatApprovals.projects.title": "المشاريع المسموح بها",
  "chatApprovals.projects.hint":
    "يمكن الرد من الدردشة فقط على موافقات الوكلاء من هذه المشاريع. فارغ: لا شيء.",
  "chatApprovals.projects.label": "أسماء المشاريع (اسم في كل سطر)",
  "chatApprovals.digest.title": "الملخص المجدول",
  "chatApprovals.digest.intro":
    "معطّل افتراضيًا. يرسل أعدادًا ومعرّفات موافقة قصيرة إلى القناة أعلاه، فقط للمزوّدين الذين يستلمون الملخص، وليس أثناء الساعات الهادئة وليس إذا لم يحدث شيء.",
  "chatApprovals.digest.enabled": "إرسال ملخص مجدول",
  "chatApprovals.digest.interval": "الدقائق بين الملخصات",
  "chatApprovals.digest.hint": "من {min} (ساعة) إلى {max} دقيقة (أسبوع).",
  "chatApprovals.cred.title": "بيانات الاعتماد",
  "chatApprovals.cred.writeOnly":
    "للكتابة فقط. ما تكتبه يُرسل إلى مخزن بيانات اعتماد Core ويُزال من هذه الصفحة فورًا. القيم المحفوظة لا تُعرض مرة أخرى.",
  "chatApprovals.cred.save": "حفظ",
  "chatApprovals.cred.stored": "مخزّن",
  "chatApprovals.cred.notStored": "غير مخزّن",
  "chatApprovals.cred.remove": "إزالة",
  "chatApprovals.cred.removeNamed": "إزالة {name} المخزّن",
  "chatApprovals.field.slackBot": "رمز بوت Slack",
  "chatApprovals.field.slackSigning": "سر توقيع Slack",
  "chatApprovals.field.discordBot": "رمز بوت Discord",
  "chatApprovals.field.discordKey": "المفتاح العام لتطبيق Discord",
  "chatApprovals.field.teamsWebhook": "عنوان خطاف ويب Teams",
  "chatApprovals.field.teamsKey": "مفتاح رابط Teams",
  "chatApprovals.error.ids": "معرّفات مساحة العمل والقناة أحرف وأرقام فقط، حتى 24 حرفًا.",
  "chatApprovals.error.approvers":
    "معرّفات المعتمدين أحرف وأرقام فقط، حتى 24 حرفًا لكل معرّف، وبحد أقصى 20.",
  "chatApprovals.error.projects":
    "يجب أن تكون أسماء المشاريع من 1 إلى 120 حرفًا مرئيًا، وبحد أقصى 200 مشروع.",
  "chatApprovals.error.interval": "يجب أن تكون فترة الملخص عددًا صحيحًا من 60 إلى 10080 دقيقة.",
  "chatApprovals.error.save": "تعذّر حفظ إعداد الموافقات عبر الدردشة.",
  "chatApprovals.error.capability": "تعذّر تغيير قدرة الموافقات عبر الدردشة.",
  "chatApprovals.error.unavailable":
    "لا يملك Phoenix Core هذا مخزنًا لبيانات اعتماد نظام التشغيل، لذلك لا يمكن الاحتفاظ ببيانات الاعتماد.",
  "chatApprovals.error.cred": "لم تُحفظ بيانات الاعتماد أو لم تُزل.",
  "chatApprovals.error.credShape":
    "لا تبدو هذه القيمة صحيحة لهذا الحقل، لذلك لم تُرسل. راجعها وحاول مرة أخرى.",
};
