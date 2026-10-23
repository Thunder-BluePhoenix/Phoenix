// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { digest as endigest } from "../../en/digest";

/** Machine-translated; unreviewed. */
export const digest: Record<keyof typeof endigest, string> = {
  "digest.title": "दैनिक सारांश",
  "digest.yesterday": "कल",
  "digest.today": "आज (पुष्ट योजनाएँ)",
  "digest.blockers": "बाधाएँ",
  "digest.endOfDay": "दिन का अंत",
  "digest.source": "स्रोत",
  "digest.none": "कोई लिंक की गई गतिविधि नहीं",
  "digest.date": "तारीख",
  "digest.localNote":
    "लिंक की गई गतिविधि से स्थानीय रूप से बनाया गया। क्लाउड मॉडल का उपयोग नहीं हुआ।",
  "digest.error": "सारांश लोड या कॉपी नहीं हो सका।",
  "digest.loading": "सारांश लोड हो रहा है…",
  "digest.copy": "स्रोतों सहित कॉपी करें",
  "digest.copied": "कॉपी किया गया",
  "digest.slackHeading": "Slack पर भेजें",
  "digest.slackDisclosure":
    "भेजने से यह डाइजेस्ट, उद्धृत गतिविधि, असत्यापित इवेंट दावे और संभावित मीटिंग-व्युत्पन्न सामग्री कॉन्फ़िगर किए गए Slack चैनल के साथ साझा होगी। Core हर भेजने से पहले पुष्टि मांगता है।",
  "digest.slackOptIn": "Slack पर दैनिक डाइजेस्ट भेजने की अनुमति दें",
  "digest.sendSlack": "Slack पर भेजें",
  "digest.slack.disabled": "दैनिक डाइजेस्ट Slack भेजना बंद है।",
  "digest.slack.chat_unavailable": "पहले चैट स्वीकृतियां सक्षम करें।",
  "digest.slack.slack_unconfigured": "पहले चैट स्वीकृतियों में Slack कॉन्फ़िगर और सक्षम करें।",
  "digest.slack.missing_token": "कॉन्फ़िगर किया गया Slack बॉट टोकन उपलब्ध नहीं है।",
  "digest.slack.emergency_stop": "आपातकालीन रोक ने भेजने को अवरुद्ध कर दिया है।",
  "digest.slack.ready": "Slack भेजना तैयार है।",
  "digest.slackUnavailable": "दैनिक डाइजेस्ट Slack भेजना उपलब्ध नहीं है।",
  "digest.slackWaiting": "आपके Core पुष्टि की प्रतीक्षा है…",
  "digest.slackError": "Slack भेजना पूरा नहीं हो सका। कोई स्वचालित पुनः प्रयास नहीं हुआ।",
  "digest.slackSent": "{day} का दैनिक डाइजेस्ट Slack पर भेज दिया गया।",
  "digest.sendUnavailable": "अनुमोदित एकीकरण जुड़ने तक Slack और Teams को भेजना उपलब्ध नहीं है।",
  "digest.back": "सारांश पर वापस",
  "digest.eventTitle": "घटना का प्रमाण",
  "digest.eventMissing": "यह घटना अब उपलब्ध नहीं है।",
  "digest.unverified":
    "असत्यापित: यह स्थानीय रूप से सहेजा गया घटना-दावा है, प्रदाता द्वारा सत्यापित प्रमाण नहीं।",
  "digest.commitTitle": "कमिट",
  "digest.commitMissing": "यह कमिट किसी निगरानी वाले रिपॉज़िटरी में नहीं है।",
  "digest.noneIncomplete": "पढ़े जा सके स्रोतों में कुछ नहीं मिला।",
  "digest.noticeHeading": "अधूरा सारांश",
  "digest.noticeUnavailable": "पढ़ा नहीं जा सका, इसलिए सारांश में गतिविधि छूट सकती है: {sources}।",
  "digest.noticePartial": "केवल नवीनतम रिकॉर्ड पढ़े गए, पुरानी गतिविधि छूट सकती है: {sources}।",
  "digest.noticeUnattributed":
    "कोई git पहचान (user.email) सेट नहीं है, इसलिए कमिट को आपका काम दिखाने के बजाय बाहर रखा गया: {sources}।",
  "digest.sources.git": "git रिपॉज़िटरी",
  "digest.sources.events": "इवेंट इतिहास",
  "digest.sources.sessions": "एजेंट सत्र",
  "digest.sources.meetings": "बैठकें",
};
