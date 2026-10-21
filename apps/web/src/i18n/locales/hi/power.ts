// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { power as enpower } from "../../en/power";

/** Machine-translated; unreviewed (see ../../README.md). */
export const power: Record<keyof typeof enpower, string> = {
  "power.awake.duration.minutes": "{minutes, plural, one {# मिनट} other {# मिनट}}",
  "power.awake.duration.hours": "{hours, plural, one {# घंटा} other {# घंटे}}",
  "power.awake.heading": "जगाए रखें",
  "power.awake.disabled": "“जगाए रखें” बंद है। इसे उपयोग करने के लिए यह क्षमता चालू करें।",
  "power.awake.waiting": "आपकी मंज़ूरी की प्रतीक्षा है…",
  "power.awake.idle": "कंप्यूटर सामान्य रूप से सोता है। जगाए रखने के लिए समयबद्ध सत्र शुरू करें।",
  "power.awake.start.heading": "इतनी देर जगाए रखें",
  "power.awake.custom.label": "मिनट",
  "power.awake.reason.label": "कारण (वैकल्पिक)",
  "power.awake.custom.start": "शुरू करें",
  "power.awake.custom.invalid": "{min} से {max} के बीच मिनटों की पूरी संख्या दर्ज करें।",
  "power.awake.agents.start": "जब एजेंट काम करें",
  "power.awake.agents.help":
    "जब तक कोई कोडिंग एजेंट काम कर रहा है तब तक जगाए रखता है, और अंतिम के पूरा होने के कुछ मिनट बाद समाप्त होता है (ऊपर के मिनट उपयोग होते हैं)।",
  "power.awake.agents.working":
    "{count, plural, one {# एजेंट काम कर रहा है} other {# एजेंट काम कर रहे हैं}}",
  "power.awake.agents.grace":
    "अंतिम एजेंट के पूरा होने के {minutes, plural, one {# मिनट} other {# मिनट}} बाद समाप्त होता है।",
  "power.awake.running": "कंप्यूटर को जगाए रखा जा रहा है",
  "power.awake.remaining": "बचा समय: {time}",
  "power.awake.endsAt": "{time} पर समाप्त",
  "power.awake.extend.label": "समय जोड़ें",
  "power.awake.extend.button": "+{duration}",
  "power.awake.end.hold": "समाप्त करने के लिए दबाए रखें",
  "power.awake.end.holding": "दबाए रखें…",
  "power.awake.end.hint":
    "सत्र समाप्त करने के लिए बटन को 1.5 सेकंड दबाए रखें (या स्पेस या एंटर दबाए रखें)।",
  "power.awake.battery":
    "अनप्लग होने पर बैटरी {percent}% से नीचे जाने पर भी सत्र समाप्त हो जाता है।",
  "power.awake.lid":
    "ढक्कन बंद करने पर कंप्यूटर फिर भी सो जाता है; ढक्कन बंद करके जगाए रखने के लिए अलग लिड-क्लोज़्ड मोड चाहिए।",
  "power.awake.indicator": "जागृत {time}",
  "power.recovery.heading": "लिड-क्लोज़्ड मोड और रिकवरी",
  "power.recovery.waiting": "आपकी स्वीकृति की प्रतीक्षा है…",
  "power.recovery.unreadable": "रिकवरी की स्थिति पढ़ी नहीं जा सकी।",
  "power.recovery.journal.clean": "वापस करने के लिए कुछ भी लंबित नहीं है।",
  "power.recovery.journal.pending":
    "Phoenix {count, plural, one {# सिस्टम बदलाव} other {# सिस्टम बदलाव}} को बहाल नहीं कर सका। स्लीप सेटिंग अब भी बदली हुई हो सकती हैं।",
  "power.recovery.journal.kind.disablesleep": "ढक्कन बंद होने पर भी नींद बंद",
  "power.recovery.journal.kind.lowpowermode": "लो पावर मोड",
  "power.recovery.journal.kind.other": "अन्य बदलाव",
  "power.recovery.journal.at": "{time} से",
  "power.recovery.journal.undo": "अभी वापस करें",
  "power.recovery.journal.untrusted":
    "{count, plural, one {# अपठनीय जर्नल पंक्ति} other {# अपठनीय जर्नल पंक्तियाँ}} अनदेखी की गईं, भरोसा नहीं किया गया।",
  "power.recovery.journal.cannotQuit":
    "जब तक ये वापस नहीं किए जाते, Phoenix बंद करने से मना किया जाएगा।",
  "power.recovery.lid.open": "ढक्कन खुला है।",
  "power.recovery.lid.closed": "ढक्कन बंद है।",
  "power.recovery.lid.unknown": "ढक्कन की स्थिति अज्ञात है।",
  "power.recovery.lid.unsupported":
    "इस कंप्यूटर में ढक्कन सेंसर नहीं है, इसलिए लिड-क्लोज़्ड मोड उपलब्ध नहीं है।",
  "power.recovery.helper.installed": "विशेषाधिकार प्राप्त सहायक इंस्टॉल है",
  "power.recovery.helper.missing":
    "विशेषाधिकार प्राप्त सहायक इंस्टॉल नहीं है (लिड-क्लोज़्ड मोड उपलब्ध नहीं)। docs/awake-helper.md देखें।",
  "power.recovery.helper.unknown": "यह अज्ञात है कि विशेषाधिकार प्राप्त सहायक इंस्टॉल है या नहीं।",
  "power.recovery.floors.off": "सीमाएँ बंद हैं",
  "power.recovery.floors.rule":
    "{low} % से नीचे लो पावर मोड, {end} % से नीचे सत्र समाप्त; गर्मी: {heatLow} पर लो पावर मोड, {heatEnd} पर समाप्त।",
  "power.recovery.floors.lowPowerActive": "लो पावर मोड चालू है",
  "power.recovery.floors.battery.none": "बैटरी: नहीं है",
  "power.recovery.floors.battery.unknown": "बैटरी: अज्ञात",
  "power.recovery.floors.battery.level": "बैटरी {percent} %",
  "power.recovery.floors.battery.unplugged": "बैटरी {percent} %, प्लग हटा हुआ",
  "power.recovery.floors.battery.plugged": "बैटरी {percent} %, प्लग लगा हुआ",
  "power.recovery.floors.thermal.nominal": "सामान्य",
  "power.recovery.floors.thermal.fair": "गुनगुना",
  "power.recovery.floors.thermal.serious": "गर्म",
  "power.recovery.floors.thermal.critical": "गंभीर",
  "power.recovery.floors.thermal.level": "गर्मी: {level}",
  "power.recovery.floors.thermal.unsupported": "गर्मी: रिपोर्ट नहीं होती",
  "power.recovery.floors.thermal.unknown": "गर्मी: अज्ञात",
  "power.recovery.safety.warning":
    "लिड-क्लोज़्ड मोड चालू होने पर कंप्यूटर को कभी बैग, केस या किसी बंद जगह में न ले जाएँ: वह ज़्यादा गर्म हो सकता है। वेंट खुले रखें।",
  "power.recovery.safety.understand": "मैं समझता/समझती हूँ",
  "power.recovery.safety.acknowledge": "स्वीकार करें",
  "power.recovery.safety.done": "आपने लिड-क्लोज़्ड सुरक्षा चेतावनी स्वीकार कर ली है।",
  "power.recovery.start": "लिड-क्लोज़्ड मोड शुरू करें",
  "power.recovery.end": "लिड-क्लोज़्ड मोड समाप्त करें",
  "power.recovery.engaged": "लिड-क्लोज़्ड मोड चालू है।",
  "power.recovery.engagedSince": "लिड-क्लोज़्ड मोड {time} से चालू है।",
  "power.recovery.needsSession":
    "पहले जागृत रखने का सत्र शुरू करें; लिड-क्लोज़्ड मोड को उसकी ज़रूरत है।",
  "power.recovery.journal.discard": "इस प्रविष्टि को हटाएँ",
  "power.recovery.lockBlocked":
    "कोई अन्य पुनर्प्राप्ति प्रक्रिया लॉक को पकड़े हुए है, इसलिए अभी कुछ भी पूर्ववत नहीं हुआ। बदलाव अभी लंबित है।",
  "power.recovery.sleepUnjournaled":
    "इस कंप्यूटर पर स्लीप अक्षम है, लेकिन Phoenix के पास इसे बंद करने का कोई रिकॉर्ड नहीं है। किसी और ने इसे बदला है।",
  "power.recovery.journalPath": "जर्नल: {path}",
  "power.continuity.heading": "एजेंट निरंतरता",
  "power.continuity.intro":
    "लंबे एजेंट रन के लिए अतिरिक्त सुविधाएँ। हर एक तब तक बंद रहती है जब तक आप उसे चालू नहीं करते, और इनमें से कोई भी आपके लिए नेटवर्क, टर्मिनल या प्रोग्राम नहीं चुनती।",
  "power.continuity.needsAwake":
    "ये सेटिंग्स केवल तभी प्रभावी होती हैं जब Keep awake क्षमता चालू हो।",
  "power.continuity.saved": "सहेज लिया गया। बदलाव अगली बार Keep awake शुरू होने पर लागू होंगे।",
  "power.continuity.applyNote":
    "बदलाव Keep awake क्षमता में सहेजे जाते हैं और उसके अगली बार चालू होने पर लागू होते हैं।",
  "power.continuity.network.title": "नेटवर्क निगरानी",
  "power.continuity.network.help":
    "हर कुछ सेकंड में जाँचता है कि आपके बताए कंप्यूटर तक पहुँचा जा सकता है या नहीं, और नेटवर्क के बंद होने और वापस आने पर Phoenix को बताता है। यह केवल कनेक्ट करता है; कुछ भेजता या पढ़ता नहीं है।",
  "power.continuity.hosts.label": "जाँचने के लिए होस्ट (नाम या नाम:पोर्ट)",
  "power.continuity.hotspot.title": "हॉटस्पॉट फ़ेलओवर",
  "power.continuity.hotspot.help":
    "जब keep-awake सत्र चलने के दौरान Wi-Fi कट जाए, तो आपके बताए iPhone हॉटस्पॉट से जुड़ें। ऊपर की नेटवर्क निगरानी और होस्ट की सूची आवश्यक है। यह केवल macOS पर काम करता है और किसी असली Mac पर इसका परीक्षण नहीं हुआ है।",
  "power.continuity.hotspot.ssid": "हॉटस्पॉट का नाम (SSID)",
  "power.continuity.hotspot.disclosure":
    "इसे चालू करने से पहले: macOS किसी ऐसे नेटवर्क से, जिसे वह पहले से जानता है, कमांड लाइन पर बिना किसी पासवर्ड के जुड़ सकता है, इसलिए पहले अपने हॉटस्पॉट से एक बार हाथ से जुड़ें। केवल तभी, जब आप नीचे सहेजे गए पासवर्ड की भी अनुमति दें, Phoenix उसे macOS के networksetup टूल को देता है, और तब जुड़ने में लगने वाले कुछ सेकंड तक इस Mac का हर प्रोग्राम उसे उस कमांड लाइन पर पढ़ सकता है। आपसे पूछे बिना ऐसा करने का इससे अधिक सुरक्षित कोई अंतर्निहित तरीका नहीं है। यदि यह स्वीकार्य नहीं है, तो मना कर दें।",
  "power.continuity.hotspot.allowPassword":
    "मैं यह स्वीकार करता/करती हूँ: कमांड लाइन पर सहेजे गए हॉटस्पॉट पासवर्ड का उपयोग करें",
  "power.continuity.hotspot.passwordSaved": "हॉटस्पॉट पासवर्ड keychain में सहेजा हुआ है।",
  "power.continuity.hotspot.passwordMissing":
    "कोई हॉटस्पॉट पासवर्ड सहेजा नहीं गया है। उसे Keep awake क्षमता के “hotspot_password” सीक्रेट के रूप में सहेजें, या इस बॉक्स को बंद रखें और हॉटस्पॉट से एक बार हाथ से जुड़ें।",
  "power.continuity.hotspot.join": "अभी हॉटस्पॉट से जुड़ें",
  "power.continuity.hotspot.rejoin": "मेरे पिछले नेटवर्क से फिर जुड़ें",
  "power.continuity.hotspot.confirmNote":
    "किसी नेटवर्क से जुड़ने पर यह Mac जो Wi-Fi इस्तेमाल करता है वह बदल जाता है। Phoenix हर बार आपसे पुष्टि माँगता है।",
  "power.continuity.hotspot.joined": "जुड़ गया।",
  "power.continuity.nudge.title": "एजेंट को झकझोरें",
  "power.continuity.nudge.help":
    "यदि नीचे दिए समय तक नेटवर्क न हो, तो आपकी सूची के टर्मिनलों में “continue” टाइप करें। मीटिंग या डिक्टेशन के दौरान कुछ भी टाइप नहीं किया जाता, और हर टर्मिनल को प्रति व्यवधान अधिकतम एक बार यह मिलता है।",
  "power.continuity.nudge.after": "झकझोरने से पहले बिना नेटवर्क के सेकंड (30 से 3600)",
  "power.continuity.nudge.panes": "tmux पेन (उदाहरण के लिए %12)",
  "power.continuity.nudge.sessions": "Phoenix एजेंट सत्र (ph- और 16 हेक्स अंक)",
  "power.continuity.nudge.sessionsNote":
    "अभी उपलब्ध नहीं: Phoenix के पास किसी ट्रैक किए गए सत्र में टाइप करने का कोई सुरक्षित तरीका नहीं है, इसलिए सूचीबद्ध सत्र छोड़ दिए जाते हैं और उनकी रिपोर्ट की जाती है। केवल tmux पेन को झकझोरा जाता है।",
  "power.continuity.nudge.commands": "पेन में चल सकने वाले प्रोग्राम (उदाहरण के लिए claude)",
  "power.continuity.nudge.commandsNote":
    "टाइप करने से पहले Phoenix जाँचता है कि पेन अब भी मौजूद है और इनमें से कोई प्रोग्राम चला रहा है। सूची खाली होने पर कभी कुछ टाइप नहीं किया जाता।",
  "power.continuity.nudge.enter": "Enter भी दबाएँ",
  "power.continuity.nudge.enterHelp":
    "डिफ़ॉल्ट रूप से बंद। इसके बिना “continue” टाइप तो होता है पर भेजा नहीं जाता, इसलिए Enter आपको खुद दबाना होगा।",
  "power.continuity.throttle.title": "ब्राउज़र थ्रॉटलिंग जाँच",
  "power.continuity.throttle.help":
    "Chrome, Arc, Comet, Edge और Brave बैकग्राउंड टैब को धीमा कर देते हैं, जिससे एजेंट का वेब पेज अटक सकता है। यह ऐसे चल रहे ब्राउज़रों की सूची देता है। जब तक आप Relaunch न चुनें और पुष्टि न करें, यह कभी किसी ब्राउज़र को नहीं बदलता।",
  "power.continuity.throttle.unsupported": "ब्राउज़र की जाँच केवल macOS पर काम करती है।",
  "power.continuity.throttle.notRunning": "नहीं चल रहा",
  "power.continuity.throttle.throttled": "बैकग्राउंड थ्रॉटलिंग के साथ चल रहा है",
  "power.continuity.throttle.fine": "बिना थ्रॉटलिंग के चल रहा है",
  "power.continuity.throttle.relaunch": "{name} को बिना थ्रॉटलिंग के फिर से लॉन्च करें",
  "power.continuity.throttle.confirm":
    "क्या {name} को बैकग्राउंड थ्रॉटलिंग के बिना फिर से लॉन्च करें? {name} बंद होकर दोबारा खुलेगा, उसके टैब फिर से लोड होंगे, और किसी पेज पर जो कुछ सहेजा नहीं गया है वह खो सकता है। मीटिंग या डिक्टेशन के दौरान इसे अस्वीकार कर दिया जाता है।",
  "power.continuity.throttle.confirmYes": "बंद करें और फिर से लॉन्च करें",
  "power.continuity.throttle.relaunched": "{name} फिर से लॉन्च किया गया।",
  "power.continuity.outage.title": "पिछला नेटवर्क व्यवधान",
  "power.continuity.outage.none": "अब तक कोई नेटवर्क व्यवधान नहीं दिखा।",
  "power.continuity.outage.down": "नेटवर्क {time} से बंद है।",
  "power.continuity.outage.ended": "नेटवर्क {from} से {to} तक बंद था।",
  "power.continuity.outage.nudged":
    "{count, plural, one {# टर्मिनल को झकझोरा गया} other {# टर्मिनलों को झकझोरा गया}}",
  "power.continuity.outage.hotspot.joined": "हॉटस्पॉट से जुड़ गया",
  "power.continuity.outage.hotspot.failed": "हॉटस्पॉट से जुड़ना विफल रहा",
  "power.continuity.outage.hotspot.skipped":
    "हॉटस्पॉट आज़माया नहीं गया (बंद है, या कोई सत्र नहीं चल रहा)",
  "power.continuity.outage.hotspot.notTried": "हॉटस्पॉट अभी तक आज़माया नहीं गया",
  "power.continuity.list.empty": "कुछ भी सूचीबद्ध नहीं।",
  "power.continuity.list.remove": "{item} हटाएँ",
  "power.continuity.invalid.host": "होस्ट नाम या पता दें, चाहें तो :पोर्ट (1 से 65535) के साथ।",
  "power.continuity.invalid.pane": "%12 जैसा tmux पेन आईडी दें: एक प्रतिशत चिह्न और अधिकतम छह अंक।",
  "power.continuity.invalid.session": "ph-0123456789abcdef जैसा सत्र आईडी दें।",
  "power.continuity.invalid.command": "claude जैसा प्रोग्राम नाम दें: केवल अक्षर, अंक और . _ + -।",
  "power.continuity.invalid.ssid":
    "दिखने वाले टेक्स्ट के 1 से 32 बाइट दें, जो हाइफ़न से शुरू न हो।",
  "power.continuity.invalid.seconds": "{min} से {max} तक सेकंड की पूर्ण संख्या दर्ज करें।",
  "power.continuity.problem.duplicate": "यह प्रविष्टि सूची में पहले से है।",
  "power.continuity.problem.full": "सूची भरी हुई है (अधिकतम {max} प्रविष्टियाँ)।",
  "power.continuity.reason.unsupported_platform": "यह केवल macOS पर काम करता है।",
  "power.continuity.reason.no_wifi_device": "Phoenix को इस Mac का Wi-Fi डिवाइस नहीं मिला।",
  "power.continuity.reason.no_hotspot_configured":
    "जुड़ने के लिए कोई उपयोग योग्य हॉटस्पॉट या पिछला नेटवर्क नहीं है।",
  "power.continuity.reason.bad_password":
    "सहेजा गया पासवर्ड उपयोग नहीं किया जा सकता। उसे keychain में जाँचें।",
  "power.continuity.reason.join_failed": "macOS नेटवर्क से नहीं जुड़ सका।",
  "power.continuity.reason.unknown_browser":
    "यह ब्राउज़र ऐसा नहीं है जिसे Phoenix प्रबंधित करता है।",
  "power.continuity.reason.protected": "अभी नहीं: मीटिंग या डिक्टेशन जारी है।",
  "power.continuity.reason.not_running": "वह ब्राउज़र चल नहीं रहा है।",
  "power.continuity.reason.already_unthrottled":
    "वह ब्राउज़र पहले से ही बैकग्राउंड थ्रॉटलिंग के बिना चल रहा है।",
  "power.continuity.reason.unavailable": "यह अभी उपलब्ध नहीं है।",
  "power.continuity.reason.quit_failed": "ब्राउज़र ने बंद होने का अनुरोध स्वीकार नहीं किया।",
  "power.continuity.reason.still_running":
    "ब्राउज़र अब भी खुला है, इसलिए उसे दोबारा नहीं खोला गया। उसे खुद बंद करें, फिर दोबारा कोशिश करें।",
  "power.continuity.reason.open_failed": "ब्राउज़र बंद हो गया लेकिन दोबारा नहीं खुल सका।",
  "power.continuity.reason.other": "यह काम नहीं किया।",
  "power.lid.heading": "ढक्कन बंद होने पर क्रियाएँ",
  "power.lid.intro":
    'जब "जागा रखें" सत्र चल रहा हो और आप ढक्कन बंद करें, तो Phoenix बिजली बचा सकता है और इस कंप्यूटर को शांत कर सकता है। ढक्कन खोलने पर, सत्र खत्म होने पर और क्रैश के बाद Phoenix दोबारा शुरू होने पर सब कुछ पहले जैसा कर दिया जाता है।',
  "power.lid.needsAwake": 'ये क्रियाएँ तभी चलती हैं जब "जागा रखें" क्षमता चालू हो।',
  "power.lid.master.title": "ढक्कन बंद होने पर क्रियाएँ चलाएँ",
  "power.lid.master.help": "मुख्य स्विच। बंद होने पर नीचे का कुछ भी नहीं चलेगा।",
  "power.lid.display.title": "डिस्प्ले बंद करें",
  "power.lid.display.help":
    "डिस्प्ले को स्लीप में डालता है। मुफ़्त ब्राइटनेस टूल इंस्टॉल हो तो ब्राइटनेस सहेजी और बहाल की जाती है।",
  "power.lid.freeze.title": "चैट ऐप फ़्रीज़ करें",
  "power.lid.freeze.help":
    "चुने हुए चैट ऐप को रोक देता है ताकि वे बिजली न खाएँ, फिर उन्हें चालू कर देता है। मीटिंग, रिकॉर्डिंग या डिक्टेशन के दौरान कभी नहीं, और टर्मिनल, एडिटर या चल रहे कोडिंग एजेंट के लिए कभी नहीं।",
  "power.lid.freeze.apps": "फ़्रीज़ करने वाले ऐप",
  "power.lid.mute.title": "आवाज़ म्यूट करें",
  "power.lid.mute.help":
    "साउंड आउटपुट म्यूट करता है और उसे ठीक पहले जैसा लौटा देता है, भले ही बीच में आपने आउटपुट बदला हो।",
  "power.lid.lowPower.title": "लो पावर मोड",
  "power.lid.lowPower.help":
    "लो पावर मोड चालू करता है। वैकल्पिक विशेषाधिकार वाला सहायक चाहिए; उसके बिना यह छोड़ दिया जाता है।",
  "power.lid.docker.title": "Docker Desktop फ़्रीज़ करें",
  "power.lid.docker.help":
    "जब कोई कंटेनर नहीं चल रहा हो तब Docker Desktop को रोकता है। कंटेनर चलने पर या Docker की स्थिति अज्ञात होने पर कभी नहीं।",
  "power.lid.nap.title": "एजेंट ऐप को App Nap से दूर रखें",
  "power.lid.nap.help":
    "macOS को आपके बताए ऐप धीमे करने से रोकता है। उनकी पिछली सेटिंग सहेजी जाती है और ठीक वैसी ही लौटाई जाती है।",
  "power.lid.nap.apps": "ऐप (बंडल आईडी, जैसे com.example.App)",
  "power.lid.protected.title": "कभी फ़्रीज़ नहीं",
  "power.lid.protected.help":
    "इन्हें हमेशा छोड़ दिया जाता है। आप सूची में जोड़ सकते हैं, लेकिन अंतर्निहित सुरक्षा हटाई नहीं जा सकती।",
  "power.lid.protected.builtIn": "अंतर्निहित",
  "power.lid.protected.extra": "प्रोग्राम या ऐप का नाम जोड़ें",
  "power.lid.list.empty": "कुछ नहीं जोड़ा गया।",
  "power.lid.list.remove": "{item} हटाएँ",
  "power.lid.list.duplicate": "यह पहले से सूची में है।",
  "power.lid.list.full": "सूची भरी है ({max} प्रविष्टियाँ)।",
  "power.lid.invalid.bundle":
    "com.example.App जैसी बंडल आईडी इस्तेमाल करें: अक्षर, अंक और हाइफ़न, कम से कम एक बिंदु के साथ।",
  "power.lid.invalid.name": "सादा प्रोग्राम या ऐप नाम इस्तेमाल करें: अक्षर, अंक, स्पेस और . _ + -",
  "power.lid.unsupported": "यहाँ उपलब्ध नहीं: {reason}",
  "power.lid.gapNote":
    "इनमें से कुछ इस कंप्यूटर पर सिर्फ़ आंशिक रूप से काम करते हैं। क्या समर्थित है और क्या नहीं, यह जानने के लिए README-lid.md देखें।",
  "power.lid.last.title": "ढक्कन की आख़िरी घटना",
  "power.lid.last.closed": "ढक्कन {time} पर बंद हुआ।",
  "power.lid.last.opened": "ढक्कन {time} पर खुला।",
  "power.lid.last.none": "अभी तक कुछ नहीं हुआ।",
  "power.lid.last.mismatched":
    "{count, plural, other {# प्रक्रियाएँ फिर से चालू नहीं की गईं क्योंकि वे अब उससे मेल नहीं खाती थीं जो Phoenix ने फ़्रीज़ किया था।}}",
  "power.lid.last.stillClosed": "ढक्कन अभी बंद है और ऊपर की क्रियाएँ लागू हैं।",
  "power.lid.outcome.applied": "हो गया",
  "power.lid.outcome.skipped": "छोड़ा गया",
  "power.lid.outcome.failed": "विफल",
  "power.lid.outcome.undone": "वापस किया गया",
  "power.lid.outcome.undo_failed": "वापस नहीं किया जा सका (Phoenix फिर कोशिश करेगा)",
  "power.lid.reason.unsupported_platform": "यह केवल Mac पर समर्थित है।",
  "power.lid.reason.helper_unavailable": "विशेषाधिकार वाला सहायक इंस्टॉल नहीं है।",
  "power.lid.reason.tool_missing": "ज़रूरी टूल इंस्टॉल नहीं है।",
  "power.lid.reason.already_on": "किसी और कारण से पहले से चालू है।",
  "power.lid.reason.state_unknown":
    "Phoenix यह नहीं जान सकता कि आप मीटिंग में हैं या नहीं, इसलिए उसने कुछ नहीं किया।",
  "power.lid.reason.protected_state": "मीटिंग, रिकॉर्डिंग या डिक्टेशन चल रहा है।",
  "power.lid.reason.docker_busy": "एक कंटेनर चल रहा है।",
  "power.lid.reason.docker_unknown": "Docker की स्थिति अज्ञात है।",
  "power.lid.reason.process_list_unavailable": "चल रहे प्रोग्रामों की सूची पढ़ी नहीं जा सकी।",
  "power.lid.reason.audio_unavailable": "साउंड आउटपुट पढ़े नहीं जा सके।",
  "power.lid.reason.no_targets": "बदलने के लिए कुछ नहीं था।",
  "power.lid.reason.nothing_to_do": "बदलने के लिए कुछ नहीं था।",
  "power.lid.reason.journal_unwritable": "रिकवरी जर्नल लिखा नहीं जा सका, इसलिए कुछ नहीं बदला गया।",
  "power.lid.reason.not_applied": "कुछ नहीं बदला गया।",
  "power.lid.reason.apply_failed": "बदलाव नहीं किया जा सका।",
  "power.lid.reason.undo_failed": "बदलाव वापस नहीं किया जा सका।",
  "power.lid.reason.assertions_unknown":
    "Phoenix यह नहीं जान सकता कि कोई ऐप कॉल में है या नहीं, इसलिए उसने कुछ भी फ़्रीज़ नहीं किया।",
  "power.lid.reason.holds_assertion":
    "सभी चैट ऐप इस्तेमाल में हैं (कॉल या प्लेबैक), इसलिए कोई फ़्रीज़ नहीं किया गया।",
  "power.lid.reason.output_changed":
    "ढक्कन बंद रहते समय साउंड आउटपुट बदल दिया गया, इसलिए Phoenix ने नए आउटपुट को नहीं छुआ। जो आउटपुट उसने म्यूट किया था वह तब तक म्यूट रहेगा जब तक वह फिर से डिफ़ॉल्ट न बन जाए।",
  "power.lid.reason.retry_or_alert":
    "फ़्रीज़ किया गया ऐप दोबारा शुरू हुआ लगता है, इसलिए Phoenix ने उसे फिर शुरू नहीं किया। जाँचें कि आपके चैट ऐप सामान्य रूप से चल रहे हैं।",
  "power.lid.reason.not_ours":
    "कुछ प्रोसेस फिर शुरू नहीं किए जा सके क्योंकि उन्हें नियंत्रित करना Phoenix का काम नहीं है।",
  "power.lid.limit.output_identity_unknown":
    "Phoenix साउंड आउटपुट का नाम नहीं पढ़ सकता, इसलिए वह नहीं जान सकता कि आउटपुट बदला या नहीं।",
  "power.lid.limit.brightness_tool_untrusted":
    "ब्राइटनेस टूल की फ़ाइल चलाने के लिए सुरक्षित नहीं है (गलत मालिक, या दूसरों द्वारा लिखने योग्य), इसलिए उसका उपयोग नहीं किया गया।",
  "power.lid.reason.other": "यह काम नहीं किया।",
  "power.lid.limit.brightness_tool_missing":
    "मुफ़्त ब्राइटनेस टूल इंस्टॉल नहीं है, इसलिए सिर्फ़ डिस्प्ले स्लीप इस्तेमाल होता है और ब्राइटनेस नहीं बदलती।",
  "power.lid.limit.keyboard_backlight_unsupported":
    "थर्ड-पार्टी सॉफ़्टवेयर के बिना कीबोर्ड लाइट नियंत्रित नहीं की जा सकती।",
  "power.lid.limit.default_output_only": "सिर्फ़ मौजूदा डिफ़ॉल्ट आउटपुट म्यूट किया जा सकता है।",
  "power.lid.applyNote":
    "बदलाव तब लागू होते हैं जब अगला सत्र ढक्कन बंद होते देखता है। हर चीज़ किए जाने से पहले जर्नल में दर्ज होती है।",
  "power.lid.saved": "सहेजा गया।",
  "power.lid.glance.closed": "ढक्कन बंद है: ढक्कन-बंद क्रियाएँ लागू हैं।",
  "power.lid.glance.failed":
    'एक ढक्कन-बंद क्रिया वापस नहीं की जा सकी। विवरण के लिए "जागा रखें" खोलें।',
};
