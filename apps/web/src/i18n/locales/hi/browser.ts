// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browser as enBrowser } from "../../en/browser";

/** Machine-translated; unreviewed. */
export const browser: Record<keyof typeof enBrowser, string> = {
  "browser.tabs.label": "टैब",
  "browser.tab.untitled": "नया टैब",
  "browser.tab.loading": "लोड हो रहा है",
  "browser.tab.close": "टैब {title} बंद करें",
  "browser.tab.new": "नया टैब",
  "browser.nav.back": "पीछे",
  "browser.nav.forward": "आगे",
  "browser.nav.reload": "फिर से लोड करें",
  "browser.address.label": "पता या खोज",
  "browser.address.placeholder": "खोजें या पता लिखें",
  "browser.address.go": "जाएँ",
  "browser.address.blocked": "नहीं खुला: {text}",
  "browser.deny.unparseable": "यह मान्य वेब पता नहीं है।",
  "browser.deny.scheme_not_allowed": "केवल सुरक्षित वेब पते (https) खोले जा सकते हैं।",
  "browser.deny.dangerous_scheme": "कोड चलाने वाले या पेज को ही समेटे पते नहीं खोले जा सकते।",
  "browser.deny.file_blocked": "इस कंप्यूटर की फ़ाइलें यहाँ नहीं खोली जा सकतीं।",
  "browser.deny.credentials_in_url": "उपयोगकर्ता नाम या पासवर्ड वाले पते अस्वीकार किए जाते हैं।",
  "browser.deny.private_network":
    "इस कंप्यूटर या आपके स्थानीय नेटवर्क के पते यहाँ नहीं लिखे जा सकते। इसके बजाय पोर्ट रडार से प्रोग्राम का पेज खोलें।",
  "browser.deny.bad_port": "वह पोर्ट अवरुद्ध है क्योंकि वह गैर-वेब सेवा का है।",
  "browser.deny.insecure_blocked": "सादे http पते नहीं खोले जाते।",
  "browser.deny.site_denied": "यह साइट अवरुद्ध सूची में है।",
  "browser.deny.dns_private": "वह नाम इस कंप्यूटर या आपके स्थानीय नेटवर्क के पते की ओर जाता है।",
  "browser.deny.port_radar_invalid":
    "पोर्ट रडार का अनुरोध इस कंप्यूटर का सामान्य पेज नहीं था, इसलिए उसे अनदेखा किया गया।",
  "browser.deny.unknown": "वह पता अस्वीकार कर दिया गया।",
  "browser.zoom.label": "ज़ूम",
  "browser.zoom.out": "ज़ूम घटाएँ",
  "browser.zoom.in": "ज़ूम बढ़ाएँ",
  "browser.zoom.reset": "ज़ूम को {percent} पर रीसेट करें",
  "browser.shields.label": "{site} पर विज्ञापन और ट्रैकर अवरुद्ध करें",
  "browser.shields.saveFailed": "चुनाव यहाँ लागू हुआ लेकिन Phoenix Core में सहेजा नहीं जा सका।",
  "browser.shields.blocked": "{count, plural, one {# अनुरोध अवरुद्ध} other {# अनुरोध अवरुद्ध}}",
  "browser.empty": "कोई टैब खुला नहीं है। ऊपर पता या खोज लिखें।",
  "browser.noShell":
    "यह पेज Phoenix ब्राउज़र का टूलबार है। यह केवल Phoenix डेस्कटॉप ऐप के अंदर काम करता है।",
  "browser.radar.title": "इस कंप्यूटर का प्रोग्राम खोलें?",
  "browser.radar.body":
    "पोर्ट रडार यह पता खोलने को कह रहा है। यह इस कंप्यूटर पर चल रहा प्रोग्राम है, वेबसाइट नहीं, और यह एन्क्रिप्टेड नहीं है।",
  "browser.radar.url": "पता: {url}",
  "browser.radar.open": "खोलें",
  "browser.radar.cancel": "रद्द करें",
  "browser.error.action": "ब्राउज़र ऐसा नहीं कर सका।",
};
