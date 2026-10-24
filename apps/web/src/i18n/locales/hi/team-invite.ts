// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamInvite as enTeamInvite } from "../../en/team-invite";

/** Machine-translated; unreviewed. */
export const teamInvite: Record<keyof typeof enTeamInvite, string> = {
  "teamInvite.share.title": "मेरी पहचान साझा करें",
  "teamInvite.share.intro":
    "यह आमंत्रण चैट या ईमेल से किसी साथी को भेजें। इसमें केवल आपकी टीम आईडी, आपकी सार्वजनिक कुंजी और नीचे लिखा नाम है। इसमें कोई गोपनीय जानकारी नहीं है, और आपकी निजी कुंजी इस कंप्यूटर से बाहर नहीं जाती।",
  "teamInvite.share.label": "आमंत्रण में रखने के लिए नाम (वैकल्पिक)",
  "teamInvite.share.invalid": "इस पहचान से आमंत्रण नहीं बनाया जा सका।",
  "teamInvite.share.invite": "आपका आमंत्रण",
  "teamInvite.share.copy": "आमंत्रण कॉपी करें",
  "teamInvite.share.copied": "आमंत्रण क्लिपबोर्ड पर कॉपी हो गया।",
  "teamInvite.share.copyFailed":
    "Phoenix क्लिपबोर्ड का उपयोग नहीं कर सका। ऊपर का आमंत्रण चुनकर हाथ से कॉपी करें।",
  "teamInvite.share.fingerprintHint":
    "फ़िंगरप्रिंट अपने साथी को आवाज़ से या किसी दूसरी चैट में पढ़कर बताएँ, ताकि वे जाँच सकें कि मिला आमंत्रण आपका ही है।",
  "teamInvite.fingerprint": "कुंजी का फ़िंगरप्रिंट",
  "teamInvite.checksumNote":
    "आमंत्रण के अंत का छोटा कोड केवल कॉपी की गलतियाँ पकड़ता है। यह साबित नहीं करता कि आमंत्रण किसने बनाया; यह केवल फ़िंगरप्रिंट मिलाने से साबित होता है।",
  "teamInvite.refusal.empty": "पहले आमंत्रण चिपकाएँ।",
  "teamInvite.refusal.tooLong": "यह टीम आमंत्रण के लिए बहुत लंबा है।",
  "teamInvite.refusal.format": "यह Phoenix टीम आमंत्रण नहीं है।",
  "teamInvite.refusal.version":
    "यह आमंत्रण Phoenix के दूसरे संस्करण का है जिसे यह संस्करण पढ़ नहीं सकता।",
  "teamInvite.refusal.checksum":
    "आमंत्रण बदल गया है या गलत कॉपी हुआ है। साथी से दोबारा भेजने को कहें।",
  "teamInvite.refusal.content": "आमंत्रण क्षतिग्रस्त है या उसकी सामग्री अप्रत्याशित है।",
  "teamInvite.refusal.id": "आमंत्रण में टीम आईडी अमान्य है।",
  "teamInvite.refusal.key": "आमंत्रण में सार्वजनिक कुंजी अमान्य है।",
  "teamInvite.refusal.label": "आमंत्रण में नाम अमान्य है।",
  "teamInvite.refusal.unsupported": "यह ब्राउज़र आमंत्रण की जाँच नहीं कर सकता।",
  "teamInvite.refusal.own": "वह आमंत्रण आपकी अपनी पहचान है।",
  "teamInvite.refusal.duplicate":
    "वह साथी पहले से आपकी सूची में है। कुंजी बदलने के लिए पहले उन्हें हटाएँ।",
  "teamInvite.add.title": "साथी जोड़ें",
  "teamInvite.add.paste": "किसी साथी का आमंत्रण चिपकाएँ",
  "teamInvite.add.preview": "इस साथी को जोड़ने से पहले ये विवरण जाँच लें।",
  "teamInvite.add.noLabel": "आमंत्रण में नाम नहीं है; दिखाने के लिए एक नाम लिखें।",
  "teamInvite.add.theirLabel": "आमंत्रण में नाम है: {label}",
  "teamInvite.add.confirm":
    "मैंने यह फ़िंगरप्रिंट अपने साथी से आवाज़ से या दूसरी चैट में मिलाया है, और यह मेल खाता है।",
};
