// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { windowCapture as enWindowCapture } from "../../en/window-capture";

/** Machine-translated; unreviewed (see ../../README.md). */
export const windowCapture: Record<keyof typeof enWindowCapture, string> = {
  "windowCapture.heading": "एक विंडो संलग्न करें",
  "windowCapture.intro":
    "Phoenix एक विंडो का टेक्स्ट पढ़कर पहले उसे आपको यहाँ दिखा सकता है। आप पुष्टि करते हैं, फिर जो विंडो चाहिए उसे सामने लाते हैं; Phoenix उसे एक बार पढ़ता है (macOS एक्सेसिबिलिटी, केवल इसी Mac पर)। जब तक आप टेक्स्ट स्वीकार नहीं करते, कुछ भी संलग्न नहीं होता।",
  "windowCapture.start": "एक विंडो संलग्न करें…",
  "windowCapture.waiting":
    "आपकी पुष्टि की प्रतीक्षा है, फिर सामने की विंडो पढ़ी जाएगी। अब जो विंडो चाहिए उसे सामने लाएँ।",
  "windowCapture.stopWaiting": "प्रतीक्षा रोकें",
  "windowCapture.discarded": "छोड़ दिया गया। कुछ भी संलग्न नहीं हुआ।",
  "windowCapture.attached": "“{name}” संलग्न हो गया। यह ऊपर की ट्रे में है।",
  "windowCapture.acceptFailed": "संलग्न नहीं हुआ: {reason}",
  "windowCapture.result.notGranted":
    "macOS ने Phoenix को विंडो पढ़ने की अनुमति नहीं दी है। सिस्टम सेटिंग > गोपनीयता और सुरक्षा > एक्सेसिबिलिटी में Phoenix चालू करें और फिर कोशिश करें। Phoenix अपने आप दोबारा नहीं पूछता।",
  "windowCapture.result.phoenixWindow":
    "सामने की विंडो Phoenix की थी, इसलिए कुछ नहीं पढ़ा गया। कोई दूसरी विंडो सामने लाकर फिर कोशिश करें।",
  "windowCapture.result.noWindow": "सामने कोई पढ़ने योग्य विंडो नहीं थी, इसलिए कुछ नहीं पढ़ा गया।",
  "windowCapture.review.heading": "संलग्न करने से पहले देख लें।",
  "windowCapture.review.from": "{app} से: {title}",
  "windowCapture.review.untitled": "(बिना शीर्षक की विंडो)",
  "windowCapture.review.size": "{n} अक्षर पढ़े गए।",
  "windowCapture.review.truncated": "टेक्स्ट सीमा पर काट दिया गया।",
  "windowCapture.review.textLabel": "कैप्चर की गई विंडो का टेक्स्ट",
  "windowCapture.review.noText": "(उस विंडो में कोई टेक्स्ट नहीं मिला।)",
  "windowCapture.review.secrets":
    "इस टेक्स्ट में कोई गोपनीय जानकारी ({kinds}) लगती है। इसे संलग्न करना अस्वीकार किया जाएगा।",
  "windowCapture.review.note":
    "यह वही है जो Phoenix ने पढ़ा। यह आपके प्रश्न के लिए डेटा है, निर्देश नहीं। जब तक आप बटन नहीं दबाते कुछ भी संलग्न नहीं होता, और यह अधिकतम एक घंटे तक मेमोरी में रहता है।",
  "windowCapture.review.accept": "यह टेक्स्ट संलग्न करें",
  "windowCapture.review.discard": "छोड़ दें",
};
