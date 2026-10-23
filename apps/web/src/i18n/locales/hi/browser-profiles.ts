// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserProfiles as enBrowserProfiles } from "../../en/browser-profiles";

/** Machine-translated; unreviewed. */
export const browserProfiles: Record<keyof typeof enBrowserProfiles, string> = {
  "browserProfiles.title": "ब्राउज़र प्रोफ़ाइल",
  "browserProfiles.intro":
    "Phoenix का अभी अपना कोई ब्राउज़र नहीं है, इसलिए यहाँ कोई पेज नहीं खुलता: प्रोफ़ाइल बुकमार्क, सिंक के चुनाव और एक्सटेंशन का रिकॉर्ड भर है।",
  "browserProfiles.unavailable":
    "ब्राउज़र प्रोफ़ाइल उपलब्ध नहीं हैं: Phoenix Core के पास उन्हें सुरक्षित रखने के लिए ऑपरेटिंग सिस्टम का सीक्रेट स्टोर नहीं है।",
  "browserProfiles.loadFailed": "Phoenix Core से ब्राउज़र प्रोफ़ाइल नहीं पढ़े जा सके।",
  "browserProfiles.empty": "अभी कोई प्रोफ़ाइल नहीं है।",
  "browserProfiles.list": "प्रोफ़ाइल",
  "browserProfiles.create.name": "प्रोफ़ाइल का नाम",
  "browserProfiles.create.submit": "प्रोफ़ाइल बनाएँ",
  "browserProfiles.counts": "बुकमार्क: {bookmarks} · इतिहास: {history} · एक्सटेंशन: {extensions}",
  "browserProfiles.sync.label": "इस प्रोफ़ाइल को मेरे उपकरणों के बीच सिंक करें",
  "browserProfiles.sync.hint": "सिंक तभी चलता है जब सेटिंग्स → सिंक में खाता सिंक भी सेट हो।",
  "browserProfiles.import.label":
    "आयात करने के लिए बुकमार्क (ब्राउज़र से निर्यात की गई HTML फ़ाइल)",
  "browserProfiles.import.hint":
    "फ़ाइल की सामग्री पेस्ट करें। एक बार में अधिकतम 256 KiB; बड़े निर्यात को हिस्सों में बाँटें।",
  "browserProfiles.import.submit": "बुकमार्क आयात करें",
  "browserProfiles.import.result": "{imported} आयात किए, {skipped} छोड़े गए।",
  "browserProfiles.publish.submit": "मेरे अन्य उपकरणों पर प्रकाशित करें",
  "browserProfiles.publish.done": "प्रकाशित हो गया।",
  "browserProfiles.remove.start": "प्रोफ़ाइल हटाएँ",
  "browserProfiles.remove.ask":
    "“{name}” हटाएँ? इससे उसके बुकमार्क, इतिहास, एक्सटेंशन और सहेजे गए क्रेडेंशियल मिट जाएँगे, और इसे वापस नहीं किया जा सकता।",
  "browserProfiles.remove.done":
    "प्रोफ़ाइल हटा दी गई। उसके बुकमार्क, इतिहास, एक्सटेंशन और सहेजे गए क्रेडेंशियल मिटा दिए गए। {partition} नाम के अलग वेब स्टोरेज को Phoenix Core अभी साफ़ नहीं कर सकता।",
  "browserProfiles.devices.heading": "अन्य उपकरण",
  "browserProfiles.devices.check": "मेरे अन्य उपकरणों से प्रोफ़ाइल खोजें",
  "browserProfiles.devices.none": "आपके अन्य उपकरणों से कोई नई प्रोफ़ाइल नहीं है।",
  "browserProfiles.devices.found": "आपके अन्य उपकरणों की प्रोफ़ाइल",
  "browserProfiles.devices.adopt": "अपनाएँ",
  "browserProfiles.devices.adoptLabel": "{name} को इस उपकरण पर अपनाएँ",
  "browserProfiles.devices.adopted": "प्रोफ़ाइल अपना ली गई।",
  "browserProfiles.ext.heading": "एक्सटेंशन",
  "browserProfiles.ext.admin": "एक्सटेंशन आपके व्यवस्थापक द्वारा इंस्टॉल किए जाते हैं।",
  "browserProfiles.ext.none": "कोई एक्सटेंशन नहीं।",
  "browserProfiles.ext.loadFailed": "एक्सटेंशन नहीं पढ़े जा सके।",
  "browserProfiles.ext.version": "संस्करण {version}",
  "browserProfiles.ext.origins": "साइटें: {origins}",
  "browserProfiles.ext.permissions": "अनुमतियाँ: {permissions}",
  "browserProfiles.ext.noneListed": "कोई नहीं",
  "browserProfiles.ext.approved": "स्वीकृत",
  "browserProfiles.ext.notApproved": "स्वीकृत नहीं",
  "browserProfiles.ext.revoked": "निरस्त",
  "browserProfiles.ext.untrusted": "हस्ताक्षरकर्ता भरोसेमंद नहीं",
  "browserProfiles.ext.approve": "स्वीकृत करें",
  "browserProfiles.ext.approveLabel": "एक्सटेंशन {id} स्वीकृत करें",
  "browserProfiles.ext.withdraw": "स्वीकृति वापस लें",
  "browserProfiles.ext.withdrawLabel": "एक्सटेंशन {id} की स्वीकृति वापस लें",
  "browserProfiles.ext.remove": "हटाएँ",
  "browserProfiles.ext.removeLabel": "एक्सटेंशन {id} हटाएँ",
  "browserProfiles.ext.waiting": "स्वीकृति के प्रश्न पर आपके उत्तर की प्रतीक्षा है…",
  "browserProfiles.music.title": "संगीत साइटें",
  "browserProfiles.music.intro":
    "Phoenix संगीत नहीं चलाता। किसी साइट को चालू करने से Phoenix बस उसके लिए खोज का पता बनाता है, जिसे आप खुद खोलते हैं। आप चालू करें तब तक हर साइट बंद रहती है।",
  "browserProfiles.music.unavailable": "इस Phoenix Core में संगीत साइटें उपलब्ध नहीं हैं।",
  "browserProfiles.music.loadFailed": "Phoenix Core से संगीत साइटें नहीं पढ़ी जा सकीं।",
  "browserProfiles.music.list": "संगीत साइटें",
  "browserProfiles.music.hosts": "उपयोग किए गए पते: {hosts}",
  "browserProfiles.music.adBlocking":
    "YouTube चालू होने पर, विज्ञापन अवरोधन उसके अपने प्लेयर पर लागू नहीं होता।",
  "browserProfiles.music.site.youtube": "YouTube",
  "browserProfiles.music.site.soundcloud": "SoundCloud",
  "browserProfiles.music.site.bandcamp": "Bandcamp",
  "browserProfiles.music.site.spotify-web": "Spotify Web",
  "browserProfiles.music.site.other": "संगीत साइट {site}",
  "browserProfiles.music.search.label": "{site} में खोजें",
  "browserProfiles.music.search.submit": "खोजें",
  "browserProfiles.music.search.open": "खोज का पता (नए टैब में खुलता है):",
  "browserProfiles.music.search.badAddress": "Phoenix Core ने ऐसा पता लौटाया जो खोला नहीं जा सकता।",
};
