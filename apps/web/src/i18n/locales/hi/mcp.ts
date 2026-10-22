// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { mcp as enmcp } from "../../en/mcp";

/** Machine-translated; unreviewed (see ../../README.md). */
export const mcp: Record<keyof typeof enmcp, string> = {
  "mcp.title": "Phoenix MCP सर्वर",
  "mcp.intro":
    "इस कंप्यूटर पर कोडिंग एजेंट और अन्य MCP क्लाइंट को Phoenix का संदर्भ पढ़ने और आपसे स्वीकृति माँगने देता है। जब तक आप चालू नहीं करते यह बंद रहता है, और हर क्लाइंट को तब तक कुछ नहीं मिलता जब तक आप अनुमति न दें।",
  "mcp.unavailable": "MCP सर्वर की सेटिंग लोड नहीं हो सकीं।",
  "mcp.demoUnavailable": "डेमो मोड में MCP सर्वर उपलब्ध नहीं है।",
  "mcp.warning.title": "चालू करने से पहले",
  "mcp.warning.local":
    "यह केवल इसी कंप्यूटर (127.0.0.1) पर एक अलग श्रोता खोलता है। अन्य कंप्यूटर और वेब पेज इस तक नहीं पहुँच सकते।",
  "mcp.warning.token":
    "हर क्लाइंट का अपना टोकन होता है, जो सिर्फ़ एक बार दिखाया जाता है। टोकन रखने वाला कोई भी प्रोग्राम वह सब इस्तेमाल कर सकता है जो आपने उस क्लाइंट को दिया है।",
  "mcp.warning.untrusted":
    "Phoenix जो लौटाता है वह अविश्वसनीय डेटा के रूप में चिह्नित होता है, फिर भी उसे पढ़ने वाला मॉडल उसके भीतर के पाठ से भ्रमित हो सकता है। केवल उतना ही दें जितना ज़रूरी हो।",
  "mcp.warning.approval":
    "क्लाइंट द्वारा माँगी गई स्वीकृति आपकी अन्य एजेंट स्वीकृतियों के साथ दिखती है। केवल आप, यहाँ या जोड़े गए फ़ोन पर, उसका उत्तर दे सकते हैं।",
  "mcp.enable.label": "इस कंप्यूटर के MCP क्लाइंट को कनेक्ट होने दें",
  "mcp.saved.on": "MCP सर्वर चालू है।",
  "mcp.saved.off": "MCP सर्वर बंद है।",
  "mcp.port.label": "पोर्ट",
  "mcp.port.save": "पोर्ट सहेजें",
  "mcp.port.saved": "पोर्ट सहेजा गया।",
  "mcp.killSwitch":
    "आपातकालीन रोक चालू है: MCP सर्वर बंद है। आपातकालीन रोक हटाने के बाद इसे यहाँ फिर चालू करें।",
  "mcp.notListening": "MCP सर्वर चालू है लेकिन सुन नहीं रहा। जाँचें कि पोर्ट खाली है।",
  "mcp.listening.url": "पता",
  "mcp.new.title": "क्लाइंट जोड़ें",
  "mcp.new.name": "क्लाइंट का नाम",
  "mcp.new.create": "क्लाइंट बनाएँ",
  "mcp.new.created": "क्लाइंट बन गया। अभी उसे कोई अनुमति नहीं है।",
  "mcp.token.title": "यह टोकन अभी कॉपी करें",
  "mcp.token.note":
    "यह सिर्फ़ एक बार दिखता है और Phoenix केवल इसका फ़िंगरप्रिंट रखता है। इसे क्लाइंट के परिवेश में PHOENIX_MCP_TOKEN के रूप में रखें, कभी कमांड लाइन में नहीं।",
  "mcp.token.label": "क्लाइंट टोकन",
  "mcp.token.copy": "टोकन कॉपी करें",
  "mcp.token.copied": "टोकन कॉपी हो गया।",
  "mcp.token.copyFailed": "कॉपी नहीं हो सका। टोकन चुनकर हाथ से कॉपी करें।",
  "mcp.token.done": "मैंने इसे सहेज लिया है",
  "mcp.clients.title": "क्लाइंट",
  "mcp.clients.none": "अभी कोई क्लाइंट नहीं।",
  "mcp.client.created": "{date} को बनाया गया",
  "mcp.client.id": "क्लाइंट ID {id} (इस क्लाइंट के अनुमोदन कार्ड पर दिखाई देता है)",
  "mcp.client.lastUsed": "आख़िरी उपयोग {when}",
  "mcp.client.neverUsed": "कभी उपयोग नहीं हुआ",
  "mcp.client.revokedOn": "{date} को रद्द किया गया",
  "mcp.client.noGrants":
    "कोई अनुमति नहीं: यह क्लाइंट कनेक्ट हो सकता है पर हर चीज़ से मना कर दिया जाता है।",
  "mcp.grants.title": "{name} क्या कर सकता है",
  "mcp.grants.tools": "पढ़ने के टूल",
  "mcp.grants.tool.phoenix_activity": "हाल के एजेंट सत्र",
  "mcp.grants.tool.phoenix_meetings": "बैठकों के निर्णय और सारांश",
  "mcp.grants.tool.phoenix_graph_query": "ज्ञान-ग्राफ़ के प्रश्न",
  "mcp.grants.tool.phoenix_ci_git_state": "Git और CI की स्थिति",
  "mcp.grants.tool.phoenix_memory_search": "मेमोरी खोज",
  "mcp.grants.actions": "क्रियाएँ",
  "mcp.grants.requestApproval": "मुझसे स्वीकृति माँगे",
  "mcp.grants.notify": "Fawkes को अपनी स्थिति बताए (काम कर रहा, प्रतीक्षा में, पूरा)",
  "mcp.grants.memory": "पढ़ने योग्य मेमोरी",
  "mcp.grants.memory.note":
    "मेमोरी खोज, ग्राफ़ और बैठकें केवल नीचे के दायरे देखती हैं, वह सब नहीं जो आप देख सकते हैं।",
  "mcp.grants.memory.none": "कोई मेमोरी दायरा नहीं दिया गया।",
  "mcp.grants.memory.scope": "दायरा",
  "mcp.grants.memory.sensitivity": "अधिकतम संवेदनशीलता",
  "mcp.grants.memory.add": "दायरा जोड़ें",
  "mcp.grants.memory.remove": "दायरा {scope} हटाएँ",
  "mcp.grants.memory.invalid": "दायरा *, global, या repo:, path:, meeting: के बाद पाठ होता है।",
  "mcp.sensitivity.public": "सार्वजनिक",
  "mcp.sensitivity.internal": "आंतरिक",
  "mcp.sensitivity.sensitive": "संवेदनशील (बैठकें)",
  "mcp.grants.save": "अनुमतियाँ सहेजें",
  "mcp.grants.saved": "अनुमतियाँ सहेजी गईं।",
  "mcp.revoke": "{name} को रद्द करें",
  "mcp.revoke.ask": "{name} को रद्द करें? उसे तुरंत मना कर दिया जाता है, कॉल के बीच में भी।",
  "mcp.revoke.yes": "हाँ, रद्द करें",
  "mcp.revoke.no": "रखें",
  "mcp.revoke.done": "क्लाइंट रद्द किया गया।",
};
