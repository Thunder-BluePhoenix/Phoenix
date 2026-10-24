// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { screenRegion as enScreenRegion } from "../../en/screen-region";

/** Machine-translated; unreviewed (see ../../README.md). */
export const screenRegion: Record<keyof typeof enScreenRegion, string> = {
  "screenRegion.title": "इश्यू के लिए स्क्रीन क्षेत्र कैप्चर करें",
  "screenRegion.intro":
    "“स्क्रीन क्षेत्र चुनें” दबाएँ, अनुमोदन में पुष्टि करें, फिर सिस्टम चयनकर्ता से इच्छित क्षेत्र खींचें (Esc रद्द करता है)। केवल macOS पर। छवि इसी पृष्ठ पर रहती है और सहेजी नहीं जाती; इश्यू केवल टेक्स्ट के रूप में GitHub पर बनता है, आपके दोबारा अनुमोदन के बाद।",
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
  "screenRegion.trackerUnsupported":
    "यहाँ से केवल GitHub इश्यू बना सकता है; Linear और Jira अभी नहीं बना सकते, इसलिए कुछ भी नहीं भेजा गया।",
};
