// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { awakeSettings as enAwakeSettings } from "../../en/awake-settings";

/** Machine-translated; unreviewed. */
export const awakeSettings: Record<keyof typeof enAwakeSettings, string> = {
  "awakeSettings.title": "जगाए रखें",
  "awakeSettings.intro":
    "तय समय तक इस कंप्यूटर को सोने से रोकता है, जैसे बिल्ड या एजेंट चलने के दौरान। सत्र का हमेशा एक अंत होता है: 1 मिनट से 7 दिन तक।",
  "awakeSettings.approval":
    "सत्र शुरू करने, बढ़ाने और खत्म करने में से हर एक पहले “स्वीकृतियाँ” में आपकी मंज़ूरी माँगता है। आपके मंज़ूर करने तक कुछ नहीं बदलता।",
  "awakeSettings.off": "“जगाए रखें” बंद है, इसलिए कोई सत्र शुरू नहीं हो सकता।",
  "awakeSettings.enable": "“जगाए रखें” चालू करें",
  "awakeSettings.status.title": "मौजूदा सत्र",
  "awakeSettings.status.idle": "कोई सत्र नहीं चल रहा। कंप्यूटर सामान्य रूप से सोता है।",
  "awakeSettings.status.unreadable": "“जगाए रखें” की स्थिति पढ़ी नहीं जा सकी।",
  "awakeSettings.status.mode.timed": "(समयबद्ध)",
  "awakeSettings.status.mode.agents_grace": "(एजेंटों के काम करते समय)",
  "awakeSettings.status.label": "लेबल: {label}",
  "awakeSettings.end.button": "सत्र खत्म करें",
  "awakeSettings.start.title": "सत्र शुरू करें",
  "awakeSettings.start.durations": "पहले से तय अवधियाँ",
  "awakeSettings.start.minutes": "मिनट",
  "awakeSettings.start.label": "लेबल (वैकल्पिक)",
  "awakeSettings.start.labelInvalid":
    "लेबल 1 से {max} वर्णों का होना चाहिए, उसमें नियंत्रण या अदृश्य वर्ण नहीं होने चाहिए।",
  "awakeSettings.start.submit": "शुरू करने के लिए पूछें",
  "awakeSettings.outcome.waiting": "“स्वीकृतियाँ” में आपकी मंज़ूरी का इंतज़ार है…",
  "awakeSettings.outcome.succeeded.start": "मंज़ूर: सत्र शुरू हो गया है।",
  "awakeSettings.outcome.succeeded.extend": "मंज़ूर: सत्र में समय जोड़ा गया।",
  "awakeSettings.outcome.succeeded.end": "मंज़ूर: सत्र खत्म हो गया है।",
  "awakeSettings.outcome.denied": "आपने मना कर दिया, इसलिए कुछ नहीं बदला।",
  "awakeSettings.outcome.blocked": "आपातकालीन रोक चालू है, इसलिए कुछ नहीं बदला।",
  "awakeSettings.outcome.timeout":
    "अनुरोध समय पर मंज़ूर नहीं हुआ या रद्द हो गया, इसलिए कुछ नहीं बदला।",
  "awakeSettings.outcome.failed": "“जगाए रखें” यह नहीं कर सका: {message}",
};
