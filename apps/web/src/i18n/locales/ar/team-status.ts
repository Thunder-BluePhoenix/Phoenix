// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamStatus as enTeamStatus } from "../../en/team-status";

/** Machine-translated; unreviewed. */
export const teamStatus: Record<keyof typeof enTeamStatus, string> = {
  "teamStatus.title": "حضور الفريق",
  "teamStatus.intro":
    "حضور الفريق متوقف افتراضيًا. عند تشغيله يرسل Phoenix فقط أنواع الحالة التي تحددها (نشر، تشغيل وكيل، اجتماع) في إطار مشفّر إلى زملاء الفريق الذين أضفتهم، ولا يذكر أبدًا مستودعًا أو فرعًا أو شخصًا.",
  "teamStatus.notAvailable":
    "حضور الفريق غير متاح: لا يوجد في Phoenix Core هذا مخزن أسرار لنظام التشغيل لحفظ مفتاحك.",
  "teamStatus.loadFailed": "تعذّر تحميل حضور الفريق.",
  "teamStatus.listSeparator": "، ",
  "teamStatus.kind.deploying": "ينشر",
  "teamStatus.kind.agentRun": "يشغّل وكيلًا",
  "teamStatus.kind.meeting": "في اجتماع",
  "teamStatus.relay.label": "عنوان المُرحِّل",
  "teamStatus.route.label": "المسار (اختياري)",
  "teamStatus.route.hint":
    "اترك المسار فارغًا لبدء فريق جديد. الصق مسارًا هنا للانضمام إلى فريق زميلك نفسه.",
  "teamStatus.route.shown": "مسار المُرحِّل",
  "teamStatus.turnOn": "تشغيل",
  "teamStatus.resume": "إعادة التشغيل",
  "teamStatus.pause": "إيقاف مؤقت",
  "teamStatus.leave": "مغادرة الفريق",
  "teamStatus.leave.ask": "مغادرة الفريق ونسيان الجميع؟",
  "teamStatus.state.line": "الاتصال: {state}",
  "teamStatus.state.connected": "متصل",
  "teamStatus.state.connecting": "جارٍ الاتصال",
  "teamStatus.state.paused": "متوقف مؤقتًا",
  "teamStatus.lastError": "آخر خطأ: {error}",
  "teamStatus.self.id": "معرّف فريقك",
  "teamStatus.self.publicKey": "مفتاحك العام",
  "teamStatus.self.hint":
    "أعطِ كليهما لزميل ليتمكن من إضافتك. مفتاحك الخاص لا يغادر هذا الحاسوب أبدًا.",
  "teamStatus.sharing.title": "ما أشاركه",
  "teamStatus.sharing.master": "شارك حالتي مع فريقي",
  "teamStatus.sharing.deploying": "نشر",
  "teamStatus.sharing.agentRun": "تشغيل وكيل لفترة طويلة",
  "teamStatus.sharing.meeting": "في اجتماع",
  "teamStatus.outgoing.now": "يرى الزملاء الآن: {kinds}.",
  "teamStatus.outgoing.none": "لا يرى الزملاء شيئًا منك الآن.",
  "teamStatus.members.title": "الزملاء",
  "teamStatus.members.none": "لم تضف أي زميل بعد.",
  "teamStatus.members.removeLabel": "إزالة {label}",
  "teamStatus.members.id": "معرّف فريق الزميل",
  "teamStatus.members.label": "الاسم المعروض",
  "teamStatus.members.add": "إضافة زميل",
  "teamStatus.presence.title": "من حولك",
  "teamStatus.presence.none": "لا يوجد زملاء للعرض.",
  "teamStatus.presence.nothing": "لا شيء مشترك",
};
