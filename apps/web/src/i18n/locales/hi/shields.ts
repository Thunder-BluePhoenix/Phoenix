// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { shields as enShields } from "../../en/shields";

/** Machine-translated; unreviewed. */
export const shields: Record<keyof typeof enShields, string> = {
  "shields.title": "विज्ञापन और ट्रैकर ब्लॉकिंग",
  "shields.intro":
    "ये सेटिंग Phoenix ब्राउज़र के जारी होने पर उसी में लागू होंगी। Phoenix में अभी ब्राउज़र विंडो नहीं है, इसलिए आज किसी भी पेज में कुछ भी ब्लॉक नहीं होता। इस तरह केवल नेटवर्क अनुरोध ब्लॉक हो सकते हैं: पेज के तत्व छिपाना समर्थित नहीं है, और यह किसी अन्य ब्राउज़र की सुरक्षा की प्रति नहीं है।",
  "shields.unavailable": "विज्ञापन और ट्रैकर ब्लॉकिंग सेटिंग Phoenix Core से उपलब्ध नहीं हैं।",
  "shields.loadFailed": "ब्लॉकिंग सेटिंग Phoenix Core से पढ़ी नहीं जा सकीं।",
  "shields.global.label": "विज्ञापन और ट्रैकर ब्लॉक करें",
  "shields.global.hint":
    "बंद होने पर कोई सूची किसी साइट पर लागू नहीं होती। चालू होने पर और कोई सूची डाउनलोड न होने पर, जाने-माने विज्ञापन और एनालिटिक्स होस्ट की एक छोटी अंतर्निहित सूची उपयोग होती है।",
  "shields.lists.title": "फ़िल्टर सूचियाँ",
  "shields.lists.note":
    "सूचियाँ Phoenix के साथ नहीं आतीं और कभी अपने आप डाउनलोड नहीं होतीं। अपडेट दबाने पर वह सूची डाउनलोड करने के लिए easylist.to से एक बार संपर्क किया जाता है। आपके या आपके पेजों के बारे में कुछ नहीं भेजा जाता।",
  "shields.list.purpose.ads": "विज्ञापन ब्लॉक करती है",
  "shields.list.purpose.trackers": "ट्रैकिंग ब्लॉक करती है",
  "shields.list.never": "कभी डाउनलोड नहीं हुई।",
  "shields.list.damaged":
    "सहेजी गई प्रति खराब है और उपयोग नहीं होती। इसे फिर डाउनलोड करने के लिए अपडेट दबाएँ।",
  "shields.list.status":
    "{date} को डाउनलोड हुई · {rules} ब्लॉकिंग नियम · {cosmetic} पेज-तत्व नियम अनदेखे",
  "shields.list.version": "सूची संस्करण {version}",
  "shields.list.due":
    "सूची {date} के बाद नया संस्करण देखने का सुझाव देती है। Phoenix कभी अपने आप जाँच नहीं करता।",
  "shields.list.licence": "लाइसेंस: {licence}। श्रेय: {attribution}।",
  "shields.list.source": "अपडेट {source} से संपर्क करता है",
  "shields.list.enable": "{name} उपयोग करें",
  "shields.list.enableNeedsDownload": "चालू करने से पहले सूची डाउनलोड करें।",
  "shields.list.update": "अपडेट",
  "shields.list.updateFirst": "डाउनलोड",
  "shields.list.updating": "डाउनलोड हो रही है…",
  "shields.list.updated": "{name} अपडेट हो गई।",
  "shields.list.remove": "डाउनलोड की गई प्रति हटाएँ",
  "shields.list.removed": "{name} की डाउनलोड की गई प्रति हटा दी गई।",
  "shields.sites.title": "जिन साइटों पर ब्लॉकिंग बंद है",
  "shields.sites.empty": "किसी साइट पर ब्लॉकिंग बंद नहीं है।",
  "shields.sites.add.label": "साइट का नाम, जैसे example.com",
  "shields.sites.add.submit": "इस साइट के लिए ब्लॉकिंग बंद करें",
  "shields.sites.remove": "{site} के लिए ब्लॉकिंग फिर चालू करें",
  "shields.sites.hint":
    "केवल साइट का नाम लिखें, पता नहीं। साइट और उसके सबडोमेन शामिल हैं। जब तक YouTube संगीत साइट की अनुमति है, YouTube के अपने विज्ञापन नहीं छुए जाते; यह संगीत साइटों में तय होता है, यहाँ नहीं।",
};
