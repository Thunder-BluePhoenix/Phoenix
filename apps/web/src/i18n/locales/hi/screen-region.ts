// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { screenRegion as enScreenRegion } from "../../en/screen-region";

/** Machine-translated; unreviewed (see ../../README.md). */
export const screenRegion: Record<keyof typeof enScreenRegion, string> = {
  "screenRegion.title": "इश्यू के लिए स्क्रीन क्षेत्र कैप्चर करें",
  "screenRegion.intro":
    "“स्क्रीन क्षेत्र चुनें” दबाएँ, अनुमोदन में पुष्टि करें, फिर सिस्टम के चयनकर्ता से इच्छित क्षेत्र खींचें (Esc रद्द करता है)। केवल macOS। छवि इसी पृष्ठ पर रहती है और सहेजी नहीं जाती। इश्यू स्वयं केवल टेक्स्ट के रूप में बनता है, आपके अनुमोदन के बाद। Linear और Jira के लिए आप बाद में अलग चरण में, उसकी अपनी पुष्टि के साथ, छिपाई गई छवि उस इश्यू से जोड़ सकते हैं; GitHub केवल टेक्स्ट है।",
  "screenRegion.projectLabel":
    "GitHub रिपॉज़िटरी (owner/name), Linear टीम आईडी या Jira प्रोजेक्ट कुंजी",
  "screenRegion.linearTeamInvalid":
    "Linear टीम आईडी ऐसी दिखती है: 6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f; कुछ नहीं भेजा गया।",
  "screenRegion.jiraProjectInvalid":
    "Jira प्रोजेक्ट कुंजी बड़े अक्षरों, अंकों या अंडरस्कोर की होती है, जैसे PROJ; कुछ नहीं भेजा गया।",
  "screenRegion.issuesUnavailable":
    "“इश्यू ट्रैकर” क्षमता बंद है या उसमें बनाने और जोड़ने के कमांड नहीं हैं, इसलिए कुछ नहीं भेजा गया। पहले इसे चालू करें।",
  "screenRegion.issuesNoWriteCredential":
    "“इश्यू ट्रैकर” में {tracker} के लिए लिखने का क्रेडेंशियल सेट नहीं है (पोलिंग कुंजियाँ कभी लिखने में उपयोग नहीं होतीं), इसलिए कुछ नहीं भेजा गया।",
  "screenRegion.issueKeyInvalid": "यह मान्य इश्यू कुंजी नहीं है; कुछ नहीं भेजा गया।",
  "focus.screenshot.textOnly":
    "इश्यू केवल टेक्स्ट के साथ बनता है। स्क्रीनशॉट उसका हिस्सा नहीं है; Linear और Jira के लिए बाद में उसे अलग से दे सकते हैं।",
  "focus.screenshot.attach.title": "स्क्रीनशॉट जोड़ें (वैकल्पिक)",
  "focus.screenshot.attach.intro":
    "{tracker} इश्यू {key} बिना छवि के बना है। अब आप उसमें छिपाया हुआ स्क्रीनशॉट जोड़ सकते हैं। यह अलग अपलोड है जिसके लिए Core फिर से आपका अनुमोदन माँगेगा। GitHub को छवि कभी नहीं मिलती।",
  "focus.screenshot.attach.prepare": "दिखाएँ क्या जुड़ेगा",
  "focus.screenshot.attach.details": "क्या जुड़ेगा",
  "focus.screenshot.attach.tracker": "सेवा: {tracker}",
  "focus.screenshot.attach.issue": "इश्यू: {key}",
  "focus.screenshot.attach.file": "फ़ाइल का नाम: {name}",
  "focus.screenshot.attach.size": "आकार: {bytes} बाइट",
  "focus.screenshot.attach.hash": "सामग्री हैश (SHA-256, पहले 12 अक्षर): {hash}",
  "focus.screenshot.attach.redacted":
    "यह छवि वैसी ही है जैसी इस पृष्ठ पर छिपाई और चिह्नित की गई है; छिपाव पहले ही छवि में समा चुका है। अभी कुछ नहीं भेजा गया।",
  "focus.screenshot.attach.confirm": "हाँ, यह छवि {tracker} पर अपलोड करें",
  "focus.screenshot.attach.send": "अनुमोदन माँगें और जोड़ें",
  "focus.screenshot.attach.done": "स्क्रीनशॉट {key} से जोड़ दिया गया।",
  "focus.screenshot.attach.problem.badImage": "छवि मान्य PNG नहीं है और नहीं भेजी गई।",
  "focus.screenshot.attach.problem.tooLarge": "छवि 5 MiB से बड़ी है और नहीं भेजी गई।",
  "focus.screenshot.attach.problem.changed":
    "आपकी समीक्षा के बाद छवि बदल गई; फिर से समीक्षा करें। कुछ नहीं भेजा गया।",
  "screenRegion.unavailable":
    "क्षेत्र कैप्चर बंद है। इसे उपयोग करने के लिए स्क्रीन क्षेत्र कैप्चर क्षमता चालू करें और स्क्रीन कैप्चर की अनुमति दें। यह केवल macOS पर काम करता है।",
  "screenRegion.cancelled": "आपने चयन रद्द कर दिया, इसलिए कुछ भी कैप्चर नहीं हुआ।",
  "screenRegion.declined": "आपने अस्वीकार किया, इसलिए कुछ भी कैप्चर नहीं हुआ।",
  "screenRegion.blocked": "आपातकालीन रोक चालू है, इसलिए कुछ भी कैप्चर नहीं हुआ।",
  "screenRegion.timeout":
    "समय पर कोई क्षेत्र नहीं चुना गया या अनुरोध स्वीकृत नहीं हुआ; कुछ भी कैप्चर नहीं हुआ।",
  "screenRegion.failed": "क्षेत्र कैप्चर नहीं हो सका: {message}",
  "screenRegion.badImage": "कैप्चर मान्य PNG छवि नहीं था और हटा दिया गया।",
  "screenRegion.tooLarge": "कैप्चर किया गया क्षेत्र 5 MiB से बड़ा था और हटा दिया गया।",
  "screenRegion.unsupported": "क्षेत्र कैप्चर केवल macOS पर समर्थित है।",
  "screenRegion.expired": "कैप्चर अब उपलब्ध नहीं था। फिर से क्षेत्र चुनें।",
};
