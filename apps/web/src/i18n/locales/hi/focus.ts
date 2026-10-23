// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { focus as enFocus } from "../../en/focus";

/** Machine-translated; unreviewed. */
export const focus: Record<keyof typeof enFocus, string> = {
  "focus.title": "फ़ोकस मोड",
  "focus.start": "फ़ोकस शुरू करें",
  "focus.stop": "फ़ोकस समाप्त करें",
  "focus.minutes": "मिनट (बिना समय सीमा के लिए खाली छोड़ें)",
  "focus.remaining": "शेष मिनट: {count}",
  "focus.active": "फ़ोकस चालू है",
  "focus.inactive": "फ़ोकस बंद है",
  "focus.held": "रोकी गई सूचनाएँ: {count}",
  "focus.osDnd": "सिस्टम डू नॉट डिस्टर्ब चालू है",
  "focus.osUnknown": "सिस्टम डू नॉट डिस्टर्ब स्थिति उपलब्ध नहीं",
  "focus.refresh": "सिस्टम फ़ोकस स्थिति रीफ़्रेश करें",
  "focus.pomodoro": "पोमोडोरो शुरू करें",
  "focus.systemUnavailable":
    "सिस्टम डू नॉट डिस्टर्ब उपलब्ध नहीं है; फ़ोकस मोड केवल Phoenix सूचनाओं को नियंत्रित करता है।",
  "focus.screenshot.title": "स्क्रीनशॉट से इश्यू",
  "focus.screenshot.capture": "स्क्रीन क्षेत्र चुनें…",
  "focus.screenshot.permission": "स्क्रीन रिकॉर्डिंग अनुमति आवश्यक है।",
  "focus.screenshot.error": "अनुरोध पूरा नहीं हुआ: {error}",
  "focus.screenshot.box": "बॉक्स",
  "focus.screenshot.arrow": "तीर",
  "focus.screenshot.text": "पाठ",
  "focus.screenshot.redact": "स्थायी रूप से छिपाएँ",
  "focus.screenshot.annotationText": "टिप्पणी का पाठ",
  "focus.screenshot.project": "रिपॉज़िटरी या प्रोजेक्ट",
  "focus.screenshot.issueTitle": "इश्यू शीर्षक",
  "focus.screenshot.body": "इश्यू विवरण",
  "focus.screenshot.preview": "ड्राफ़्ट देखें",
  "focus.screenshot.create": "स्वीकृति माँगें और इश्यू बनाएँ",
  "focus.screenshot.draft": "इश्यू ड्राफ़्ट (अभी नहीं बना)",
  "focus.screenshot.attachment": "जहाँ समर्थित हो स्क्रीनशॉट संलग्न",
  "focus.screenshot.noAttachment":
    "यह ट्रैकर स्क्रीनशॉट अटैचमेंट नहीं लेता; चित्र नहीं भेजा जाएगा।",
  "focus.screenshot.created": "इश्यू बनाया गया: {url}",
  "focus.screenshot.declined": "स्वीकृति नहीं मिली; कुछ नहीं भेजा गया।",
  "focus.screenshot.tracker": "इश्यू ट्रैकर",
  "focus.screenshot.tracker.github": "GitHub",
  "focus.screenshot.tracker.linear": "Linear",
  "focus.screenshot.tracker.jira": "Jira",
  "focus.issueDraft.title": "आपके पास मौजूद छवि से इश्यू",
  "focus.issueDraft.intro":
    "कोई PNG या JPEG जो आपके पास पहले से है, यहाँ छोड़ें, पेस्ट करें या चुनें, इश्यू लिखें और देखें कि ठीक-ठीक क्या भेजा जाएगा। Phoenix आपकी स्क्रीन कैप्चर नहीं करता। इश्यू GitHub पर तभी बनता है जब आप यहाँ और फिर अनुमतियाँ में पुष्टि करते हैं।",
  "focus.issueDraft.unavailable.capability":
    "GitHub इंटीग्रेशन चालू नहीं है या इश्यू नहीं बना सकता, इसलिए कुछ भी नहीं बनाया जा सकता।",
  "focus.issueDraft.unavailable.token":
    "GitHub इंटीग्रेशन के लिए GitHub लिखने का टोकन सेट नहीं है, इसलिए कुछ भी नहीं बनाया जा सकता।",
  "focus.issueDraft.dropLabel": "इश्यू के लिए छवि छोड़ें",
  "focus.issueDraft.dropHint": "PNG या JPEG यहाँ छोड़ें या पेस्ट करें, या {choose}।",
  "focus.issueDraft.choose": "छवि चुनें…",
  "focus.issueDraft.chooseLabel": "इश्यू के लिए छवि चुनें",
  "focus.issueDraft.imageAlt": "इश्यू के लिए छवि: {name}",
  "focus.issueDraft.imageRemove": "छवि हटाएँ",
  "focus.issueDraft.oneImage": "एक बार में एक ही छवि जोड़ें।",
  "focus.issueDraft.imageRequired": "पहले एक छवि जोड़ें।",
  "focus.issueDraft.titleRequired": "इश्यू का शीर्षक लिखें।",
  "focus.issueDraft.titleTooLong": "शीर्षक में अधिकतम {max} वर्ण हो सकते हैं।",
  "focus.issueDraft.bodyTooLong": "विवरण में अधिकतम {max} वर्ण हो सकते हैं।",
  "focus.issueDraft.secretInTitle":
    "शीर्षक में पासवर्ड, कुंजी या टोकन जैसा कुछ लगता है। उसे हटाएँ; कुछ भी नहीं भेजा गया।",
  "focus.issueDraft.secretInBody":
    "विवरण में पासवर्ड, कुंजी या टोकन जैसा कुछ लगता है। उसे हटाएँ; कुछ भी नहीं भेजा गया।",
  "focus.issueDraft.secretInBoth":
    "शीर्षक और विवरण में पासवर्ड, कुंजी या टोकन जैसा कुछ लगता है। उसे हटाएँ; कुछ भी नहीं भेजा गया।",
  "focus.issueDraft.previewRepository": "रिपॉज़िटरी: {repository}",
  "focus.issueDraft.previewTitle": "शीर्षक: {title}",
  "focus.issueDraft.previewBody": "विवरण, ठीक वैसा जैसा भेजा जाएगा:",
  "focus.issueDraft.previewNoBody": "कोई विवरण नहीं भेजा जाएगा।",
  "focus.issueDraft.imageLocal":
    "छवि ({name}) नहीं भेजी जाती। GitHub इश्यू केवल टेक्स्ट से बनते हैं; छवि इसी डिवाइस पर रहती है और सहेजी नहीं जाती। चाहें तो उसे इश्यू में खुद जोड़ें।",
  "focus.issueDraft.approval":
    "अभी कुछ नहीं बना है। बटन दबाने के बाद, GitHub को कुछ भी भेजने से पहले Phoenix अनुमतियाँ में आपकी स्वीकृति माँगता है।",
  "focus.issueDraft.create": "इश्यू बनाने के लिए पूछें",
  "focus.issueDraft.waiting": "अनुमतियाँ में आपकी स्वीकृति की प्रतीक्षा…",
  "focus.issueDraft.denied": "आपने अस्वीकार किया; GitHub को कुछ भी नहीं भेजा गया।",
  "focus.issueDraft.blocked": "आपातकालीन रोक चालू है; GitHub को कुछ भी नहीं भेजा गया।",
  "focus.issueDraft.timeout":
    "अनुरोध समय पर स्वीकृत नहीं हुआ या रद्द हो गया; कुछ भी नहीं भेजा गया।",
  "focus.issueDraft.failed": "इश्यू नहीं बनाया जा सका: {message}",
};
