// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { recapNotice as enrecapNotice } from "../../en/recap-notice";

/** Machine-translated; unreviewed. */
export const recapNotice: Record<keyof typeof enrecapNotice, string> = {
  "recapNotice.title": "साप्ताहिक रिकैप सूचना",
  "recapNotice.intro":
    "हर सोमवार स्थानीय समय 09:00 बजे, Phoenix की अपनी सूचना सूची में पिछले सप्ताह की गिनतियों के साथ एक सूचना दिखाएँ। डिफ़ॉल्ट रूप से बंद। पाठ निश्चित है और केवल संख्याएँ हैं (कोई नाम, पथ या शीर्षक नहीं); कोई मॉडल कॉल या नेटवर्क अनुरोध नहीं होता, और Proactive के शांत घंटों, सूचना शांत मोड तथा आपातकालीन रोक के दौरान यह छोड़ दी जाती है। सप्ताह में अधिकतम एक; यदि सोमवार को Phoenix नहीं चल रहा था तो उसी सप्ताह बाद में एक बार दिखेगी।",
  "recapNotice.enable": "सोमवार को साप्ताहिक रिकैप सूचना दिखाएँ",
  "recapNotice.last": "अंतिम सूचना सप्ताह {week} की थी।",
  "recapNotice.never": "अभी तक कोई साप्ताहिक रिकैप सूचना नहीं दिखाई गई।",
  "recapNotice.error": "साप्ताहिक रिकैप सूचना की सेटिंग लोड या सहेजी नहीं जा सकी।",
  "recapNotice.midweek": "सप्ताह के बीच में चालू करने पर यह अगले सोमवार तक प्रतीक्षा करती है।",
};
