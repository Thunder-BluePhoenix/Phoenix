// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { safety as ensafety } from "../../en/safety";

/** Machine-translated; unreviewed (see ../../README.md). */
export const safety: Record<keyof typeof ensafety, string> = {
  "safety.title": "एजेंट सुरक्षा जाल",
  "safety.intro":
    "किसी सत्र में कोडिंग एजेंट के पहले रिपोर्ट किए गए संपादन से पहले, Phoenix प्रोजेक्ट का एक स्नैपशॉट प्रोजेक्ट की अपनी git रिपॉज़िटरी में सहेजता है (एक छिपा हुआ ref; आपकी ब्रांच, इंडेक्स और स्टैश को कभी छुआ नहीं जाता)। पूर्वावलोकन और आपकी मंज़ूरी के बाद आप फ़ाइलों को उस स्नैपशॉट पर वापस ला सकते हैं।",
  "safety.timing":
    "Claude Code किसी चरण की रिपोर्ट टूल चलने के बाद देता है, इसलिए स्नैपशॉट संपादन की पहली रिपोर्ट मिलने पर लिया जाता है: वह पहला संपादन आमतौर पर पहले से उसमें शामिल होता है। रोलबैक वह सब पूर्ववत करता है जो एजेंट ने उसके बाद किया, पहले संपादन को नहीं।",
  "safety.ignored":
    "जिन फ़ाइलों को git अनदेखा करता है (बिल्ड आउटपुट, लॉग, डिपेंडेंसी) उन्हें सहेजा नहीं जाता और उन्हें कभी पुनर्स्थापित या हटाया नहीं जाता।",
  "safety.loadFailed": "सुरक्षा जाल लोड नहीं हो सका: {error}",
  "safety.killSwitch": "किल स्विच चालू है, इसलिए कोई नया चेकपॉइंट नहीं लिया जाएगा।",

  "safety.warnings.title": "Fawkes की चेतावनियाँ",
  "safety.warnings.loop": "लूप",
  "safety.warnings.stall": "अटका हुआ",
  "safety.warnings.line": "{kind} · {repository} में {agent}: {reason}",

  "safety.checkpoints.title": "चेकपॉइंट",
  "safety.checkpoints.none":
    "अभी कोई चेकपॉइंट नहीं है। एजेंट के पहले संपादन की रिपोर्ट आने पर एक लिया जाता है।",
  "safety.checkpoints.row": "{repository} में {agent}",
  "safety.checkpoints.facts":
    "लिया गया {taken} · {count, plural, one {# फ़ाइल} other {# फ़ाइलें}} · {expires} तक रखा जाएगा",
  "safety.checkpoints.rolledBack": "{when} रोलबैक किया गया",
  "safety.checkpoints.preview": "रोलबैक का पूर्वावलोकन…",
  "safety.checkpoints.previewLabel":
    "{repository} में {agent} के चेकपॉइंट पर रोलबैक का पूर्वावलोकन करें",
  "safety.checkpoints.close": "पूर्वावलोकन बंद करें",

  "safety.skipped.title": "बिना चेकपॉइंट वाले सत्र",
  "safety.skipped.line": "{repository} में {agent}: {reason}",
  "safety.skipped.disabled": "सुरक्षा जाल बंद है",
  "safety.skipped.kill_switch": "किल स्विच चालू था",
  "safety.skipped.not_git": "यह फ़ोल्डर git रिपॉज़िटरी नहीं है, इसलिए स्नैपशॉट लेने को कुछ नहीं है",
  "safety.skipped.git_unavailable": "git चलाया नहीं जा सका",
  "safety.skipped.too_many_files": "प्रोजेक्ट में फ़ाइलें सीमा से अधिक हैं",
  "safety.skipped.too_large": "प्रोजेक्ट का आकार सीमा से बड़ा है",
  "safety.skipped.throttled": "इस प्रोजेक्ट में पिछले एक मिनट में पहले ही चेकपॉइंट बन चुका है",
  "safety.skipped.snapshot_failed": "git स्नैपशॉट नहीं ले सका",

  "safety.preview.title": "रोलबैक पूर्वावलोकन",
  "safety.preview.counts":
    "{restore, plural, one {# फ़ाइल पुनर्स्थापित की जाएगी} other {# फ़ाइलें पुनर्स्थापित की जाएँगी}}, {remove, plural, one {# नई फ़ाइल हटाई जाएगी} other {# नई फ़ाइलें हटाई जाएँगी}}, {kept, plural, one {# अंतर को वैसा ही छोड़ा जाएगा} other {# अंतरों को वैसा ही छोड़ा जाएगा}}।",
  "safety.preview.restore": "चेकपॉइंट पर पुनर्स्थापित",
  "safety.preview.remove": "नई फ़ाइलें जो हटाई जाएँगी",
  "safety.preview.kept": "वैसे ही छोड़ी गईं",
  "safety.preview.change.modified": "बदली गई",
  "safety.preview.change.deleted": "एजेंट द्वारा हटाई गई",
  "safety.preview.change.type_changed": "प्रकार बदला",
  "safety.preview.why.tracked_by_head": "git द्वारा ट्रैक की जा रही है, इसलिए हटाई नहीं जाती",
  "safety.preview.why.ignored": "git द्वारा अनदेखी की गई",
  "safety.preview.why.submodule": "एक सबमॉड्यूल",
  "safety.preview.why.unsafe_path": "पाथ को छूना सुरक्षित नहीं है",
  "safety.preview.why.not_a_file": "सामान्य फ़ाइल नहीं है",
  "safety.preview.truncated": "सूचियाँ छोटी की गई हैं; ऊपर की गिनतियाँ सटीक हैं।",
  "safety.preview.diff": "चेकपॉइंट के बाद के बदलाव",
  "safety.preview.diffTruncated": "डिफ़ को उसकी आकार सीमा पर काट दिया गया है।",
  "safety.preview.diffRedacted": "गोपनीय जैसा दिखने वाला कुछ टेक्स्ट छिपा दिया गया।",
  "safety.preview.diffEmpty": "दिखाने के लिए कोई टेक्स्ट बदलाव नहीं है।",
  "safety.preview.nothing": "फ़ाइलें पहले से चेकपॉइंट से मेल खाती हैं। रोलबैक करने को कुछ नहीं है।",
  "safety.preview.refusal.repository_missing": "प्रोजेक्ट अब यहाँ git रिपॉज़िटरी नहीं है।",
  "safety.preview.refusal.checkpoint_gone": "स्नैपशॉट अब रिपॉज़िटरी में नहीं है।",
  "safety.preview.refusal.head_moved":
    "चेकपॉइंट के बाद रिपॉज़िटरी का HEAD आगे बढ़ गया (कमिट या ब्रांच बदलने से)। Phoenix उसके पार रोलबैक नहीं करेगा; कुछ नहीं बदला गया।",
  "safety.preview.refusal.snapshot_failed": "Git वर्किंग ट्री को पढ़ नहीं सका।",
  "safety.preview.approvalNote":
    "रोलबैक करने से पहले आपकी मंज़ूरी माँगी जाती है। यह git इतिहास, ब्रांच, इंडेक्स या स्टैश को कभी नहीं बदलता, और इस पूर्वावलोकन के बाद फ़ाइलें बदल जाएँ तो यह मना कर देता है।",

  "safety.rollback.button": "रोलबैक करें…",
  "safety.rollback.waiting": "ऊपर मंज़ूरी सूची में आपकी मंज़ूरी की प्रतीक्षा है…",
  "safety.rollback.done":
    "रोलबैक हुआ: {restored, plural, one {# फ़ाइल पुनर्स्थापित} other {# फ़ाइलें पुनर्स्थापित}}, {removed, plural, one {# नई फ़ाइल हटाई गई} other {# नई फ़ाइलें हटाई गईं}}।",
  "safety.rollback.exact": "फ़ाइलें अब चेकपॉइंट से मेल खाती हैं।",
  "safety.rollback.inexact":
    "कुछ अंतर वैसे ही छोड़ दिए गए, इसलिए फ़ाइलें चेकपॉइंट से ठीक-ठीक मेल नहीं खातीं।",

  "safety.settings.title": "सेटिंग",
  "safety.settings.enabled": "एजेंट के पहले संपादन की रिपोर्ट आने पर चेकपॉइंट लें",
  "safety.settings.notify": "जब Fawkes लूप या अटकने की चेतावनी दे तो सूचना भेजें",
  "safety.settings.retention": "चेकपॉइंट कितने दिन रखें",
  "safety.settings.maxFiles": "इससे अधिक फ़ाइलों वाले प्रोजेक्ट छोड़ दें",
  "safety.settings.loopThreshold": "इतनी बार दोहराव के बाद लूप चेतावनी",
  "safety.settings.waitingMin":
    "जब कोई एजेंट आपकी प्रतीक्षा में इतनी देर रहे तो चेतावनी दें (मिनट)",
  "safety.settings.idleMin": "जब कोई सक्रिय एजेंट इतनी देर चुप रहे तो चेतावनी दें (मिनट)",
  "safety.settings.saved": "सहेजा गया।",
  "safety.settings.detectNote":
    "हुक न तो एग्ज़िट कोड बताते हैं और न फ़ाइल की सामग्री, इसलिए लूप का मतलब है एक ही कमांड बार-बार चलना, या ऐसी फ़ाइल जिसके संपादन एक-दूसरे को पूर्ववत करते रहते हैं (पंक्ति गिनती के आधार पर)।",
};
