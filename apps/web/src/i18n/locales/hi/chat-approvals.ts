// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { chatApprovals as enChatApprovals } from "../../en/chat-approvals";

/** Machine-translated; unreviewed. */
export const chatApprovals: Record<keyof typeof enChatApprovals, string> = {
  "chatApprovals.title": "चैट अनुमोदन",
  "chatApprovals.notAvailable": "इस Phoenix Core में चैट अनुमोदन उपलब्ध नहीं हैं।",
  "chatApprovals.intro":
    "Slack या Discord से किसी लंबित एजेंट या Phoenix अनुमोदन का उत्तर दें, और Teams में सूचना पाएँ। जब तक आप यहाँ चालू नहीं करते, सब कुछ बंद है, हर प्रदाता और हर प्रोजेक्ट के लिए।",
  "chatApprovals.limits":
    "असली Slack, Discord या Teams वर्कस्पेस के साथ कभी उपयोग नहीं किया गया: कोड केवल नकली कॉलबैक से जाँचा गया है। Teams केवल सूचना के लिए है (Phoenix का लिंक, कभी अनुमति बटन नहीं)। बटन दबाने को प्रदाता के हस्ताक्षर और आपकी अनुमोदनकर्ता सूची से जाँचा जाता है, और निर्णय का ऑडिट होता है।",
  "chatApprovals.noDm":
    "सारांश और सूचनाएँ केवल नीचे तय किए चैनल में जाती हैं। किसी व्यक्ति को सीधा संदेश नहीं बनाया गया है।",
  "chatApprovals.capabilityOff": "चैट अनुमोदन क्षमता बंद है, इसलिए कुछ नहीं भेजा जाता।",
  "chatApprovals.enable": "क्षमता चालू करें",
  "chatApprovals.ready": "तैयार: यह प्रदाता कार्ड पोस्ट कर सकता है।",
  "chatApprovals.notReady":
    "तैयार नहीं: इसे चालू करना होगा, वर्कस्पेस आईडी, चैनल आईडी और कम से कम एक अनुमोदनकर्ता के साथ।",
  "chatApprovals.teamsNote":
    "Teams केवल सूचना के लिए है। इसका वेबहुक पता और लिंक कुंजी नीचे सहेजे जाते हैं।",
  "chatApprovals.save": "चैट अनुमोदन सहेजें",
  "chatApprovals.saved": "सहेजा गया।",
  "chatApprovals.provider.slack": "Slack",
  "chatApprovals.provider.discord": "Discord",
  "chatApprovals.provider.teams": "Microsoft Teams",
  "chatApprovals.enabledNamed": "{name} चालू करें",
  "chatApprovals.notifyNamed": "{name} पर सामान्य सूचना भेजें",
  "chatApprovals.digestNamed": "{name} को सारांश में शामिल करें",
  "chatApprovals.notify": "चैट के लिए चालू न किए गए अनुरोधों की सूचना दें (विवरण के बिना)",
  "chatApprovals.digest.send": "सारांश प्राप्त करें",
  "chatApprovals.workspace.slack": "Slack वर्कस्पेस (टीम) आईडी",
  "chatApprovals.workspace.discord": "Discord सर्वर (guild) आईडी",
  "chatApprovals.channel.slack": "Slack चैनल आईडी",
  "chatApprovals.channel.discord": "Discord चैनल आईडी",
  "chatApprovals.approvers.label": "निर्णय ले सकने वाले {name} उपयोगकर्ता आईडी (प्रति पंक्ति एक)",
  "chatApprovals.approvers.hint":
    "केवल अक्षर और अंक, प्रत्येक अधिकतम 24 वर्ण, अधिकतम 20। खाली सूची का अर्थ है कोई निर्णय नहीं ले सकता।",
  "chatApprovals.projects.title": "अनुमत प्रोजेक्ट",
  "chatApprovals.projects.hint":
    "केवल इन प्रोजेक्टों के एजेंट अनुमोदनों का उत्तर चैट से दिया जा सकता है। खाली: कोई नहीं।",
  "chatApprovals.projects.label": "प्रोजेक्ट नाम (प्रति पंक्ति एक)",
  "chatApprovals.digest.title": "निर्धारित सारांश",
  "chatApprovals.digest.intro":
    "डिफ़ॉल्ट रूप से बंद। ऊपर के चैनल में गिनती और छोटे अनुमोदन आईडी भेजता है, केवल उन प्रदाताओं को जो सारांश पाते हैं, शांत घंटों में कभी नहीं और कुछ न होने पर कभी नहीं।",
  "chatApprovals.digest.enabled": "निर्धारित सारांश भेजें",
  "chatApprovals.digest.interval": "सारांशों के बीच मिनट",
  "chatApprovals.digest.hint": "{min} (एक घंटा) से {max} मिनट (एक सप्ताह) तक।",
  "chatApprovals.cred.title": "क्रेडेंशियल",
  "chatApprovals.cred.writeOnly":
    "केवल लिखने के लिए। आप जो टाइप करते हैं वह Core के क्रेडेंशियल स्टोर में भेजा जाता है और तुरंत इस पृष्ठ से हटा दिया जाता है। सहेजे गए मान फिर कभी नहीं दिखाए जाते।",
  "chatApprovals.cred.save": "सहेजें",
  "chatApprovals.cred.stored": "सहेजा हुआ",
  "chatApprovals.cred.notStored": "सहेजा नहीं गया",
  "chatApprovals.cred.remove": "हटाएँ",
  "chatApprovals.cred.removeNamed": "सहेजा हुआ {name} हटाएँ",
  "chatApprovals.field.slackBot": "Slack बॉट टोकन",
  "chatApprovals.field.slackSigning": "Slack हस्ताक्षर रहस्य",
  "chatApprovals.field.discordBot": "Discord बॉट टोकन",
  "chatApprovals.field.discordKey": "Discord एप्लिकेशन सार्वजनिक कुंजी",
  "chatApprovals.field.teamsWebhook": "Teams वेबहुक पता",
  "chatApprovals.field.teamsKey": "Teams लिंक कुंजी",
  "chatApprovals.error.ids": "वर्कस्पेस और चैनल आईडी में केवल अक्षर और अंक हों, अधिकतम 24 वर्ण।",
  "chatApprovals.error.approvers":
    "अनुमोदनकर्ता आईडी में केवल अक्षर और अंक हों, प्रत्येक अधिकतम 24 वर्ण, अधिकतम 20।",
  "chatApprovals.error.projects":
    "प्रोजेक्ट नाम 1 से 120 दिखने वाले वर्णों के हों, अधिकतम 200 प्रोजेक्ट।",
  "chatApprovals.error.interval":
    "सारांश अंतराल 60 से 10080 के बीच पूर्ण संख्या (मिनट) होना चाहिए।",
  "chatApprovals.error.save": "चैट अनुमोदन सेटिंग सहेजी नहीं जा सकी।",
  "chatApprovals.error.capability": "चैट अनुमोदन क्षमता बदली नहीं जा सकी।",
  "chatApprovals.error.unavailable":
    "इस Phoenix Core में OS क्रेडेंशियल स्टोर नहीं है, इसलिए क्रेडेंशियल नहीं रखा जा सकता।",
  "chatApprovals.error.cred": "क्रेडेंशियल सहेजा या हटाया नहीं गया।",
  "chatApprovals.error.credShape":
    "यह मान इस फ़ील्ड के लिए सही नहीं लगता, इसलिए नहीं भेजा गया। जाँचकर फिर कोशिश करें।",
};
