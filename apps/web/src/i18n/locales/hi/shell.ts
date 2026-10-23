// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { shell as enShell } from "../../en/shell";

/** Machine-translated; unreviewed (see ../../README.md). */
export const shell: Record<keyof typeof enShell, string> = {
  "shell.nav.home": "Phoenix होम",
  "shell.nav.main": "मुख्य",
  "shell.nav.meetings": "मीटिंग",
  "shell.nav.provenance": "प्रोवेनेंस",
  "shell.nav.agents": "एजेंट",
  "shell.nav.workflows": "वर्कफ़्लो",
  "shell.nav.recap": "रीकैप",
  "shell.nav.settings": "सेटिंग्स",
  "shell.nav.recording": "रिकॉर्डिंग",
  "shell.app.skipToContent": "सामग्री पर जाएँ",
  "shell.app.tagline": "Phoenix प्लेटफ़ॉर्म है। Fawkes पालतू साथी है।",
  "shell.app.noToken":
    "इस पेज पर कोई सेशन टोकन नहीं है। Phoenix को {command} द्वारा छापे गए पते से खोलें।",
  "shell.app.hint": "Phoenix क्या कर रहा है, यह देखने के लिए ऊपरी बार में Fawkes पर क्लिक करें।",
  "shell.language.title": "भाषा",
  "shell.language.label": "इंटरफ़ेस की भाषा",
  "shell.language.available":
    "{count, plural, one {# भाषा उपलब्ध है।} other {# भाषाएँ उपलब्ध हैं।}}",
  "shell.language.machineNote":
    "अंग्रेज़ी के अलावा अन्य भाषाओं का पाठ मशीन से अनूदित है और अभी तक मूल भाषियों द्वारा जाँचा नहीं गया है।",
  "shell.language.saved": "भाषा बदल दी गई।",
  "shell.language.failed": "भाषा सहेजी नहीं जा सकी। फिर कोशिश करें।",

  "shell.palette.title": "कमांड पैलेट",
  "shell.palette.inputLabel": "कमांड खोजें",
  "shell.palette.placeholder": "कमांड लिखें…",
  "shell.palette.results": "कमांड",
  "shell.palette.hint": "ऊपर और नीचे तीर से चुनें, Enter से चलाएँ, Escape से बंद करें।",
  "shell.palette.count": "{count, plural, one {# कमांड} other {# कमांड}}",
  "shell.palette.empty": "“{query}” से कोई कमांड मेल नहीं खाती।",

  "shell.cmd.palette.open": "कमांड पैलेट खोलें",
  "shell.cmd.nav.home": "होम पर जाएँ",
  "shell.cmd.nav.meetings": "मीटिंग पर जाएँ",
  "shell.cmd.nav.provenance": "प्रोवेनेंस पर जाएँ",
  "shell.cmd.nav.agents": "एजेंट पर जाएँ",
  "shell.cmd.nav.workflows": "वर्कफ़्लो पर जाएँ",
  "shell.cmd.nav.recap": "रीकैप पर जाएँ",
  "shell.cmd.nav.settings": "सेटिंग्स पर जाएँ",
  "shell.cmd.settings.language": "सेटिंग्स खोलें: भाषा",
  "shell.cmd.panel.overview": "Fawkes पैनल: अवलोकन",
  "shell.cmd.panel.chat": "Fawkes पैनल: चैट",
  "shell.cmd.panel.activity": "Fawkes पैनल: गतिविधि",
  "shell.cmd.panel.capabilities": "Fawkes पैनल: क्षमताएँ",
  "shell.cmd.panel.memory": "Fawkes पैनल: स्मृति",
  "shell.cmd.panel.wardrobe": "वार्डरोब खोलें",
  "shell.cmd.demo.start": "डेमो शुरू करें",
  "shell.cmd.demo.stop": "डेमो रोकें",
  "shell.cmd.pills.next": "अगले स्रोत पिल पर जाएँ",
  "shell.cmd.pills.previous": "पिछले स्रोत पिल पर जाएँ",
  "shell.cmd.mute.toggle": "आवाज़ों और सूचनाओं को म्यूट या अनम्यूट करें",

  "shell.shortcuts.title": "ग्लोबल शॉर्टकट",
  "shell.shortcuts.desktopOnly":
    "ग्लोबल शॉर्टकट Phoenix डेस्कटॉप ऐप की सुविधा हैं। ये ब्राउज़र में उपलब्ध नहीं हैं।",
  "shell.shortcuts.intro":
    "Phoenix डेस्कटॉप ऐप चलने के दौरान ग्लोबल शॉर्टकट किसी भी ऐप में काम करते हैं।",
  "shell.shortcuts.loading": "शॉर्टकट लोड हो रहे हैं…",
  "shell.shortcuts.loadFailed": "डेस्कटॉप ऐप से शॉर्टकट पढ़े नहीं जा सके।",
  "shell.shortcuts.enable": "ग्लोबल शॉर्टकट चालू करें",
  "shell.shortcuts.warning":
    "चेतावनी: ग्लोबल शॉर्टकट चालू होने पर हर शॉर्टकट अपना कुंजी संयोजन बाकी सभी ऐप से छीन लेता है। जब तक आप इन्हें चालू नहीं करते, ये बंद रहते हैं। हर शॉर्टकट में कम से कम दो मॉडिफ़ायर कुंजियाँ (Ctrl, Alt, Shift या Cmd) ज़रूरी हैं, ताकि वह सामान्य टाइपिंग में बाधा न डाले।",
  "shell.shortcuts.mute": "आवाज़ें और सूचनाएँ म्यूट करें",
  "shell.shortcuts.muteHelp":
    "Fawkes अब भी दिखाता है कि वह क्या कर रहा है; केवल उसकी आवाज़ें और सूचना बबल बंद किए जाते हैं।",
  "shell.shortcuts.list": "शॉर्टकट क्रियाएँ",
  "shell.shortcuts.action.open_chat": "चैट खोलें",
  "shell.shortcuts.action.jump_to_alert": "अलर्ट पर जाएँ",
  "shell.shortcuts.action.jump_to_terminal": "टर्मिनल पर जाएँ",
  "shell.shortcuts.action.switch_pills": "पिल्स बदलें",
  "shell.shortcuts.action.mute": "आवाज़ें और सूचनाएँ म्यूट करें",
  "shell.shortcuts.action.send_to_desktop": "Fawkes को डेस्कटॉप पर भेजें",
  "shell.shortcuts.action.wardrobe": "वार्डरोब खोलें",
  "shell.shortcuts.binding.none": "सेट नहीं है",
  "shell.shortcuts.default": "डिफ़ॉल्ट: {keys}",
  "shell.shortcuts.state.active": "सक्रिय",
  "shell.shortcuts.state.off": "निष्क्रिय: ग्लोबल शॉर्टकट बंद हैं",
  "shell.shortcuts.state.unbound": "निष्क्रिय: कोई कुंजी संयोजन सेट नहीं है",
  "shell.shortcuts.state.rejected": "निष्क्रिय: यह कुंजी संयोजन मान्य नहीं है",
  "shell.shortcuts.state.unavailable":
    "निष्क्रिय: हो सकता है कोई अन्य ऐप यह कुंजी संयोजन पहले से इस्तेमाल कर रहा हो, या सिस्टम इसकी अनुमति नहीं देता",
  "shell.shortcuts.changeFor": "{action} का शॉर्टकट बदलें",
  "shell.shortcuts.capture": "नया कुंजी संयोजन दबाएँ",
  "shell.shortcuts.captureFor": "{action} के लिए नया कुंजी संयोजन",
  "shell.shortcuts.captureHelp": "कुंजियाँ एक साथ दबाएँ। Escape रद्द करता है।",
  "shell.shortcuts.resetFor": "{action} का शॉर्टकट डिफ़ॉल्ट पर रीसेट करें",
  "shell.shortcuts.resetAll": "सभी शॉर्टकट रीसेट करें",
  "shell.shortcuts.saved": "{action} का शॉर्टकट अब {keys} है।",
  "shell.shortcuts.resetDone": "{action} का शॉर्टकट रीसेट कर दिया गया।",
  "shell.shortcuts.resetAllDone": "सभी शॉर्टकट रीसेट कर दिए गए।",
  "shell.shortcuts.reason.invalid": "यह मान्य शॉर्टकट नहीं है।",
  "shell.shortcuts.reason.unsupportedKey":
    "इस कुंजी का उपयोग नहीं किया जा सकता। मॉडिफ़ायर कुंजियों के साथ कोई अक्षर, अंक, F कुंजी या तीर कुंजी इस्तेमाल करें।",
  "shell.shortcuts.reason.needs_modifiers":
    "शॉर्टकट में कम से कम दो मॉडिफ़ायर कुंजियाँ (Ctrl, Alt, Shift या Cmd) ज़रूरी हैं, ताकि वह सामान्य टाइपिंग में दखल न दे।",
  "shell.shortcuts.reason.needs_third_modifier":
    "कई कीबोर्ड पर अक्षर या अंक के साथ Ctrl+Alt और Alt+Shift प्रतीक टाइप करते हैं (AltGr या Option)। तीसरी मॉडिफ़ायर कुंजी जोड़ें।",
  "shell.shortcuts.reason.reserved": "सिस्टम पहले से यह कुंजी संयोजन इस्तेमाल करता है।",
  "shell.shortcuts.reason.dictation_chord":
    "यह कुंजी संयोजन डिक्टेशन (दोबारा पेस्ट) के लिए इस्तेमाल होता है।",
  "shell.shortcuts.reason.conflict":
    "कोई अन्य Phoenix शॉर्टकट पहले से यह कुंजी संयोजन इस्तेमाल करता है।",
  "shell.shortcuts.reason.unavailable":
    "सिस्टम ने यह कुंजी संयोजन रजिस्टर नहीं किया। हो सकता है कोई अन्य ऐप इसे पहले से इस्तेमाल कर रहा हो।",
  "shell.shortcuts.reason.forbidden": "यह विंडो शॉर्टकट नहीं बदल सकती।",
  "shell.shortcuts.reason.unknown_action": "यह कोई शॉर्टकट क्रिया नहीं है।",
  "shell.shortcuts.reason.unknown": "शॉर्टकट बदला नहीं जा सका।",
};
