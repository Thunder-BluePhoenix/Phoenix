// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { statusLights as enStatusLights } from "../../en/status-lights";

/** Machine-translated; unreviewed. */
export const statusLights: Record<keyof typeof enStatusLights, string> = {
  "statusLights.limits":
    "केवल निश्चित रंग भेजे जाते हैं, कभी कोई टेक्स्ट नहीं। क्रेडेंशियल (Hue की एप्लिकेशन कुंजी, Luxafor का टोकन) केवल-लिखने योग्य हैं: एक बार सहेजने के बाद उन्हें दोबारा कभी नहीं दिखाया जाता। लाइट द्वारा बताए गए नाम और आईडी सादे टेक्स्ट के रूप में दिखाए जाते हैं।",
  "statusLights.line.luxafor": "{address} पर Luxafor ऐप",
  "statusLights.line.hue": "ब्रिज {bridge} पर Hue लाइट",

  "statusLights.error.unavailable":
    "इस Phoenix Core में OS क्रेडेंशियल स्टोर नहीं है, इसलिए क्रेडेंशियल सँभालकर नहीं रखा जा सकता।",
  "statusLights.error.save": "लाइटों की सूची सहेजी नहीं जा सकी। नाम और पता जाँचें।",
  "statusLights.error.capability": "स्टेटस लाइट सेटिंग बदली नहीं जा सकी।",
  "statusLights.error.hueName":
    "ब्रिज को अक्षरों, अंकों और . _ : - से बना नाम दें (अधिकतम 160 वर्ण)।",
  "statusLights.error.hueInspect":
    "ब्रिज ने उस पते पर उत्तर नहीं दिया। अपने नेटवर्क पर उसका IPv4 पता इस्तेमाल करें।",
  "statusLights.error.huePair":
    "पेयरिंग विफल रही। ब्रिज पर गोल लिंक बटन दबाएँ, फिर दोबारा कोशिश करें।",
  "statusLights.error.hueRemove": "ब्रिज हटाया नहीं जा सका।",
  "statusLights.error.hueLights": "इस ब्रिज की लाइटों की सूची नहीं बन सकी।",
  "statusLights.error.luxaforToken":
    "टोकन सहेजा नहीं गया। उसमें बिना स्पेस के 1 से 128 प्रिंट होने योग्य वर्ण होने चाहिए।",
  "statusLights.error.lifx":
    "LIFX खोज पूरी नहीं हुई। कुछ सेकंड प्रतीक्षा करें और दोबारा कोशिश करें।",
  "statusLights.error.quietInvalid":
    "दो समय और एक वास्तविक समय क्षेत्र दर्ज करें, जैसे Europe/Paris।",

  "statusLights.hue.title": "Philips Hue",
  "statusLights.hue.notAvailable":
    "Hue उपलब्ध नहीं है: इस Phoenix Core में OS क्रेडेंशियल स्टोर नहीं है।",
  "statusLights.hue.loadFailed": "Hue ब्रिज लोड नहीं हो सके।",
  "statusLights.hue.intro":
    "पेयर किए गए ब्रिज पर तभी तक भरोसा किया जाता है जब तक वह वही प्रमाणपत्र प्रस्तुत करता है जिसके SHA-256 फिंगरप्रिंट की आपने पुष्टि की थी। उसकी एप्लिकेशन कुंजी आपके OS क्रेडेंशियल स्टोर में रखी जाती है और कभी नहीं दिखाई जाती।",
  "statusLights.hue.empty": "कोई ब्रिज पेयर नहीं है।",
  "statusLights.hue.bridgeLine": "{address}:{port} पर",
  "statusLights.hue.fingerprint": "SHA-256 फिंगरप्रिंट:",
  "statusLights.hue.find": "लाइटें दिखाएँ",
  "statusLights.hue.findNamed": "ब्रिज {name} की लाइटें दिखाएँ",
  "statusLights.hue.remove": "ब्रिज हटाएँ",
  "statusLights.hue.removeNamed": "ब्रिज {name} हटाएँ",
  "statusLights.hue.removeNote":
    "ब्रिज हटाने से उसकी संग्रहीत कुंजी मिट जाती है। उसका उपयोग करने वाली लाइटों से फिर संपर्क नहीं किया जाता।",
  "statusLights.hue.noLights": "इस ब्रिज ने कोई लाइट नहीं बताई।",
  "statusLights.hue.alreadyAdded": "जोड़ी गई",
  "statusLights.hue.add": "जोड़ें",
  "statusLights.hue.addNamed": "Hue लाइट {name} जोड़ें",
  "statusLights.hue.pairTitle": "ब्रिज पेयर करें",
  "statusLights.hue.name": "इस ब्रिज का नाम",
  "statusLights.hue.address": "आपके नेटवर्क पर ब्रिज का पता (उदाहरण के लिए 192.168.1.2)",
  "statusLights.hue.lookup": "ब्रिज का प्रमाणपत्र पढ़ें",
  "statusLights.hue.confirmGroup": "ब्रिज के प्रमाणपत्र की पुष्टि करें",
  "statusLights.hue.found": "{address}:{port} पर एक ब्रिज ने उत्तर दिया।",
  "statusLights.hue.certName": "प्रमाणपत्र का विषय: {name}",
  "statusLights.hue.linkStep":
    "अभी ब्रिज के ऊपर लगा गोल लिंक बटन दबाएँ, फिर नीचे पुष्टि करें। यदि बटन पिछले लगभग 30 सेकंड में नहीं दबाया गया था, तो पेयरिंग अस्वीकार कर दी जाती है।",
  "statusLights.hue.confirm":
    "मैंने इस फिंगरप्रिंट की तुलना अपने ब्रिज के फिंगरप्रिंट से की है, और मैं इस ब्रिज पर भरोसा करता/करती हूँ।",
  "statusLights.hue.pair": "पेयर करें और इस फिंगरप्रिंट को पिन करें",
  "statusLights.hue.cancel": "रद्द करें",

  "statusLights.luxafor.title": "Luxafor",
  "statusLights.luxafor.intro":
    "Phoenix केवल Luxafor ऐप के स्थानीय वेबहुक से, आपके अपने नेटवर्क पर सादे HTTP के ज़रिए बात करता है। टोकन कुछ भी हो, ऐप सफलता का उत्तर देता है, इसलिए सहेजा गया टोकन यह साबित नहीं करता कि लाइट बदली।",
  "statusLights.luxafor.name": "इस Luxafor लाइट का नाम",
  "statusLights.luxafor.address": "Luxafor ऐप चलाने वाले कंप्यूटर का पता",
  "statusLights.luxafor.add": "Luxafor लाइट जोड़ें",
  "statusLights.luxafor.token": "वेबहुक टोकन",
  "statusLights.luxafor.tokenNamed": "{name} के लिए वेबहुक टोकन",
  "statusLights.luxafor.save": "टोकन सेट करें या बदलें",
  "statusLights.luxafor.saved": "टोकन सहेजा गया।",
  "statusLights.luxafor.writeOnly":
    "टोकन दोबारा कभी नहीं दिखाया जाता। उसे साफ़ करने के लिए यह लाइट हटाएँ।",

  "statusLights.lifx.title": "LIFX",
  "statusLights.lifx.intro":
    "खोज आपके नेटवर्क पर एक ब्रॉडकास्ट भेजती है और उत्तर देने वाली लाइटों की सूची बनाती है। जब तक आप कोई लाइट सक्षम नहीं करते, कुछ भी जोड़ा नहीं जाता और कोई रंग नहीं भेजा जाता।",
  "statusLights.lifx.discover": "LIFX लाइटें खोजें",
  "statusLights.lifx.none": "किसी LIFX लाइट ने उत्तर नहीं दिया।",
  "statusLights.lifx.line": "{address} पर LIFX लाइट {serial}",
  "statusLights.lifx.added": "जोड़ी गई",
  "statusLights.lifx.enable": "यह लाइट जोड़ें",
  "statusLights.lifx.enableNamed": "LIFX लाइट {serial} जोड़ें",

  "statusLights.quiet.title": "शांत घंटे",
  "statusLights.quiet.intro": "आपके चुने हुए समय क्षेत्र में, इन समयों के बीच लाइटें बंद रहती हैं।",
  "statusLights.quiet.off": "शांत घंटे बंद हैं।",
  "statusLights.quiet.on": "लाइटें {start} से {end} तक बंद रहती हैं ({timezone})।",
  "statusLights.quiet.start": "से",
  "statusLights.quiet.end": "तक",
  "statusLights.quiet.timezone": "समय क्षेत्र",
  "statusLights.quiet.save": "शांत घंटे सहेजें",
  "statusLights.quiet.clear": "शांत घंटे बंद करें",
};
