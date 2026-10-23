// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { mission as enmission } from "../../en/mission";

/** Machine-translated; unreviewed (see ../../README.md). */
export const mission: Record<keyof typeof enmission, string> = {
  "mission.title": "मिशन कंट्रोल",
  "mission.nav": "मिशन",
  "mission.note":
    "टोकन और लागत वही हैं जो एजेंट खुद रिपोर्ट करते हैं। इन्हें प्रदाता के बिल से सत्यापित नहीं किया गया है।",
  "mission.sourceMissing":
    "कुछ एजेंट सत्र अभी पढ़े नहीं जा सके (एजेंट क्षमता बंद है या जवाब नहीं दे रही), इसलिए बोर्ड में कुछ सत्र छूट सकते हैं।",
  "mission.refresh": "रीफ़्रेश करें",
  "mission.loadFailed": "मिशन कंट्रोल लोड नहीं हो सका।",

  "mission.filter.search": "सत्र खोजें",
  "mission.filter.searchPlaceholder": "एजेंट, प्रोजेक्ट या सत्र आईडी",
  "mission.filter.agent": "एजेंट",
  "mission.filter.project": "प्रोजेक्ट",
  "mission.filter.state": "स्थिति",
  "mission.filter.all": "सभी",
  "mission.filter.clear": "फ़िल्टर हटाएँ",

  "mission.state.working": "काम कर रहा है",
  "mission.state.waiting": "आपका इंतज़ार",
  "mission.state.finished": "पूरा हुआ",
  "mission.state.stuck": "अटका हुआ",
  "mission.reason.permission": "आपकी अनुमति चाहिए",
  "mission.reason.input": "आपसे एक सवाल है",
  "mission.reason.idle": "प्रॉम्प्ट पर निष्क्रिय",
  "mission.stuck.noReport": "ठहराव की सीमा से अधिक समय से कोई रिपोर्ट नहीं",
  "mission.stuck.safetyStall": "सुरक्षा जाल ने इसे ठप के रूप में चिह्नित किया",

  "mission.board.title": "सत्र",
  "mission.board.empty": "दिखाने के लिए कोई एजेंट सत्र नहीं है।",
  "mission.board.noMatch": "कोई सत्र फ़िल्टर से मेल नहीं खाता।",
  "mission.column.count": "{count, plural, one {# सत्र} other {# सत्र}}",
  "mission.column.empty": "कोई नहीं",

  "mission.card.open": "विवरण",
  "mission.card.focus": "टर्मिनल पर जाएँ",
  "mission.card.focused": "टर्मिनल विंडो को सबसे आगे लाया गया।",
  "mission.card.unnamedProject": "अज्ञात प्रोजेक्ट",
  "mission.card.tokens": "{input} इनपुट, {output} आउटपुट",
  "mission.card.noTokens": "टोकन की गिनती रिपोर्ट नहीं हुई",
  "mission.card.cost": "लागत {cost}",
  "mission.card.costPartial": "लागत {cost} या अधिक (कुछ उपयोग की लागत ज्ञात नहीं)",
  "mission.card.costUnknown": "लागत अज्ञात",
  "mission.card.lastSeen": "आख़िरी बार सुना गया: {ago}",
  "mission.card.steps": "{count, plural, one {# चरण} other {# चरण}}",

  "mission.totals.title": "टोकन और लागत",
  "mission.totals.window": "पिछले {days, plural, one {# दिन} other {# दिन}}",
  "mission.totals.input": "इनपुट टोकन",
  "mission.totals.output": "आउटपुट टोकन",
  "mission.totals.cost": "लागत",
  "mission.totals.unknown": "अज्ञात",
  "mission.totals.partial": "{cost} या अधिक",
  "mission.totals.unpriced":
    "इनके लिए कीमत तय नहीं है: {models}। इनकी लागत अज्ञात है, शून्य नहीं। लागत देखने के लिए नीचे कीमत जोड़ें।",
  "mission.totals.empty": "इस अवधि में किसी एजेंट ने टोकन या लागत रिपोर्ट नहीं की।",

  "mission.by.day": "दिन के अनुसार",
  "mission.by.agent": "एजेंट के अनुसार",
  "mission.by.project": "प्रोजेक्ट के अनुसार",
  "mission.by.session": "सत्र के अनुसार",
  "mission.col.day": "दिन",
  "mission.col.agent": "एजेंट",
  "mission.col.project": "प्रोजेक्ट",
  "mission.col.session": "सत्र",
  "mission.col.input": "इनपुट",
  "mission.col.output": "आउटपुट",
  "mission.col.cost": "लागत",

  "mission.budgets.title": "बजट",
  "mission.budgets.note":
    "सीमा पूरी होने से पहले, उसके {thresholds} पर, हर बजट के लिए दिन में एक बार अलर्ट आता है। लागत बजट केवल उसी उपयोग को गिनते हैं जिसकी लागत ज्ञात है।",
  "mission.budgets.none": "अभी कोई बजट नहीं है।",
  "mission.budgets.line": "{scope}, {metric}{agent}: {limit} में से {used} ({pct}%)",
  "mission.budgets.lineAtLeast":
    "{scope}, {metric}{agent}: कम से कम {used}, सीमा {limit} ({pct}%); कुछ उपयोग की लागत अज्ञात है और गिनी नहीं गई",
  "mission.ingest.notice":
    "आज Core ने {clamped, plural, one {# रिपोर्ट} other {# रिपोर्ट}} को सीमा तक काटा और {refused, plural, one {# रिपोर्ट} other {# रिपोर्ट}} अस्वीकार की, इसलिए नीचे की संख्याएँ एजेंटों की रिपोर्ट से कम हो सकती हैं। एजेंट: {agents}।",
  "mission.budgets.lineUnknown": "{scope}, {metric}{agent}: उपयोग अज्ञात, सीमा {limit}",
  "mission.budgets.agentSuffix": " ({agent})",
  "mission.budgets.scope": "लागू होता है",
  "mission.budgets.scope.daily": "पूरे दिन पर",
  "mission.budgets.scope.session": "हर सत्र पर",
  "mission.budgets.metric": "इसमें मापा जाता है",
  "mission.budgets.metric.tokens": "टोकन",
  "mission.budgets.metric.cost": "अमेरिकी डॉलर",
  "mission.budgets.limit": "सीमा",
  "mission.budgets.agent": "एजेंट (वैकल्पिक)",
  "mission.budgets.add": "बजट जोड़ें",
  "mission.budgets.remove": "बजट {id} हटाएँ",
  "mission.budgets.invalid": "शून्य से अधिक सीमा दर्ज करें।",

  "mission.prices.title": "कीमतें",
  "mission.prices.note":
    "Phoenix में पहले से कोई कीमत नहीं है। एजेंट जिस मॉडल नाम से रिपोर्ट करता है, उसी के तहत अपनी कीमतें अमेरिकी डॉलर प्रति दस लाख टोकन में दर्ज करें।",
  "mission.prices.aiNote": "जिन मॉडलों की कीमत AI सेटिंग में भी है: {models}।",
  "mission.prices.none": "अभी कोई कीमत नहीं है।",
  "mission.prices.model": "मॉडल",
  "mission.prices.input": "प्रति दस लाख टोकन इनपुट",
  "mission.prices.output": "प्रति दस लाख टोकन आउटपुट",
  "mission.prices.line": "{model}: प्रति दस लाख टोकन {input} इनपुट, {output} आउटपुट",
  "mission.prices.add": "कीमत सहेजें",
  "mission.prices.remove": "{model} की कीमत हटाएँ",
  "mission.prices.invalid": "एक मॉडल नाम और शून्य या उससे अधिक की दो कीमतें दर्ज करें।",

  "mission.stall.label": "रिपोर्ट के बिना इतने मिनट बीतने पर सक्रिय सत्र को अटका हुआ चिह्नित करें",
  "mission.stall.save": "सहेजें",

  "mission.keep.label": "इतने दिनों से पुराने उपयोग रिकॉर्ड हटाएँ (7 से 3650)",
  "mission.keep.save": "सहेजें",

  "mission.saved": "सहेजा गया",
  "mission.delete.button": "एजेंट का सारा उपयोग हटाएँ",
  "mission.delete.warning":
    "संग्रहीत हर टोकन और लागत संख्या हटानी है? बजट और कीमतें बनी रहेंगी। इसे पहले जैसा नहीं किया जा सकता।",
  "mission.delete.confirm": "हाँ, हटाएँ",
  "mission.delete.done": "{count, plural, one {# रिकॉर्ड हटाया गया} other {# रिकॉर्ड हटाए गए}}",
};
