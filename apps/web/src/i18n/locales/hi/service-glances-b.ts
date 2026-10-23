// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { serviceGlancesB as enServiceGlancesB } from "../../en/service-glances-b";

/** Machine-translated; unreviewed (see ../../README.md). */
export const serviceGlancesB: Record<keyof typeof enServiceGlancesB, string> = {
  "services.glance.resend.notConfigured":
    "यहाँ डिलीवरी की स्थिति देखने के लिए Resend क्षमता के सीक्रेट में Resend API कुंजी जोड़ें।",
  "services.glance.resend.empty": "गिनने के लिए हाल में भेजे गए कोई ईमेल नहीं हैं।",
  "services.glance.resend.summary": "{count, plural, one {# हालिया ईमेल} other {# हालिया ईमेल}}",
  "services.glance.resend.newest": "सबसे नया: {time}",
  "services.glance.resend.privacy": "केवल गिनती। विषय और प्राप्तकर्ता यहाँ कभी नहीं दिखाए जाते।",
  "services.glance.resend.state.delivered": "पहुँच गया",
  "services.glance.resend.state.inFlight": "रास्ते में",
  "services.glance.resend.state.delayed": "देरी से",
  "services.glance.resend.state.bounced": "वापस लौटा",
  "services.glance.resend.state.complained": "स्पैम के रूप में चिह्नित",
  "services.glance.resend.state.failed": "विफल",
  "services.glance.resend.state.other": "अन्य",

  "services.glance.notion.notConfigured":
    "अपने देखे जा रहे पेज यहाँ देखने के लिए Notion क्षमता के सीक्रेट में Notion इंटीग्रेशन टोकन जोड़ें।",
  "services.glance.notion.empty":
    "दिखाने के लिए कोई देखा जा रहा पेज या डेटाबेस नहीं है। Notion क्षमता की सेटिंग में उन्हें आईडी से सूचीबद्ध करें।",
  "services.glance.notion.summary":
    "{count, plural, one {# देखा जा रहा आइटम} other {# देखे जा रहे आइटम}}",
  "services.glance.notion.privacy":
    "केवल शीर्षक और संपादन का समय। पेज की सामग्री कभी नहीं पढ़ी जाती।",
  "services.glance.notion.untitled": "शीर्षकहीन",
  "services.glance.notion.kind.page": "पेज",
  "services.glance.notion.kind.database": "डेटाबेस",
  "services.glance.notion.kind.archived": "संग्रहीत",
  "services.glance.notion.edited": "संपादित: {time}",
  "services.glance.notion.open": "Notion में खोलें",
  "services.glance.notion.openNamed": "{title} को Notion में खोलें",

  "services.glance.calcom.notConfigured":
    "अपनी बुकिंग यहाँ देखने के लिए Cal.com क्षमता के सीक्रेट में Cal.com API कुंजी जोड़ें।",
  "services.glance.calcom.empty": "कोई आने वाली बुकिंग नहीं है।",
  "services.glance.calcom.summary":
    "{count, plural, one {# आने वाली बुकिंग} other {# आने वाली बुकिंग}}",
  "services.glance.calcom.privacy":
    "केवल समय और प्रतिभागियों की संख्या। नाम और ईमेल पते यहाँ कभी नहीं दिखाए जाते।",
  "services.glance.calcom.booking": "बुकिंग",
  "services.glance.calcom.status.accepted": "पुष्टि हो गई",
  "services.glance.calcom.status.pending": "पुष्टि की प्रतीक्षा में",
  "services.glance.calcom.status.other": "अन्य",
  "services.glance.calcom.attendees": "{count, plural, one {# प्रतिभागी} other {# प्रतिभागी}}",
  "services.glance.calcom.more": "{count, plural, one {# और बुकिंग} other {# और बुकिंग}}",
};
