// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamStatus as enTeamStatus } from "../../en/team-status";

/** Machine-translated; unreviewed. */
export const teamStatus: Record<keyof typeof enTeamStatus, string> = {
  "teamStatus.title": "टीम की उपस्थिति",
  "teamStatus.intro":
    "टीम की उपस्थिति डिफ़ॉल्ट रूप से बंद रहती है। चालू करने पर Phoenix केवल वही स्थितियाँ भेजता है जिन पर आप टिक करते हैं (डिप्लॉय कर रहे हैं, एजेंट चला रहे हैं, मीटिंग में हैं), और वह भी आपके जोड़े गए साथियों को एन्क्रिप्टेड फ़्रेम के रूप में; यह कभी किसी रिपॉज़िटरी, ब्रांच या व्यक्ति का नाम नहीं बताता।",
  "teamStatus.notAvailable":
    "टीम की उपस्थिति उपलब्ध नहीं है: इस Phoenix Core में आपकी कुंजी रखने के लिए ऑपरेटिंग सिस्टम का सीक्रेट स्टोर नहीं है।",
  "teamStatus.loadFailed": "टीम की उपस्थिति लोड नहीं हो सकी।",
  "teamStatus.listSeparator": ", ",
  "teamStatus.kind.deploying": "डिप्लॉय कर रहे हैं",
  "teamStatus.kind.agentRun": "एजेंट चला रहे हैं",
  "teamStatus.kind.meeting": "मीटिंग में हैं",
  "teamStatus.relay.label": "रिले का पता",
  "teamStatus.route.label": "रूट (वैकल्पिक)",
  "teamStatus.route.hint":
    "नई टीम शुरू करने के लिए रूट खाली छोड़ें। किसी साथी की टीम में शामिल होने के लिए यहाँ रूट चिपकाएँ।",
  "teamStatus.route.shown": "रिले रूट",
  "teamStatus.turnOn": "चालू करें",
  "teamStatus.resume": "फिर से चालू करें",
  "teamStatus.pause": "रोकें",
  "teamStatus.leave": "टीम छोड़ें",
  "teamStatus.leave.ask": "टीम छोड़ें और सभी को भूल जाएँ?",
  "teamStatus.state.line": "कनेक्शन: {state}",
  "teamStatus.state.connected": "जुड़ा हुआ",
  "teamStatus.state.connecting": "जुड़ रहा है",
  "teamStatus.state.paused": "रुका हुआ",
  "teamStatus.lastError": "पिछली त्रुटि: {error}",
  "teamStatus.self.id": "आपकी टीम आईडी",
  "teamStatus.self.publicKey": "आपकी सार्वजनिक कुंजी",
  "teamStatus.self.hint":
    "दोनों किसी साथी को दें ताकि वह आपको जोड़ सके। आपकी निजी कुंजी इस कंप्यूटर से कभी बाहर नहीं जाती।",
  "teamStatus.sharing.title": "मैं क्या साझा करता हूँ",
  "teamStatus.sharing.master": "मेरी स्थिति अपनी टीम के साथ साझा करें",
  "teamStatus.sharing.deploying": "डिप्लॉय कर रहे हैं",
  "teamStatus.sharing.agentRun": "लंबे समय तक एजेंट चला रहे हैं",
  "teamStatus.sharing.meeting": "मीटिंग में हैं",
  "teamStatus.outgoing.now": "साथी अभी देखते हैं: {kinds}।",
  "teamStatus.outgoing.none": "साथी अभी आपकी कोई स्थिति नहीं देखते।",
  "teamStatus.members.title": "साथी",
  "teamStatus.members.none": "आपने अभी तक कोई साथी नहीं जोड़ा है।",
  "teamStatus.members.removeLabel": "{label} को हटाएँ",
  "teamStatus.members.id": "साथी की टीम आईडी",
  "teamStatus.members.label": "दिखाने के लिए नाम",
  "teamStatus.members.add": "साथी जोड़ें",
  "teamStatus.presence.title": "कौन आसपास है",
  "teamStatus.presence.none": "दिखाने के लिए कोई साथी नहीं।",
  "teamStatus.presence.nothing": "कुछ साझा नहीं",
};
