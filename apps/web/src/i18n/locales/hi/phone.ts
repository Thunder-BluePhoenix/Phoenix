// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { phone as enphone } from "../../en/phone";

/** Machine-translated; unreviewed (see ../../README.md). */
export const phone: Record<keyof typeof enphone, string> = {
  "phone.title": "फ़ोन लिंक",
  "phone.intro":
    "एक फ़ोन जोड़ें ताकि वह Phoenix की पूछी गई बातों को मंज़ूर या अस्वीकार कर सके। जब तक आप इसे चालू नहीं करते, यह बंद रहता है।",
  "phone.unavailable": "फ़ोन लिंक की सेटिंग लोड नहीं हो सकीं।",
  "phone.warning.title": "चालू करने से पहले",
  "phone.warning.network":
    "चालू करने पर एक अलग HTTPS लिसनर खुलता है, जिस तक आपके लोकल नेटवर्क के अन्य डिवाइस पहुँच सकते हैं (इंटरनेट नहीं)।",
  "phone.warning.pairing":
    "केवल वही फ़ोन कुछ भी मंज़ूर कर सकते हैं जिन्हें आपने जोड़ा और फिर यहाँ पुष्टि की। जोड़ने के लिए इस स्क्रीन पर दिखाया गया कोड चाहिए।",
  "phone.warning.trust": "इसे केवल भरोसेमंद नेटवर्क पर चालू करें, जैसे आपका घर का नेटवर्क।",
  "phone.warning.presence":
    "Phoenix यह जाँच नहीं सकता कि इस कंप्यूटर पर कोई व्यक्ति मौजूद है: इस कंप्यूटर का कोई भी प्रोग्राम जिसके पास Core सेशन टोकन है, फ़ोन भी जोड़ सकता है।",
  "phone.enable.label": "मेरे लोकल नेटवर्क के फ़ोन को कनेक्ट करने दें",
  "phone.saved.on": "फ़ोन लिंक चालू है।",
  "phone.saved.off": "फ़ोन लिंक बंद है।",
  "phone.saved.verifyOn": "फ़ोन से मंज़ूरी अब बायोमेट्रिक या डिवाइस सत्यापन माँगती है।",
  "phone.saved.verifyOff": "फ़ोन से मंज़ूरी अब डिवाइस सत्यापन नहीं माँगती।",
  "phone.killSwitch":
    "किल स्विच चालू है, इसलिए फ़ोन लिसनर बंद है। किल स्विच हटाने के बाद यहाँ फ़ोन लिंक फिर से चालू करें।",
  "phone.lockedOut": "बहुत ज़्यादा गलत कोड डालने के कारण जोड़ना {time} तक लॉक है।",
  "phone.notListening": "फ़ोन लिंक चालू है, लेकिन लिसनर अभी चल नहीं रहा है।",
  "phone.listen.address": "पता और पोर्ट",
  "phone.listen.fingerprint": "प्रमाणपत्र फ़िंगरप्रिंट (SHA-256)",
  "phone.pair.show": "पेयरिंग कोड दिखाएँ",
  "phone.pair.cancel": "कोड रद्द करें",
  "phone.pair.cancelled": "पेयरिंग कोड रद्द किया गया।",
  "phone.pair.expired": "पेयरिंग कोड की समय-सीमा समाप्त हो गई। फ़ोन जोड़ने के लिए नया कोड दिखाएँ।",
  "phone.pair.instruction":
    "फ़ोन पर यह कोड डालें या स्कैन करें, और जाँचें कि वहाँ दिखा फ़िंगरप्रिंट नीचे वाले से मेल खाता है। मेल न खाए तो आगे न बढ़ें।",
  "phone.pair.codeLabel": "पेयरिंग कोड",
  "phone.pair.remaining": "{time} में समाप्त",
  "phone.pair.fingerprint": "प्रमाणपत्र फ़िंगरप्रिंट:",
  "phone.pair.link": "पेयरिंग लिंक (QR कोड उपलब्ध नहीं है):",
  "phone.pair.hiddenActive":
    "एक पेयरिंग कोड {time} तक सक्रिय है। उसे दोबारा नहीं दिखाया जाता; उसे रद्द करके नया दिखाएँ।",
  "phone.pending.question": '"{name}" को जोड़ें?',
  "phone.pending.fingerprint": "कुंजी फ़िंगरप्रिंट",
  "phone.pending.yes": "हाँ, इस फ़ोन को जोड़ें",
  "phone.pending.no": "नहीं, अस्वीकार करें",
  "phone.pending.waiting": "Phoenix के आपकी पुष्टि माँगने की प्रतीक्षा है।",
  "phone.pending.approved": "फ़ोन जोड़ा गया।",
  "phone.pending.rejected": "जोड़ना अस्वीकार किया गया।",
  "phone.verify.label": "मंज़ूरी पर बायोमेट्रिक या डिवाइस सत्यापन आवश्यक करें",
  "phone.verify.note":
    "फ़ोन बताता है कि व्यक्ति का सत्यापन हुआ या नहीं (फ़िंगरप्रिंट, चेहरा या स्क्रीन लॉक)। Phoenix खुद इस रिपोर्ट की जाँच नहीं कर सकता।",
  "phone.devices.title": "जुड़े हुए फ़ोन",
  "phone.devices.none": "कोई फ़ोन जुड़ा नहीं है।",
  "phone.devices.fingerprint": "कुंजी फ़िंगरप्रिंट",
  "phone.devices.created": "{date} को जोड़ा गया",
  "phone.devices.lastSeen": "आख़िरी बार {when} देखा गया",
  "phone.devices.neverSeen": "कभी नहीं देखा गया",
  "phone.devices.revoked": "{date} को रद्द किया गया",
  "phone.devices.revoke": "{name} को रद्द करें",
  "phone.devices.revokeAsk": '"{name}" को रद्द करें? यह अब कुछ भी मंज़ूर नहीं कर सकेगा।',
  "phone.devices.revokeYes": "हाँ, रद्द करें",
  "phone.devices.revokeNo": "रखें",
  "phone.devices.revokedDone": "फ़ोन रद्द किया गया।",
  "phone.device.unnamed": "बिना नाम का फ़ोन",
};
