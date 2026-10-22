// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { signals as ensignals } from "../../en/signals";

/** Machine-translated; unreviewed. */
export const signals: Record<keyof typeof ensignals, string> = {
  "signals.title": "इंजीनियरिंग संकेत",
  "signals.intro":
    "चुनी गई रिपॉज़िटरी में निर्भरता सलाह, अस्थिर परीक्षण, अवधि रुझान और कॉन्फ़िगरेशन कुंजियों में अंतर देखें। फ़ाइलें नहीं बदली जातीं।",
  "signals.root": "रिपॉज़िटरी फ़ोल्डर",
  "signals.add": "फ़ोल्डर देखें",
  "signals.remove": "देखना बंद करें",
  "signals.refresh": "अभी जाँचें",
  "signals.empty": "देखी जा रही रिपॉज़िटरी में कोई वर्तमान संकेत नहीं।",
  "signals.unconfigured": "देखने के लिए रिपॉज़िटरी फ़ोल्डर चुनें।",
  "signals.error": "इंजीनियरिंग संकेत पढ़े नहीं जा सके।",
  "signals.advisory": "निर्भरता सलाह",
  "signals.flaky_test": "अस्थिर परीक्षण",
  "signals.duration_trend": "अवधि बढ़ी",
  "signals.config_drift": "कॉन्फ़िगरेशन कुंजी गायब",
  "signals.optin":
    "सक्रिय सूचनाओं के लिए स्पष्ट सहमति आवश्यक है; शांत समय और प्रति-घंटा सीमा लागू हैं।",
  "signals.privacy": "केवल कुंजियों के नाम की तुलना होती है; मान कभी नहीं दिखते।",
  "signals.unknown.advisories":
    "निर्भरता सलाह का मूल्यांकन नहीं हुआ (स्थिति अज्ञात, सुरक्षित नहीं):",
  "signals.unknown.history":
    "परीक्षण इतिहास और अवधि रुझान का मूल्यांकन नहीं हुआ (स्थिति अज्ञात, सुरक्षित नहीं):",
};
