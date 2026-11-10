// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserAssist as enBrowserAssist } from "../../en/browser-assist";

/** Machine-translated; unreviewed. */
export const browserAssist: Record<keyof typeof enBrowserAssist, string> = {
  "browser.assist.open": "इस पेज पर मदद के लिए फॉक्स से कहें",
  "browser.assist.title": "इस पेज पर मदद के लिए फॉक्स से कहें",
  "browser.assist.goalLabel": "आप इस पेज पर क्या करवाना चाहते हैं?",
  "browser.assist.goalPlaceholder": "उदाहरण: नीला वाला कार्ट में जोड़ें",
  "browser.assist.propose": "चरण सुझाएँ",
  "browser.assist.proposing": "लोकल मॉडल से पूछा जा रहा है…",
  "browser.assist.close": "सहायक बंद करें",
  "browser.assist.goalTooLong": "लक्ष्य अधिकतम {max} अक्षरों का हो सकता है।",
  "browser.assist.goalControl": "लक्ष्य में कंट्रोल अक्षर नहीं हो सकते।",
  "browser.assist.goalHidden": "लक्ष्य में टेक्स्ट-दिशा या शून्य-चौड़ाई वाले अक्षर नहीं हो सकते।",
  "browser.assist.requestFailed": "सहायक तक नहीं पहुँचा जा सका। कुछ भी नहीं चलाया गया।",
  "browser.assist.noLocalModel":
    "डिवाइस पर कोई मॉडल उपलब्ध नहीं है, इसलिए फॉक्स ने यह पेज नहीं पढ़ा। पेज का टेक्स्ट कभी क्लाउड सेवा को नहीं भेजा जाता।",
  "browser.assist.localModelFailed":
    "डिवाइस का मॉडल विफल रहा। कुछ भी नहीं चलाया गया और कहीं और कुछ नहीं भेजा गया।",
  "browser.assist.noBrowser": "इस फीनिक्स ऐप में पेज पढ़ने के लिए कोई ब्राउज़र नहीं है।",
  "browser.assist.inert":
    "इस पेज को पढ़ने वाले लोकल मॉडल ने सुझाया। कुछ भी नहीं चला है। ये चरण सादा टेक्स्ट हैं और गलत हो सकते हैं।",
  "browser.assist.forPage": "पेज: {url}",
  "browser.assist.dropped":
    "{count, plural, one {मॉडल का # सुझाव अस्वीकार किया गया और दिखाया नहीं गया।} other {मॉडल के # सुझाव अस्वीकार किए गए और दिखाए नहीं गए।}}",
  "browser.assist.noSteps": "मॉडल ने इस पेज के लिए कोई चरण नहीं सुझाया।",
  "browser.assist.kind.click": "क्लिक करें",
  "browser.assist.kind.type": "इसमें लिखें",
  "browser.assist.kind.submit": "फ़ॉर्म जमा करें",
  "browser.assist.typeText": "टेक्स्ट: {text}",
  "browser.assist.run": "यह चरण चलाएँ",
  "browser.assist.step.running": "आपकी मंज़ूरी की प्रतीक्षा…",
  "browser.assist.step.done": "हो गया। और कुछ नहीं चलाया गया।",
  "browser.assist.refused.noTab": "इस चरण को चलाने के लिए कोई सक्रिय टैब नहीं है।",
  "browser.assist.refused.moved":
    "टैब अब उस पेज पर नहीं है जिसके लिए ये चरण सुझाए गए थे। फिर से पूछें।",
  "browser.assist.failed.denied": "आपने यह चरण अस्वीकार किया।",
  "browser.assist.failed.blocked":
    "फीनिक्स ने यह चरण अस्वीकार कर दिया (पेज या कंट्रोल की अनुमति नहीं है)।",
  "browser.assist.failed.unavailable": "ब्राउज़र तक नहीं पहुँचा जा सका।",
  "browser.assist.failed.timeout": "चरण का समय समाप्त हो गया। यह चला हो सकता है या नहीं भी।",
  "browser.assist.failed.failed": "चरण नहीं चला।",
};
