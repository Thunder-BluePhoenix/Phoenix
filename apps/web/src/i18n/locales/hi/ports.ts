// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { ports as enports } from "../../en/ports";

/** Machine-translated; unreviewed (see ../../README.md). */
export const ports: Record<keyof typeof enports, string> = {
  "ports.title": "पोर्ट रडार",
  "ports.intro":
    "दिखाता है कि इस कंप्यूटर पर कौन-से प्रोग्राम नेटवर्क पोर्ट पर सुन रहे हैं, वे किस प्रोजेक्ट में चल रहे हैं और कितनी देर से चल रहे हैं। स्कैन केवल पढ़ता है; जब तक आप किसी प्रोग्राम को रोककर अनुमति नहीं देते, कुछ नहीं बदलता।",
  "ports.disabled":
    "पोर्ट रडार बंद है। इसे इस्तेमाल करने के लिए “पोर्ट और प्रोसेस रडार” क्षमता चालू करें।",
  "ports.scan": "अभी स्कैन करें",
  "ports.scanning": "स्कैन हो रहा है…",
  "ports.notScanned": "अभी तक कुछ स्कैन नहीं हुआ। “अभी स्कैन करें” चुनें।",
  "ports.empty": "कोई प्रोग्राम किसी पोर्ट पर नहीं सुन रहा।",
  "ports.loadError": "पोर्ट पढ़े नहीं जा सके।",
  "ports.scannedAt": "स्कैन का समय: {time}",
  "ports.count": "{count, plural, one {# सुनने वाला पोर्ट} other {# सुनने वाले पोर्ट}}",
  "ports.table.caption": "सुनने वाले पोर्ट",
  "ports.col.port": "पोर्ट",
  "ports.col.process": "प्रोग्राम",
  "ports.col.project": "प्रोजेक्ट",
  "ports.col.age": "कितनी देर से चल रहा है",
  "ports.col.notes": "टिप्पणियाँ",
  "ports.col.actions": "कार्रवाइयाँ",
  "ports.pid": "प्रोसेस {pid}",
  "ports.age.unknown": "अज्ञात",
  "ports.age.minutes": "{count, plural, one {# मिनट} other {# मिनट}}",
  "ports.age.hours": "{count, plural, one {# घंटा} other {# घंटे}}",
  "ports.age.days": "{count, plural, one {# दिन} other {# दिन}}",
  "ports.project.none": "कोई प्रोजेक्ट नहीं",
  "ports.exposure.all": "नेटवर्क से पहुँच योग्य",
  "ports.exposure.loopback": "केवल यह कंप्यूटर",
  "ports.exposure.interface": "एक नेटवर्क पता",
  "ports.flag.forgotten": "शायद भुला दिया गया",
  "ports.flag.heavy": "भारी",
  "ports.flag.core": "स्वयं Phoenix",
  "ports.usage": "CPU {percent}%, मेमोरी {mb} MB",
  "ports.help.forgotten":
    "शायद भुला दिया गया: यह प्रोजेक्ट फ़ोल्डर में चल रहा है और {hours, plural, one {# घंटे} other {# घंटे}} से अधिक समय से चल रहा है। Phoenix यह नहीं देख सकता कि कोई अब भी इसका उपयोग कर रहा है या नहीं।",
  "ports.help.heavy":
    "भारी: CPU {cpu}% या अधिक, या मेमोरी {mb} MB या अधिक, जैसा ps बताता है (औसत, लाइव रीडिंग नहीं)।",
  "ports.open": "ब्राउज़र में खोलें",
  "ports.open.label": "पोर्ट {port} पर {name} को अपने डिफ़ॉल्ट ब्राउज़र में खोलें",
  "ports.openNote":
    "लिंक आपके डिफ़ॉल्ट ब्राउज़र में http://127.0.0.1 खोलते हैं। Phoenix का अपना ब्राउज़र अभी नहीं है।",
  "ports.stop": "रोकें…",
  "ports.stop.label": "पोर्ट {port} पर {name} को रोकें",
  "ports.refusal.self": "यह स्वयं Phoenix है, जो खुद को कभी नहीं रोकता।",
  "ports.refusal.other_user": "यह किसी अन्य उपयोगकर्ता का है।",
  "ports.refusal.system": "यह एक सिस्टम प्रोसेस है।",
  "ports.refusal.not_dev_tool": "यह ऐसा डेवलपर टूल नहीं है जिसे Phoenix रोक सकता है।",
  "ports.refusal.unsupported": "इस सिस्टम पर रोकना उपलब्ध नहीं है।",
  "ports.refusal.unknown": "Phoenix इस प्रोसेस की जाँच नहीं कर सका, इसलिए इसे नहीं रोकेगा।",
  "ports.confirm.title": "पोर्ट {port} पर {name} को रोकें?",
  "ports.confirm.body":
    "आपकी अनुमति के बाद Phoenix {name} (प्रोसेस {pid}) से बंद होने को कहेगा। प्रोग्राम में सहेजा न गया काम खो सकता है।",
  "ports.confirm.go": "रोकने को कहें",
  "ports.confirm.cancel": "रद्द करें",
  "ports.stop.waiting": "अनुमतियों में आपकी अनुमति की प्रतीक्षा…",
  "ports.stop.exited": "{name} रुक गया।",
  "ports.stop.stillRunning":
    "{name} से बंद होने को कहा गया था और वह अब भी चल रहा है। ज़बरदस्ती रोकना उसे तुरंत खत्म कर देता है, वापस नहीं हो सकता और डेटा खो सकता है।",
  "ports.force": "ज़बरदस्ती रोकें…",
  "ports.force.label": "पोर्ट {port} पर {name} को ज़बरदस्ती रोकें",
  "ports.force.hint":
    "बंद होने के अनुरोध के बाद पहले कुछ सेकंड तक Phoenix ज़बरदस्ती रोकने से मना करता है।",
  "ports.force.confirm": "ज़बरदस्ती रोकें",
  "ports.restart.note":
    "पुनः आरंभ करना उपलब्ध नहीं है: Phoenix किसी प्रोग्राम का मूल कमांड सुरक्षित रूप से दोबारा नहीं बना सकता।",
  "ports.watch.label": "Phoenix खुला रहने पर अपने आप रीफ़्रेश करें",
  "ports.watch.help":
    "डिफ़ॉल्ट रूप से बंद। चालू होने पर Phoenix हर 15 सेकंड में पोर्ट सूची पढ़ता है, केवल तब जब Phoenix की कोई विंडो खुली हो।",
  "ports.noProcessTable":
    "प्रोसेस सूची पढ़ी नहीं जा सकी, इसलिए चलने का समय और रोकना उपलब्ध नहीं हैं।",
  "ports.parseWarnings":
    "सिस्टम की प्रोसेस या पोर्ट सूची की कुछ पंक्तियाँ समझी नहीं गईं और छोड़ दी गईं (प्रोग्राम के नाम में नई पंक्तियाँ हो सकती हैं)। कुछ प्रोग्राम गायब हो सकते हैं या यहाँ रोके नहीं जा सकते; रोकते समय सब कुछ फिर से जाँचा जाता है।",
  "ports.windows.note":
    "Windows पर रडार केवल पोर्ट और प्रोग्राम के नाम दिखाता है; चलने का समय, प्रोजेक्ट और रोकना उपलब्ध नहीं हैं।",
};
