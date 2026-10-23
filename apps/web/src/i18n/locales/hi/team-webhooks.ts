// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamWebhooks as enTeamWebhooks } from "../../en/team-webhooks";

/** Machine-translated; unreviewed. */
export const teamWebhooks: Record<keyof typeof enTeamWebhooks, string> = {
  "teamWebhooks.title": "आने वाले वेबहुक",
  "teamWebhooks.intro":
    "आने वाले वेबहुक डिफ़ॉल्ट रूप से बंद हैं। एक स्रोत किसी दूसरे टूल को अपना पता और गुप्त कुंजी देता है; जब वह टूल सही ढंग से हस्ताक्षरित संदेश भेजता है, तो Phoenix उसे एक स्थानीय इवेंट बना देता है। कहीं कुछ भेजा नहीं जाता, और स्रोत जो भेजता है उसे अविश्वसनीय टेक्स्ट माना जाता है।",
  "teamWebhooks.notAvailable":
    "आने वाले वेबहुक उपलब्ध नहीं हैं: इस Phoenix Core के पास स्रोतों की गुप्त कुंजियाँ रखने के लिए ऑपरेटिंग सिस्टम का सीक्रेट स्टोर नहीं है।",
  "teamWebhooks.loadFailed": "आने वाले वेबहुक लोड नहीं हो सके।",
  "teamWebhooks.master": "आने वाले वेबहुक स्वीकार करें",
  "teamWebhooks.secret.title": "{id} की गुप्त कुंजी",
  "teamWebhooks.secret.warning":
    "यह गुप्त कुंजी केवल एक बार दिखाई जाती है। इसे अभी कॉपी करें और भेजने वाले टूल में रखें। Phoenix इसे केवल ऑपरेटिंग सिस्टम के सीक्रेट स्टोर में रखता है और दोबारा नहीं दिखा सकता; खो जाए तो स्रोत हटाकर नया बनाएँ।",
  "teamWebhooks.secret.path": "भेजने का पता (इस Core पर)",
  "teamWebhooks.secret.label": "हस्ताक्षर की गुप्त कुंजी",
  "teamWebhooks.secret.copy": "गुप्त कुंजी कॉपी करें",
  "teamWebhooks.secret.copied": "क्लिपबोर्ड पर कॉपी किया गया।",
  "teamWebhooks.secret.copyFailed":
    "Phoenix क्लिपबोर्ड इस्तेमाल नहीं कर सका। बंद करने से पहले ऊपर की गुप्त कुंजी चुनकर हाथ से कॉपी करें।",
  "teamWebhooks.secret.done": "मैंने सहेज ली, बंद करें",
  "teamWebhooks.sources.title": "स्रोत",
  "teamWebhooks.sources.none": "आपने अभी तक कोई वेबहुक स्रोत नहीं बनाया है।",
  "teamWebhooks.row.path": "पता: {path}",
  "teamWebhooks.row.types": "इवेंट प्रकार: {types}",
  "teamWebhooks.row.never": "अभी तक कुछ प्राप्त नहीं हुआ।",
  "teamWebhooks.row.last": "आख़िरी स्वीकार किया गया: {time}",
  "teamWebhooks.delete.label": "स्रोत {id} हटाएँ",
  "teamWebhooks.delete.ask":
    "{id} हटाएँ? इसकी गुप्त कुंजी तुरंत काम करना बंद कर देगी और भेजने वाले टूल को बदलना होगा।",
  "teamWebhooks.create.title": "स्रोत बनाएँ",
  "teamWebhooks.create.id": "स्रोत का नाम",
  "teamWebhooks.create.idHint": "3 से 32 अक्षर: छोटे अक्षर, अंक, - या _, और शुरुआत किसी अक्षर से।",
  "teamWebhooks.create.types": "वह किन इवेंट प्रकारों को भेज सकता है",
  "teamWebhooks.create.typesHint":
    "अल्पविराम से अलग करें, जैसे ci.finished। हर प्रकार इनमें से किसी एक से शुरू होता है: {namespaces}।",
  "teamWebhooks.create.typesTooMany": "अधिकतम {max} इवेंट प्रकार दें।",
  "teamWebhooks.create.typesInvalid":
    "इवेंट प्रकार बिंदुओं से जुड़े छोटे अक्षरों के शब्द होते हैं, जैसे ci.finished।",
  "teamWebhooks.create.typesNamespace":
    "इवेंट प्रकार इनमें से किसी एक से शुरू होना चाहिए: {namespaces}।",
  "teamWebhooks.create.limit": "आप {max} स्रोतों की सीमा तक पहुँच गए हैं। पहले एक हटाएँ।",
  "teamWebhooks.create.submit": "स्रोत बनाएँ",
  "teamWebhooks.row.disabledNote":
    "यह स्रोत अक्षम है: इसे भेजा गया सब कुछ Phoenix अस्वीकार करता है।",
  "teamWebhooks.toggle.enable": "सक्षम करें",
  "teamWebhooks.toggle.disable": "अक्षम करें",
  "teamWebhooks.toggle.enableLabel": "स्रोत {id} सक्षम करें",
  "teamWebhooks.toggle.disableLabel": "स्रोत {id} अक्षम करें",
  "teamWebhooks.rotate.button": "सीक्रेट बदलें",
  "teamWebhooks.rotate.label": "स्रोत {id} का सीक्रेट बदलें",
  "teamWebhooks.rotate.ask":
    "{id} का सीक्रेट बदलें? पुराना सीक्रेट तुरंत काम करना बंद कर देता है, इसलिए नया सीक्रेट देने तक भेजने वाला टूल अस्वीकार किया जाएगा।",
  "teamWebhooks.secret.rotatedNote":
    "यह नया सीक्रेट है। पुराना सीक्रेट काम करना बंद कर चुका है; भेजने वाले टूल में यही डालें।",
};
