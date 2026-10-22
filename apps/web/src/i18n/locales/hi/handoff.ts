// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { handoff as enhandoff } from "../../en/handoff";

/** Machine-translated; unreviewed (see ../../README.md). */
export const handoff: Record<keyof typeof enhandoff, string> = {
  "handoff.title": "हैंडऑफ़ नोट",
  "handoff.intro":
    "हैंडऑफ़ नोट एक छोटा सारांश है जिसे Phoenix तय नियमों से, बिना किसी मॉडल के, उस आधार पर बनाता है जो कोडिंग एजेंट ने सत्र के दौरान बताया: लक्ष्य (केवल तब जब एजेंट ने कार्य का शीर्षक बताया हो), बदली गई फ़ाइलें और पंक्तियों की गिनती, चलाए गए कमांड (गोपनीय जानकारी हटाकर) और खुले प्रश्न। Phoenix ने इनमें से कुछ भी जाँचा नहीं है, इसलिए इसे एजेंट के कथन की तरह लें, प्रमाण की तरह नहीं। नोट इस कंप्यूटर पर Phoenix के डेटा फ़ोल्डर में रखे जाते हैं, जिन्हें केवल आप पढ़ सकते हैं; सबसे नए 50 रखे जाते हैं, और गोपनीयता में “handoff” के लिए “सब कुछ हटाएँ” उन्हें मिटा देता है।",

  "handoff.settings.legend": "हैंडऑफ़ सेटिंग",
  "handoff.settings.auto": "एजेंट का सत्र समाप्त होने पर एक नोट लिखें",
  "handoff.settings.allowCloud":
    "वैकल्पिक सारांश क्लाउड मॉडल को लिखने दें (बंद: केवल इसी डिवाइस का मॉडल)",
  "handoff.settings.cloudWarning":
    "इसे चालू करने पर, जब आप सारांश माँगेंगे तो नोट का पाठ (छिपाए गए कमांड और फ़ाइलों के नाम) इस कंप्यूटर से बाहर किसी क्लाउड मॉडल तक जा सकता है। AI सेटिंग की क्लाउड अनुमतियाँ इस चुनाव के ऊपर भी लागू रहती हैं।",
  "handoff.settings.saved": "सेटिंग सहेजी गई।",
  "handoff.settings.unavailable": "हैंडऑफ़ सेटिंग लोड नहीं हो सकीं।",
  "handoff.notes.unavailable": "हैंडऑफ़ नोट लोड नहीं हो सके।",
  "handoff.guard.unavailable": "सीक्रेट गार्ड के परिणाम लोड नहीं हो सके।",
  "handoff.notes.title": "सहेजे गए नोट",
  "handoff.notes.listLabel": "हैंडऑफ़ नोट",
  "handoff.notes.empty": "अभी तक कोई हैंडऑफ़ नोट नहीं लिखा गया है।",
  "handoff.notes.open": "{date} {time} · {agent}",
  "handoff.notes.meta": "{project} · {files} · {lines}",
  "handoff.notes.files": "{count, plural, one {# फ़ाइल} other {# फ़ाइलें}}",
  "handoff.notes.lines": "+{added} −{removed}",
  "handoff.notes.noProject": "कोई प्रोजेक्ट नहीं",
  "handoff.notes.hasSummary": "मॉडल सारांश",
  "handoff.notes.detailLabel": "चुना गया नोट",
  "handoff.notes.loading": "नोट लोड हो रहा है…",
  "handoff.notes.trigger.auto": "अपने-आप लिखा गया",
  "handoff.notes.trigger.user": "आपने माँगा था",
  "handoff.notes.textLabel": "नोट का पाठ",

  "handoff.summary.title": "मॉडल सारांश",
  "handoff.summary.processedBy": "किसने लिखा: {by}",
  "handoff.summary.warning":
    "यह सारांश एक मॉडल ने लिखा है और गलत हो सकता है। भरोसा करने से पहले इसे जाँच लें।",
  "handoff.summary.add": "मॉडल सारांश जोड़ें",
  "handoff.summary.note":
    "Phoenix केवल इसी डिवाइस के मॉडल का उपयोग करता है, जब तक कि आपने ऊपर क्लाउड मॉडल की अनुमति न दी हो।",
  "handoff.summary.added": "सारांश जोड़ा गया।",

  "handoff.delete.button": "नोट हटाएँ",
  "handoff.delete.done": "नोट हटा दिया गया।",

  "handoff.generate.title": "किसी सत्र के लिए नोट लिखें",
  "handoff.generate.sessionLabel": "सत्र",
  "handoff.generate.choose": "एक सत्र चुनें",
  "handoff.generate.option": "{agent} · {repository} · {time}",
  "handoff.generate.none":
    "अभी कोई कोडिंग-एजेंट सत्र ज्ञात नहीं है, इसलिए नोट लिखने के लिए कुछ नहीं है।",
  "handoff.generate.button": "नोट लिखें",
  "handoff.generate.done": "नोट लिख दिया गया।",

  "handoff.attach.title": "इस नोट का उपयोग करें",
  "handoff.attach.targetLabel": "यह कहाँ जाएगा",
  "handoff.attach.target.commit_message": "कमिट संदेश",
  "handoff.attach.target.pr_description": "पुल रिक्वेस्ट का विवरण",
  "handoff.attach.target.task": "GitHub इश्यू",
  "handoff.attach.repositoryLabel": "GitHub रिपॉज़िटरी (owner/name)",
  "handoff.attach.repositoryInvalid": "रिपॉज़िटरी को owner/name के रूप में लिखें, जैसे acme/app।",
  "handoff.attach.preview": "पूर्वावलोकन",
  "handoff.attach.previewAgain": "फिर से पूर्वावलोकन करें",
  "handoff.attach.confirm": "पुष्टि करें",
  "handoff.attach.previewLabel": "जो संलग्न होगा उसका पूर्वावलोकन",
  "handoff.attach.issueTitle": "इश्यू का शीर्षक: {title}",
  "handoff.attach.textLabel": "ठीक यही पाठ",
  "handoff.attach.delivery.copy":
    "Phoenix इसे कहीं नहीं लिखता: कॉपी करने के लिए पुष्टि करें, फिर खुद पेस्ट करें।",
  "handoff.attach.delivery.copyPr":
    "Phoenix के पास अभी पुल रिक्वेस्ट का विवरण बदलने वाला कोई कमांड नहीं है: केवल कॉपी। कॉपी करने के लिए पुष्टि करें, फिर खुद पेस्ट करें।",
  "handoff.attach.delivery.issue":
    "Phoenix github क्षमता से {repository} में एक GitHub इश्यू बनाएगा। आपसे एक बार फिर पुष्टि माँगी जाएगी, और इसके लिए लिखने वाला टोकन चाहिए।",
  "handoff.attach.stale":
    "इस पूर्वावलोकन के बाद नोट बदल गया, इसलिए कुछ भी संलग्न नहीं हुआ। फिर से पूर्वावलोकन करें।",
  "handoff.attach.copied": "क्लिपबोर्ड पर कॉपी हो गया। जहाँ चाहिए वहाँ पेस्ट करें।",
  "handoff.attach.copyByHand":
    "Phoenix क्लिपबोर्ड का उपयोग नहीं कर सका। नीचे का पाठ चुनें और हाथ से कॉपी करें।",
  "handoff.attach.issueCreated": "{repository} में इश्यू #{number} बनाया गया।",
  "handoff.attach.issueExisting": "{repository} में इश्यू #{number} पहले से मौजूद था।",
  "handoff.attach.issueAddress": "पता: {url}",

  "handoff.guard.title": "सीक्रेट गार्ड",
  "handoff.guard.intro":
    "सीक्रेट गार्ड ऊपर के एजेंट हुक इंस्टॉलर के साथ लगता है: यह उन हुक का हिस्सा है जिन्हें Phoenix Claude Code और Codex में जोड़ता है। यह किसी टूल कॉल, git commit या git push को रोकता है जिसके इनपुट या स्टेज किए गए बदलावों में Phoenix के डिटेक्टर द्वारा पहचाना गया कोई गोपनीय रहस्य हो, और एजेंट को बताता है कि किस प्रकार का रहस्य कहाँ मिला, रहस्य को कभी नहीं बताता।",
  "handoff.guard.override":
    "आप किसी एक रोक को केवल अनुमोदन कार्ड के ज़रिए ही पलट सकते हैं; एजेंट इसे नहीं पलट सकता।",
  "handoff.guard.heuristic":
    "डिटेक्टर एक अनुमान-आधारित तरीका है, यह वादा नहीं कि कुछ भी लीक नहीं होगा: जिस रहस्य को यह नहीं पहचानता वह पकड़ा नहीं जाता।",
  "handoff.guard.failOpen":
    "यदि Phoenix Core या हुक नहीं चल पाता, तो एजेंट का काम जारी रहता है (गार्ड खुला छोड़कर विफल होता है), सिवाय इसके कि मिला हुआ रहस्य हमेशा रोका जाता है।",
  "handoff.guard.countsLabel": "सीक्रेट गार्ड के परिणाम",
  "handoff.guard.allowed": "जाँच के बाद अनुमत: {count}",
  "handoff.guard.blocked": "रोके गए: {count}",
  "handoff.guard.overridden": "आपकी मंज़ूरी के बाद अनुमत: {count}",
  "handoff.guard.since": "{date} {time} से गिना गया",
  "handoff.guard.noResults": "अभी कोई परिणाम नहीं।",
  "handoff.guard.recentLabel": "सीक्रेट गार्ड के हाल के परिणाम",
  "handoff.guard.row": "{date} {time} · {agent} · {tool}",
  "handoff.guard.outcome.blocked": "रोका गया",
  "handoff.guard.outcome.overridden": "आपकी मंज़ूरी के बाद अनुमत",
  "handoff.guard.finding": "{kind}, स्थान: {location}",
};
