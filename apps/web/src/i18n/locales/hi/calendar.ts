// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { calendar as enCalendar } from "../../en/calendar";

/** Machine-translated; unreviewed. */
export const calendar: Record<keyof typeof enCalendar, string> = {
  "calendar.title": "बैठक की तैयारी",
  "calendar.disabled": "कैलेंडर बंद है। आगामी बैठकें देखने के लिए कैलेंडर क्षमता चालू करें।",
  "calendar.empty": "कोई आगामी बैठक नहीं।",
  "calendar.loading": "बैठकें पढ़ी जा रही हैं…",
  "calendar.error": "कैलेंडर नहीं पढ़ा जा सका।",
  "calendar.refresh": "बैठकें ताज़ा करें",
  "calendar.prep": "तैयारी",
  "calendar.decisions": "पिछले निर्णय",
  "calendar.actions": "लंबित कार्य",
  "calendar.noPrep": "कोई प्रासंगिक स्वीकृत निर्णय या लंबित कार्य नहीं।",
  "calendar.notetaker": "नोटटेकर शुरू करें",
  "calendar.notetakerInfo": "रिकॉर्डिंग तभी शुरू होती है जब आप इसे चुनें और अनुमति दें।",
  "calendar.freeze": "परिनियोजन रोक",
  "calendar.busy": "निजी कार्यक्रम",
  "calendar.source": "{meeting} से",
  "calendar.unconfigured":
    "कोई कैलेंडर प्रदाता कनेक्ट नहीं है। मीटिंग देखने के लिए Google, Microsoft, CalDAV या macOS कैलेंडर कनेक्ट करें।",
  "calendar.unavailable":
    "कैलेंडर फ़ीड उपलब्ध नहीं है। आगामी मीटिंग और डिप्लॉय फ़्रीज़ नहीं दिखाए जा सकते।",
  "calendar.stale":
    "कैलेंडर फ़ीड पुरानी है। रीफ़्रेश होने तक आगामी मीटिंग और डिप्लॉय फ़्रीज़ पर भरोसा नहीं किया जा सकता।",
  "calendar.lastChecked": "अंतिम सफल पढ़ाई: {time}",
  "calendar.prepIncomplete": "कुछ मीटिंग की तैयारी अधूरी है।",
};
