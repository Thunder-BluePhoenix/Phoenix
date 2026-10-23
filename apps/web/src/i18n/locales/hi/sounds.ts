// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { sounds as ensounds } from "../../en/sounds";

/** Machine-translated; unreviewed (see ../../README.md). */
export const sounds: Record<keyof typeof ensounds, string> = {
  "sounds.title": "Fawkes की आवाज़ें",
  "sounds.intro":
    "कुछ होने पर Fawkes जो छोटी ध्वनियाँ बजाता है। डिफ़ॉल्ट रूप से बंद। इन्हें Phoenix स्वयं बनाता है और ये शांत मोड, शांत घंटों, म्यूट होने, आपातकालीन रोक या डेमो के दौरान कभी नहीं बजतीं।",
  "sounds.enabled": "Fawkes को आवाज़ें करने दें",
  "sounds.volume": "आवाज़ का स्तर",
  "sounds.volumeValue": "{percent} प्रतिशत",
  "sounds.event.launch": "नमस्ते",
  "sounds.event.poke": "ठोंका",
  "sounds.event.dizzy": "चक्कर",
  "sounds.event.recover": "ठीक हुआ",
  "sounds.event.completion": "काम पूरा हुआ",
  "sounds.event.needsYou": "आपकी ज़रूरत है",
  "sounds.event.failure": "कुछ विफल हुआ",
  "sounds.preview.legend": "कोई ध्वनि सुनें",
  "sounds.preview.play": "बजाएँ: {name}",
  "sounds.preview.hint":
    "आवाज़ें बंद होने पर भी पूर्वावलोकन ऊपर के स्तर पर बजता है, और केवल तब जब आपने पेज का उपयोग किया हो।",
  "sounds.preview.muted": "Fawkes म्यूट है, इसलिए कुछ नहीं बजाया गया।",
  "sounds.preview.silentVolume": "आवाज़ का स्तर 0 है, इसलिए कुछ नहीं बजाया गया।",
  "sounds.preview.quiet":
    "शांत मोड, शांत घंटे, आपातकालीन रोक या डेमो चालू है, इसलिए कुछ नहीं बजाया गया।",
  "sounds.preview.noGesture": "पहले पेज पर क्लिक करें या कोई कुंजी दबाएँ, फिर दोबारा कोशिश करें।",
  "sounds.preview.failed": "इस डिवाइस पर ध्वनि नहीं बजाई जा सकी।",
  "sounds.saveFailed": "ध्वनि सेटिंग सहेजी नहीं जा सकीं।",
  "sounds.loadFailed": "ध्वनि सेटिंग लोड नहीं हो सकीं।",
  "sounds.note":
    "आपकी अपनी ध्वनियों का फ़ोल्डर अभी उपलब्ध नहीं है; केवल Phoenix की अंतर्निहित ध्वनियाँ उपयोग होती हैं।",
};
