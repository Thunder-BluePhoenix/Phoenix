// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { automation as enAutomation } from "../../en/automation";

/** Machine-translated; unreviewed (see ../../README.md). */
export const automation: Record<keyof typeof enAutomation, string> = {
  // ---- workflows: tables and checks (core/workflows.ts) ----
  "automation.workflows.environment.local": "लोकल",
  "automation.workflows.environment.dev": "डेवलपमेंट",
  "automation.workflows.environment.staging": "स्टेजिंग",
  "automation.workflows.environment.production": "प्रोडक्शन",
  "automation.workflows.environment.productionLive": "प्रोडक्शन (लाइव सिस्टम बदलता है)",

  "automation.workflows.runStatus.queued": "कतार में",
  "automation.workflows.runStatus.running": "चल रहा है",
  "automation.workflows.runStatus.waiting_approval": "आपकी स्वीकृति की प्रतीक्षा में",
  "automation.workflows.runStatus.compensating": "पिछले चरण पूर्ववत किए जा रहे हैं",
  "automation.workflows.runStatus.succeeded": "सफल",
  "automation.workflows.runStatus.rejected": "आपने अस्वीकार किया",
  "automation.workflows.runStatus.failed": "विफल",
  "automation.workflows.runStatus.failed_needs_attention": "विफल: आपके ध्यान की ज़रूरत है",
  "automation.workflows.runStatus.cancelled": "रद्द किया गया",
  "automation.workflows.runStatus.interrupted": "बाधित (Phoenix पुनः आरंभ हुआ)",
  "automation.workflows.runStatus.refused": "अस्वीकृत: इसे चलने की अनुमति नहीं थी",

  "automation.workflows.stepStatus.running": "चल रहा है",
  "automation.workflows.stepStatus.waiting": "प्रतीक्षा में",
  "automation.workflows.stepStatus.succeeded": "सफल",
  "automation.workflows.stepStatus.failed": "विफल",
  "automation.workflows.stepStatus.timed_out": "समय समाप्त (परिणाम अज्ञात)",
  "automation.workflows.stepStatus.rejected": "अस्वीकृत",
  "automation.workflows.stepStatus.expired": "समय सीमा समाप्त",
  "automation.workflows.stepStatus.unknown": "परिणाम अज्ञात",

  "automation.workflows.authorisation.notNeeded": "प्राधिकरण की ज़रूरत नहीं",
  "automation.workflows.authorisation.authorised": "प्रोडक्शन के लिए अधिकृत",
  "automation.workflows.authorisation.notAuthorised": "अधिकृत नहीं: ट्रिगर अस्वीकार किए जाते हैं",

  "automation.workflows.expiry.invalid": "यह मान्य तारीख और समय नहीं है।",
  "automation.workflows.expiry.past": "समाप्ति का समय भविष्य में होना चाहिए।",
  "automation.workflows.expiry.tooFar": "समाप्ति अधिकतम {days} दिन बाद की हो सकती है।",
  "automation.workflows.refused.noReason": "कोई कारण नहीं बताया गया।",
  "automation.workflows.payload.invalidJson": "पेलोड मान्य JSON नहीं है।",
  "automation.workflows.payload.notObject": "पेलोड एक JSON ऑब्जेक्ट होना चाहिए, जैसे '{}'।",
  "automation.workflows.payload.tooMany": "पेलोड में अधिकतम {max} कुंजियाँ हो सकती हैं।",

  // ---- workflows: the list ----
  "automation.workflows.title": "वर्कफ़्लो",
  "automation.workflows.intro":
    "वर्कफ़्लो किसी इवेंट पर चरणों की तय सूची के साथ प्रतिक्रिया करता है। प्रोडक्शन बदलने वाला वर्कफ़्लो तब तक कुछ नहीं करता, जब तक आप ठीक उसी परिभाषा को अधिकृत नहीं करते जिसकी आपने समीक्षा की है।",
  "automation.workflows.empty": "अभी कोई वर्कफ़्लो नहीं है। नीचे परिभाषा की समीक्षा करके एक बनाएँ।",
  "automation.workflows.row.runsWhen": "{event} होने पर चलता है · संस्करण {version}",
  "automation.workflows.row.cannotRun": "चल नहीं सकता: {problems}",
  "automation.workflows.row.metrics": "{started} रन, {succeeded} सफल",

  // ---- workflows: the numbers of one workflow ----
  "automation.workflows.metrics.title": "आँकड़े",
  "automation.workflows.metrics.label": "मेट्रिक्स",
  "automation.workflows.metrics.none": "यह वर्कफ़्लो अभी चला नहीं है, इसलिए कोई आँकड़े नहीं हैं।",
  "automation.workflows.metrics.started": "शुरू हुए रन",
  "automation.workflows.metrics.succeeded": "सफल",
  "automation.workflows.metrics.failed": "विफल",
  "automation.workflows.metrics.attention": "आपके ध्यान की ज़रूरत",
  "automation.workflows.metrics.cancelled": "रद्द",
  "automation.workflows.metrics.refused": "अस्वीकृत",
  "automation.workflows.metrics.interrupted": "बाधित",
  "automation.workflows.metrics.stepsFailed": "विफल चरण",
  "automation.workflows.metrics.stepsFailedValue": "{count} (चरणों का {percent}%)",
  "automation.workflows.metrics.approvalsWaiting": "प्रतीक्षारत स्वीकृतियाँ",
  "automation.workflows.metrics.approvalsOutcome": "स्वीकृतियाँ: स्वीकृत / अस्वीकृत / समय समाप्त",
  "automation.workflows.metrics.approvalsOutcomeValue": "{approved} / {rejected} / {expired}",
  "automation.workflows.metrics.runTime": "रन समय (माध्यिका / 90वाँ पर्सेंटाइल)",
  "automation.workflows.metrics.runTimeValue":
    "{median} ms / {p90} ms, {samples, plural, one {# रन} other {# रन}} पर",
  "automation.workflows.metrics.noFinishedRuns": "कोई पूरा हुआ रन नहीं",

  // ---- workflows: the definition editor ----
  "automation.workflows.editor.titleEdit": "परिभाषा संपादित करें",
  "automation.workflows.editor.titleCreate": "वर्कफ़्लो बनाएँ",
  "automation.workflows.editor.introExisting":
    'पूरी JSON परिभाषा दर्ज करें। "enabled": {enabled} रखें; यह संपादन इसकी मौजूदा स्विच स्थिति बनाए रखता है। सहेजने से यह अधिकृत या चालू नहीं होता। जाँच कभी सहेजती नहीं है।',
  "automation.workflows.editor.introNew":
    'पूरी JSON परिभाषा दर्ज करें। नई परिभाषाओं में "enabled": false होना ज़रूरी है। सहेजने से वे चलती, सक्षम या अधिकृत नहीं होतीं। जाँच कभी सहेजती नहीं है।',
  "automation.workflows.editor.label": "वर्कफ़्लो परिभाषा (JSON)",
  "automation.workflows.editor.check": "ड्राफ़्ट जाँचें",
  "automation.workflows.editor.enterJson": "जाँचने से पहले JSON वर्कफ़्लो परिभाषा दर्ज करें।",
  "automation.workflows.editor.notObject": "वर्कफ़्लो परिभाषा एक JSON ऑब्जेक्ट होनी चाहिए।",
  "automation.workflows.editor.keepEnabled":
    '"enabled": {enabled} रखें। सहेजने के बाद स्विच अलग से बदलें।',
  "automation.workflows.editor.setDisabled":
    '"enabled": false सेट करें। नई परिभाषा सहेजने पर वह चालू नहीं होनी चाहिए।',
  "automation.workflows.editor.keepId":
    "संपादन में वर्कफ़्लो ID वही रहनी चाहिए। नई ID के लिए “वर्कफ़्लो बनाएँ” का उपयोग करें।",
  "automation.workflows.editor.notValid": "मान्य नहीं: {problems}",
  "automation.workflows.editor.noHash": "सत्यापन ने मान्य परिभाषा हैश नहीं लौटाया।",
  "automation.workflows.editor.hashDiffers":
    "सहेजा गया परिभाषा हैश समीक्षा किए गए हैश से अलग है। उपयोग करने से पहले संग्रहीत परिभाषा की समीक्षा करें।",
  "automation.workflows.editor.savedExisting":
    "परिभाषा सहेजी गई। मौजूदा स्विच स्थिति नहीं बदली; सहेजने से यह अधिकृत नहीं होती।",
  "automation.workflows.editor.savedNew":
    "परिभाषा बंद स्थिति में सहेजी गई। सहेजने से यह अधिकृत या सक्षम नहीं होती।",
  "automation.workflows.editor.reviewed": "समीक्षा की गई परिभाषा",
  "automation.workflows.editor.validLead": "मान्य ड्राफ़्ट।",
  "automation.workflows.editor.valid":
    "{lead} सहेजने से पहले इसी परिभाषा और हैश की समीक्षा करें। बदलाव के लिए दोबारा जाँच ज़रूरी है।",
  "automation.workflows.editor.toSave": "सहेजी जाने वाली परिभाषा",
  "automation.workflows.editor.hash": "सत्यापित हैश: {hash}",
  "automation.workflows.editor.authRequired": "अलग से प्राधिकरण ज़रूरी: {reasons}",
  "automation.workflows.editor.authNotRequired": "प्राधिकरण ज़रूरी नहीं।",
  "automation.workflows.editor.switchOn": "सहेजने से कभी अधिकृत नहीं होता; स्विच चालू रहता है।",
  "automation.workflows.editor.switchOff": "सहेजने से कभी अधिकृत नहीं होता; स्विच बंद रहता है।",
  "automation.workflows.editor.switchNew":
    "सहेजने से कभी अधिकृत नहीं होता; नया वर्कफ़्लो बंद रहता है।",
  "automation.workflows.editor.confirm": "पुष्टि करें: ठीक यही परिभाषा सहेजें",
  "automation.workflows.editor.reviewStored": "संग्रहीत वर्कफ़्लो की समीक्षा करें",

  // ---- workflows: checking the stored definition ----
  "automation.workflows.validate.button": "परिभाषा जाँचें",
  "automation.workflows.validate.dryRun": "यह ड्राई रन है। कुछ सहेजा नहीं जाता और कुछ चलता नहीं।",
  "automation.workflows.validate.validLead": "मान्य।",
  "automation.workflows.validate.valid": "{lead} हैश {hash}। {authorisation}",
  "automation.workflows.validate.needsAuth": "आपके प्राधिकरण की ज़रूरत है: {reasons}।",
  "automation.workflows.validate.noAuth": "प्राधिकरण की ज़रूरत नहीं।",
  "automation.workflows.validate.invalidLead": "मान्य नहीं।",
  "automation.workflows.validate.invalid":
    "{lead} {count, plural, one {# समस्या:} other {# समस्याएँ:}}",
  "automation.workflows.validate.problems": "समस्याएँ",

  // ---- workflows: authorising ----
  "automation.workflows.authorise.title": "प्रोडक्शन के लिए अधिकृत करें",
  "automation.workflows.authorise.notNeeded": "इस वर्कफ़्लो को प्राधिकरण की ज़रूरत नहीं है।",
  "automation.workflows.authorise.why": "इसे आपके प्राधिकरण की ज़रूरत क्यों है:",
  "automation.workflows.authorise.reasons": "कारण",
  "automation.workflows.authorise.intro":
    "इससे वर्कफ़्लो {name} हर बार {event} होने पर चल सकेगा, और इन चरणों के लिए आगे कोई सवाल नहीं पूछा जाएगा, जब तक वर्कफ़्लो खुद न पूछे:",
  "automation.workflows.authorise.allowed": "क्या चलने की अनुमति होगी",
  "automation.workflows.authorise.noTools": "यह कोई टूल नहीं बुलाता।",
  "automation.workflows.authorise.step": "चरण {step} {tool} को बुलाता है",
  "automation.workflows.authorise.stepUndo": "चरण {step} {tool} को बुलाता है (पूर्ववत: {undo})",
  "automation.workflows.authorise.being": "अधिकृत की जा रही परिभाषा: संस्करण {version}, हैश {hash}",
  "automation.workflows.authorise.expires": "समाप्ति {hint}",
  "automation.workflows.authorise.expiresHint": "(वैकल्पिक, {days} दिनों के भीतर)",
  "automation.workflows.authorise.submit": "ठीक इसी परिभाषा को अधिकृत करें",
  "automation.workflows.authorise.done":
    "संस्करण {version} अधिकृत किया गया। परिभाषा में बाद का कोई भी बदलाव इसे समाप्त कर देता है।",

  // ---- workflows: run now ----
  "automation.workflows.runNow.title": "अभी चलाएँ",
  "automation.workflows.runNow.intro":
    "वर्कफ़्लो को हाथ से उन्हीं जाँचों के साथ शुरू करता है जो इवेंट होने पर होती हैं: सक्षम हो, आपातकालीन स्टॉप से रुका न हो, मान्य हो, और प्रोडक्शन बदलता हो तो अधिकृत हो।",
  "automation.workflows.runNow.payload": "इवेंट के साथ आने वाला डेटा {hint}",
  "automation.workflows.runNow.payloadHint": "(JSON ऑब्जेक्ट, वैकल्पिक)",
  "automation.workflows.runNow.button": "अभी चलाएँ",
  "automation.workflows.runNow.cannotRun": "यह चल नहीं सकता: {problems}",
  "automation.workflows.runNow.enableFirst": "चलाने के लिए वर्कफ़्लो सक्षम करें।",
  "automation.workflows.runNow.refusedLead": "शुरुआत अस्वीकार कर दी गई।",
  "automation.workflows.runNow.seeRefused": "अस्वीकृत रन देखें",
  "automation.workflows.runNow.started": "शुरू हो गया। {link}",
  "automation.workflows.runNow.follow": "रन को फ़ॉलो करें",

  // ---- workflows: one workflow ----
  "automation.workflows.detail.all": "सभी वर्कफ़्लो",
  "automation.workflows.detail.backAll": "← सभी वर्कफ़्लो",
  "automation.workflows.detail.productionLead": "प्रोडक्शन।",
  "automation.workflows.detail.production":
    "{lead} यह वर्कफ़्लो लाइव सिस्टम बदल सकता है। यह केवल तभी चलता है जब तक आपने इसकी ठीक यही परिभाषा अधिकृत की हो।",
  "automation.workflows.detail.cannotRunNow": "यह अभी चल नहीं सकता:",
  "automation.workflows.detail.definition": "परिभाषा",
  "automation.workflows.detail.versionHash": "संस्करण {version} · हैश {hash}",
  "automation.workflows.detail.runsWhen": "{event} होने पर चलता है।",
  "automation.workflows.detail.runsWhenAnd": "{event} होने और {condition} पर चलता है।",
  "automation.workflows.detail.tools": "वे टूल जिन्हें यह बुला सकता है",
  "automation.workflows.detail.toolsLabel": "टूल",
  "automation.workflows.detail.none": "कोई नहीं।",
  "automation.workflows.detail.toolStep": "चरण {step}: {tool}",
  "automation.workflows.detail.flagged": "प्रोडक्शन या अहम कार्रवाई",
  "automation.workflows.detail.declaredUndo": "घोषित पूर्ववत: {undo}",
  "automation.workflows.detail.definitionText":
    "परिभाषा (केवल-पढ़ने योग्य टेक्स्ट, स्क्रॉल होता है)",
  "automation.workflows.detail.unreadable": "संग्रहीत परिभाषा पढ़ी नहीं जा सकी।",
  "automation.workflows.detail.switch": "स्विच",
  "automation.workflows.detail.enable": "सक्षम करें",
  "automation.workflows.detail.disable": "अक्षम करें",
  "automation.workflows.detail.switchNote":
    "सक्षम करने से प्राधिकरण नहीं मिलता। सक्षम किया हुआ पर अधिकृत न किया गया प्रोडक्शन वर्कफ़्लो हर ट्रिगर को अस्वीकृत दर्ज करता है।",
  "automation.workflows.detail.authorisations": "प्राधिकरण",
  "automation.workflows.detail.noneYet": "अभी कोई नहीं।",
  "automation.workflows.detail.inForce": "लागू",
  "automation.workflows.detail.revoked": "रद्द किया गया",
  "automation.workflows.detail.notInForce": "लागू नहीं",
  "automation.workflows.detail.authorisedBy": "{by} द्वारा, {date} को",
  "automation.workflows.detail.authExpires": "समाप्ति {date}",
  "automation.workflows.detail.authChanged": "परिभाषा बदल गई या समय सीमा समाप्त हो गई",
  "automation.workflows.detail.forHash": "हैश {hash} के लिए",
  "automation.workflows.detail.confirmRevoke": "पुष्टि करें: प्राधिकरण रद्द करें",
  "automation.workflows.detail.revoke": "प्राधिकरण रद्द करें…",
  "automation.workflows.detail.revokeNote": "चल रहे रन अपने अगले चरण पर रुक जाते हैं।",
  "automation.workflows.detail.recentRuns": "हाल के रन",
  "automation.workflows.detail.noRuns": "अभी कोई रन नहीं।",

  // ---- workflows: runs and steps ----
  "automation.workflows.run.needsLook": "(देखने की ज़रूरत है)",
  "automation.workflows.run.notSuccess": "(सफल नहीं)",
  "automation.workflows.run.nowAtStep": "अब चरण {step} पर",
  "automation.workflows.run.atStep": "चरण {step} पर",
  "automation.workflows.run.backToWorkflow": "वर्कफ़्लो पर वापस जाएँ",
  "automation.workflows.run.title": "{name} का रन",
  "automation.workflows.run.created": "बनाया गया {date}",
  "automation.workflows.run.finished": "पूरा हुआ {date}",
  "automation.workflows.run.chainDepth": "चेन गहराई {depth}",
  "automation.workflows.run.waitingForYou": "आपकी प्रतीक्षा में",
  "automation.workflows.run.stop": "इस रन को रोकें",
  "automation.workflows.run.confirmCancel": "पुष्टि करें: इस रन को रद्द करें",
  "automation.workflows.run.keepRunning": "चलने दें",
  "automation.workflows.run.cancel": "इस रन को रद्द करें…",
  "automation.workflows.run.cancelNote":
    "रद्द करने पर घोषित पूर्ववत चरण नहीं चलते। जो चरण पहले से चल रहा है, वह फिर भी पूरा हो सकता है।",
  "automation.workflows.run.trigger": "इसे किसने शुरू किया",
  "automation.workflows.run.triggerText": "ट्रिगर (सादा टेक्स्ट, स्क्रॉल होता है)",
  "automation.workflows.run.stepsHeading": "चरण ({count})",
  "automation.workflows.run.stepsLabel": "चरण",
  "automation.workflows.run.noSteps": "कोई चरण शुरू नहीं हुआ।",
  "automation.workflows.step.undo": "पूर्ववत: {step}",
  "automation.workflows.step.attempts": "{count, plural, one {# प्रयास} other {# प्रयास}}",
  "automation.workflows.step.changesState": "स्थिति बदलता है",
  "automation.workflows.step.destructive": "{lead}: यह चरण असली सिस्टम बदल सकता है।",
  "automation.workflows.step.tool": "टूल {tool}",
  "automation.workflows.step.input": "चरण {step} का इनपुट (सादा टेक्स्ट, स्क्रॉल होता है)",
  "automation.workflows.step.output": "चरण {step} का आउटपुट (सादा टेक्स्ट, स्क्रॉल होता है)",

  // ---- plans: tables and checks (core/plans.ts) ----
  "automation.plans.status.draft": "ड्राफ़्ट: अभी प्रस्तावित नहीं",
  "automation.plans.status.proposed": "प्रस्तावित: आपकी स्वीकृति की प्रतीक्षा में",
  "automation.plans.status.approved": "स्वीकृत: बनाने के लिए तैयार",
  "automation.plans.status.creating": "कार्य बनाए जा रहे हैं…",
  "automation.plans.status.created": "बनाया गया",
  "automation.plans.status.failed": "विफल: कुछ कार्य नहीं बने",
  "automation.plans.status.cancelled": "रद्द किया गया",
  "automation.plans.basis.meeting": "मीटिंग से",
  "automation.plans.basis.suggested": "मॉडल द्वारा सुझाया गया",
  "automation.plans.basis.user": "आपके द्वारा लिखा गया",
  "automation.plans.run.pending": "शुरू नहीं हुआ",
  "automation.plans.run.attempting": "जारी है",
  "automation.plans.run.created": "बनाया गया",
  "automation.plans.run.failed": "विफल",
  "automation.plans.tool.githubIssue": "GitHub इश्यू बनाएँ",
  "automation.plans.tool.frappeTask": "Frappe टास्क बनाएँ",
  "automation.plans.kind.decision": "निर्णय",
  "automation.plans.kind.action_item": "एक्शन आइटम",
  "automation.plans.kind.requirement": "आवश्यकता",
  "automation.plans.authorship.rules":
    "नियम-आधारित ड्राफ़्ट: इसे किसी AI ने नहीं लिखा, यह केवल मीटिंग के आइटम को दोहराता है।",
  "automation.plans.authorship.model":
    "मॉडल आउटपुट ({model}): स्वीकृत करने से पहले इसे मीटिंग से मिलाकर जाँचें।",
  "automation.plans.destination.github": "GitHub रिपॉज़िटरी {repository}",
  "automation.plans.destination.frappe": "Frappe साइट {site}",
  "automation.plans.problem.repository": "रिपॉज़िटरी “owner/name” जैसी दिखनी चाहिए।",
  "automation.plans.problem.site": "यह मान्य Frappe साइट नाम नहीं है।",
  "automation.plans.problem.titleEmpty": "शीर्षक खाली नहीं हो सकता।",
  "automation.plans.problem.titleLong": "शीर्षक {max} से लंबा है।",
  "automation.plans.problem.summaryEmpty": "सारांश खाली नहीं हो सकता।",
  "automation.plans.problem.summaryLong": "सारांश {max} से लंबा है।",
  "automation.plans.problem.taskCount": "योजना में 1 से {max} कार्य होने चाहिए।",
  "automation.plans.problem.taskTitle": "कार्य {n} को शीर्षक चाहिए।",
  "automation.plans.problem.bodyLong": "मुख्य पाठ {max} से लंबा है।",
  "automation.plans.problem.labelCount": "अधिकतम {max} लेबल।",
  "automation.plans.problem.labelLong": "एक लेबल {max} से लंबा है।",

  // ---- plans: make a plan from a meeting item ----
  "automation.plans.off": "योजना बनाना बंद है।",
  "automation.plans.make.open": "योजना बनाएँ…",
  "automation.plans.make.openFrom": "{kind} से योजना बनाएँ: {text}",
  "automation.plans.make.intro":
    "योजना इंजीनियरिंग कार्यों का ड्राफ़्ट है। जब तक आप इसे स्वीकृत नहीं करते और हर कार्य की पुष्टि नहीं करते, कुछ नहीं बनता।",
  "automation.plans.make.where": "कार्य कहाँ जाएँगे?",
  "automation.plans.make.githubIssues": "GitHub इश्यू",
  "automation.plans.make.frappeTasks": "Frappe टास्क",
  "automation.plans.make.repository": "रिपॉज़िटरी (owner/name)",
  "automation.plans.make.site": "Frappe साइट",
  "automation.plans.make.chooseSite": "साइट चुनें",
  "automation.plans.make.drafting": "योजना का ड्राफ़्ट बन रहा है…",
  "automation.plans.make.draft": "योजना का ड्राफ़्ट बनाएँ",
  "automation.plans.make.localModel":
    "लोकल मॉडल को एक मिनट लग सकता है। कुछ भी कहीं और नहीं भेजा जाता।",
  "automation.plans.make.drafted": "योजना का ड्राफ़्ट तैयार।",
  "automation.plans.make.openPlan": "योजना खोलें",

  // ---- plans: on a meeting ----
  "automation.plans.meeting.title": "इस मीटिंग की योजनाएँ और कार्य",
  "automation.plans.meeting.plans": "योजनाएँ",
  "automation.plans.meeting.summary":
    "{status} · {count, plural, one {# कार्य} other {# कार्य}} · {system}",
  "automation.plans.meeting.tasksCreated": "बनाए गए कार्य",
  "automation.plans.meeting.tasksLabel": "इस मीटिंग से बनाए गए कार्य",
  "automation.plans.link.frappeTask": "कार्य {id}",
  "automation.plans.link.detail": "{plan} का कार्य {index} · {date} को स्वीकृत",
  "automation.plans.link.itsPlan": "इसकी योजना",

  // ---- plans: the editor ----
  "automation.plans.editor.label": "योजना संपादित करें",
  "automation.plans.editor.title": "शीर्षक {hint}",
  "automation.plans.editor.summary": "सारांश {hint}",
  "automation.plans.editor.upTo": "(अधिकतम {max})",
  "automation.plans.editor.tasks": "कार्य {hint}",
  "automation.plans.editor.tasksRange": "(1 से {max})",
  "automation.plans.editor.task": "कार्य {n}",
  "automation.plans.editor.taskTitle": "कार्य {n} का शीर्षक",
  "automation.plans.editor.taskBody": "कार्य {n} का मुख्य पाठ {hint}",
  "automation.plans.editor.taskLabels": "कार्य {n} के लेबल {hint}",
  "automation.plans.editor.labelsHint": "(अल्पविराम से अलग, अधिकतम {max})",
  "automation.plans.editor.removeTask": "कार्य {n} हटाएँ",
  "automation.plans.editor.addTask": "कार्य जोड़ें",
  "automation.plans.editor.note":
    "सहेजने पर योजना वापस ड्राफ़्ट बन जाती है और कोई भी स्वीकृति हट जाती है। फिर आप इसे दोबारा प्रस्तावित और स्वीकृत करते हैं।",
  "automation.plans.editor.save": "बदलाव सहेजें",

  // ---- plans: preview and results ----
  "automation.plans.preview.title": "ठीक क्या भेजा जाएगा",
  "automation.plans.preview.intro":
    "हर कार्य आपके नाम से की गई एक कॉल है। यह असली इनपुट है, सादे टेक्स्ट में दिखाया गया।",
  "automation.plans.preview.calls": "जो कॉल की जाएँगी",
  "automation.plans.preview.task": "कार्य {n}: {tool}",
  "automation.plans.preview.decision": "(प्रभाव: {effect}, जोखिम: {risk})",
  "automation.plans.preview.input": "कार्य {n} का इनपुट (सादा टेक्स्ट, स्क्रॉल होता है)",
  "automation.plans.runs.title": "कार्य दर कार्य",
  "automation.plans.runs.label": "कार्य के परिणाम",
  "automation.plans.runs.task": "कार्य {n}:",
  "automation.plans.runs.attempts": "{count, plural, one {# प्रयास} other {# प्रयास}}",
  "automation.plans.runs.frappeTask": "Frappe टास्क {id}",
  "automation.plans.runs.stopped":
    "कार्य {n} पर रुका: {message}। इसके बाद कुछ नहीं बना। आप “बनाएँ” दोबारा चला सकते हैं: जो कार्य बन चुके हैं वे मिल जाते हैं, दोहराए नहीं जाते।",

  // ---- plans: one plan ----
  "automation.plans.page.allMeetings": "सभी मीटिंग",
  "automation.plans.page.meeting": "← मीटिंग",
  "automation.plans.page.rules": "नियम-आधारित ड्राफ़्ट",
  "automation.plans.page.model": "मॉडल आउटपुट",
  "automation.plans.page.destination": "गंतव्य: {destination}",
  "automation.plans.page.from": "{kind} से: {text}",
  "automation.plans.page.owner": "स्वामी {owner}",
  "automation.plans.page.due": "देय {due}",
  "automation.plans.page.proposedNotice": "प्रस्तावित। पूर्वावलोकन जाँचें, फिर स्वीकृत करें।",
  "automation.plans.page.approvedNotice": "स्वीकृत। अभी कुछ नहीं बना है।",
  "automation.plans.page.savedNotice":
    "सहेजा गया। योजना फिर से ड्राफ़्ट है; स्वीकृत करने के लिए इसे प्रस्तावित करें।",
  "automation.plans.page.cancelledNotice": "रद्द किया गया। कुछ नहीं बना।",
  "automation.plans.page.plan": "योजना",
  "automation.plans.page.tasks": "कार्य ({count})",
  "automation.plans.page.tasksLabel": "कार्य",
  "automation.plans.page.labels": "लेबल:",
  "automation.plans.page.edit": "योजना संपादित करें",
  "automation.plans.page.acceptance": "स्वीकृति मानदंड",
  "automation.plans.page.risks": "जोखिम",
  "automation.plans.page.questions": "खुले प्रश्न",
  "automation.plans.frappe.doctype": "प्रस्तावित Frappe DocType: {doctype}",
  "automation.plans.frappe.note":
    "केवल सुझाया गया डिज़ाइन। कार्य बनाने से यह DocType, इसके फ़ील्ड, वर्कफ़्लो या अनुमतियाँ नहीं बनतीं।",
  "automation.plans.frappe.fields": "फ़ील्ड",
  "automation.plans.frappe.fieldsLabel": "प्रस्तावित Frappe फ़ील्ड",
  "automation.plans.frappe.required": "ज़रूरी",
  "automation.plans.frappe.noFields": "कोई फ़ील्ड प्रस्तावित नहीं।",
  "automation.plans.frappe.states": "वर्कफ़्लो स्थितियाँ",
  "automation.plans.frappe.statesLabel": "प्रस्तावित Frappe वर्कफ़्लो स्थितियाँ",
  "automation.plans.frappe.noStates": "कोई वर्कफ़्लो स्थिति प्रस्तावित नहीं।",
  "automation.plans.frappe.permissions": "अनुमतियाँ",
  "automation.plans.frappe.permissionsLabel": "प्रस्तावित Frappe अनुमतियाँ",
  "automation.plans.frappe.noPermissions": "कोई अनुमति प्रस्तावित नहीं।",
  "automation.plans.frappe.access": "{role}: {access}",
  "automation.plans.frappe.read": "पढ़ना",
  "automation.plans.frappe.write": "लिखना",
  "automation.plans.frappe.create": "बनाना",
  "automation.plans.frappe.noAccess": "कोई पहुँच नहीं",
  "automation.plans.decide.title": "निर्णय लें",
  "automation.plans.decide.fingerprint":
    "आप जो देख रहे हैं उसका फ़िंगरप्रिंट: {hash}। स्वीकृति ठीक इसी सामग्री पर लागू होती है; योजना बदलने पर यह अस्वीकार हो जाती है।",
  "automation.plans.decide.propose": "इस योजना को प्रस्तावित करें",
  "automation.plans.decide.nameMeeting": "बनाए गए कार्यों में मीटिंग का नाम दें",
  "automation.plans.decide.approve": "ठीक इसी योजना को स्वीकृत करें",
  "automation.plans.decide.approved": "{by} ने {date} को स्वीकृत किया।",
  "automation.plans.decide.approvedNamed":
    "{by} ने {date} को स्वीकृत किया · कार्यों में मीटिंग का नाम दिया गया है।",
  "automation.plans.decide.understand":
    "मैं समझता/समझती हूँ कि यह {destination} में मेरे नाम से {count, plural, one {# कार्य} other {# कार्य}} बनाता है।",
  "automation.plans.decide.createRemaining": "बाकी कार्य बनाएँ",
  "automation.plans.decide.create": "कार्य बनाएँ",
  "automation.plans.decide.waiting": "{total} में से कार्य {n} की आपकी स्वीकृति की प्रतीक्षा है।",
  "automation.plans.decide.waitingNote":
    "हर कार्य बनाने से पहले Core आपसे पूछता है। नीचे उत्तर दें; यह पृष्ठ जितनी देर लगे उतनी प्रतीक्षा करता है।",
  "automation.plans.decide.cancel": "इस योजना को रद्द करें",

  // ---- automation settings (AutomationSettings.tsx) ----
  "automation.settings.title": "ऑटोमेशन",
  "automation.settings.intro":
    "ऑटोमेशन तब तक बंद रहता है जब तक आप इसे चालू नहीं करते। बंद होने पर Fawkes कोई कार्य शुरू नहीं करता और अपने आप कुछ नहीं चलाता। चालू होने पर Fawkes केवल तभी कार्य शुरू कर सकता है जब आप कहें, जैसे Chat टैब में “CI विफलता का निदान करें”। यह डेटा पढ़ता है और सुझाव देता है; कुछ भी बदलने वाली कार्रवाई आपकी स्वीकृति की प्रतीक्षा करती है, और आप किसी भी समय कार्य रद्द कर सकते हैं। ऑटोमेशन बंद करने से चल रहे सभी कार्य रद्द हो जाते हैं।",
  "automation.settings.allow": "Fawkes को मेरे शुरू किए कार्य चलाने दें",
  "automation.settings.statusOn":
    "ऑटोमेशन चालू है। {active, plural, one {# कार्य चल रहा है} other {# कार्य चल रहे हैं}} (एक साथ अधिकतम {max})।",
  "automation.settings.statusOff":
    "ऑटोमेशन बंद है। {active, plural, one {# कार्य चल रहा है} other {# कार्य चल रहे हैं}} (एक साथ अधिकतम {max})।",
  "automation.settings.unavailable": "Phoenix Core से ऑटोमेशन सेटिंग उपलब्ध नहीं हैं ({error})।",

  // ---- proactive suggestions (ProactiveSettings.tsx) ----
  "automation.proactive.title": "सक्रिय सुझाव",
  "automation.proactive.intro":
    "डिफ़ॉल्ट रूप से बंद। उपलब्ध होने पर Kage स्वीकृत, बिना असाइन किए मीटिंग आइटम सुझा सकता है। इंजीनियरिंग संकेत केवल उन देखे गए रिपॉजिटरी रूट को स्कैन कर सकते हैं जिन्हें आप स्पष्ट रूप से जोड़ते हैं; उनका सलाह प्रदाता अनुपलब्ध है, इसलिए वह कभी सलाह की सूचना नहीं देता। मूल्यांकन मैन्युअल रहता है, जब तक आप ऑप्ट-इन के बाद स्पष्ट रूप से कोई अंतराल नहीं चुनते। नियोजित काम स्थानीय रूप से चलता है और शांत समय, दर सीमा और आपातकालीन रोक का सम्मान करता है।",
  "automation.proactive.status": "Kage स्रोत: {source}। सुझाव {state} हैं ({cadence})।",
  "automation.proactive.sourceAvailable": "उपलब्ध",
  "automation.proactive.sourceUnavailable": "अनुपलब्ध",
  "automation.proactive.stateOn": "चालू",
  "automation.proactive.stateOff": "बंद",
  "automation.proactive.cadenceEvery": "हर {minutes, plural, one {# मिनट} other {# मिनट}}",
  "automation.proactive.cadenceManual": "केवल मैन्युअल",
  "automation.proactive.optIn": "ऑप्ट-इन",
  "automation.proactive.enable": "सक्रिय सुझाव सक्षम करें",
  "automation.proactive.kageItems": "Kage के स्वीकृत, असाइन न किए गए एक्शन आइटम",
  "automation.proactive.engineeringSignals": "देखे गए रिपॉजिटरी से इंजीनियरिंग संकेत",
  "automation.proactive.engineeringSignalsStatus": "इंजीनियरिंग संकेत {state} हैं।",
  "automation.proactive.cadence": "स्वचालित मूल्यांकन अंतराल",
  "automation.proactive.cadenceOff": "केवल मैन्युअल (बंद)",
  "automation.proactive.cadence15": "हर 15 मिनट",
  "automation.proactive.cadence30": "हर 30 मिनट",
  "automation.proactive.cadence60": "हर घंटे",
  "automation.proactive.cadence1440": "हर दिन",
  "automation.proactive.quietHours": "शांत घंटे",
  "automation.proactive.useQuiet": "शांत घंटों का उपयोग करें",
  "automation.proactive.timezone": "टाइम ज़ोन (IANA)",
  "automation.proactive.quietFrom": "शांत समय से",
  "automation.proactive.quietUntil": "शांत समय तक",
  "automation.proactive.maxPerHour": "प्रति घंटे अधिकतम सुझाव",
  "automation.proactive.preview": "सुझावों का पूर्वावलोकन",
  "automation.proactive.evaluate": "अभी मूल्यांकन करें",
  "automation.proactive.refreshNoise": "नॉइज़ मेट्रिक्स रीफ़्रेश करें",
  "automation.proactive.delivered": "भेजे गए सुझाव",
  "automation.proactive.dismiss": "{title} खारिज करें",
  "automation.proactive.previewHeading": "प्रमाण-आधारित पूर्वावलोकन",
  "automation.proactive.previewLabel": "सुझाव पूर्वावलोकन",
  "automation.proactive.previewEmpty": "कोई पात्र स्वीकृत, असाइन न किया गया Kage एक्शन आइटम नहीं।",
  "automation.proactive.evidence": "प्रमाण: मीटिंग {meeting}, आइटम {item} ({source}): “{quote}”",
  "automation.proactive.sourceTranscript": "ट्रांसक्रिप्ट",
  "automation.proactive.sourceSummary": "सारांश",
  "automation.proactive.noiseLabel": "सुझाव नॉइज़ मेट्रिक्स",
  "automation.proactive.noiseDelivered": "भेजे गए",
  "automation.proactive.noiseDismissed": "खारिज किए गए",
  "automation.proactive.noiseSuppressed": "दबाए गए",
  "automation.proactive.noiseRate": "खारिज करने की दर",
  "automation.proactive.saved": "सुझाव प्राथमिकताएँ सहेजी गईं।",
  "automation.proactive.previewCount":
    "{count, plural, one {पूर्वावलोकन में # प्रमाण-आधारित सुझाव।} other {पूर्वावलोकन में # प्रमाण-आधारित सुझाव।}}",
  "automation.proactive.evaluated": "{delivered} भेजे गए; {suppressed} दबाए गए।",
  "automation.proactive.dismissed": "सुझाव खारिज किया गया।",

  // ---- capability registry (RegistrySettings.tsx) ----
  "automation.registry.title": "क्षमता रजिस्ट्री",
  "automation.registry.intro":
    "लोकल रूप से कॉन्फ़िगर किए गए, होस्ट-विश्वसनीय हस्ताक्षरित इंडेक्स का मेटाडेटा देखें। प्रविष्टियाँ लौटाने से पहले Phoenix Core इंडेक्स का हस्ताक्षर सत्यापित करता है। देखने से तृतीय-पक्ष कोड इंस्टॉल या चलता नहीं है।",
  "automation.registry.noInstall":
    "इंस्टॉलेशन अनुपलब्ध: ऑडिट किया हुआ OS सैंडबॉक्स उपलब्ध नहीं है। तृतीय-पक्ष क्षमताएँ यहाँ इंस्टॉल नहीं की जा सकतीं।",
  "automation.registry.unavailable": "रजिस्ट्री अनुपलब्ध",
  "automation.registry.loadFailed": "रजिस्ट्री लोड नहीं हो सकी: {error}",
  "automation.registry.loading": "रजिस्ट्री लोड हो रही है…",
  "automation.registry.notConfigured":
    "कोई लोकल रजिस्ट्री कॉन्फ़िगर नहीं है। क्षमताएँ देखने के लिए होस्ट प्रशासक से विश्वसनीय कुंजी और हस्ताक्षरित इंडेक्स कॉन्फ़िगर करने को कहें।",
  "automation.registry.indexSignature":
    "इंडेक्स हस्ताक्षर: होस्ट-विश्वसनीय Ed25519 हस्ताक्षरकर्ता {signer} से सत्यापित।",
  "automation.registry.signature": "हस्ताक्षर: {signature}",
  "automation.registry.indexHash": "हस्ताक्षरित इंडेक्स SHA-256: {hash}",
  "automation.registry.empty": "हस्ताक्षरित रजिस्ट्री में कोई क्षमता नहीं है।",
  "automation.registry.preview": "{name} {version} का पूर्वावलोकन",
  "automation.registry.previewFailed": "पूर्वावलोकन अनुपलब्ध: {error}",
  "automation.registry.previewLoading": "सत्यापित पूर्वावलोकन लोड हो रहा है…",
  "automation.registry.permissions": "अनुमतियाँ",
  "automation.registry.noDescription": "कोई विवरण नहीं दिया गया",
  "automation.registry.noneDeclared": "कुछ घोषित नहीं।",
  "automation.registry.dataCategories": "डेटा श्रेणियाँ",
  "automation.registry.licence": "लाइसेंस",
  "automation.registry.licenceLine": "{licence}। {policy}",
  "automation.registry.security": "सुरक्षा",
  "automation.registry.securityContact": "सुरक्षा संपर्क",
  "automation.registry.advisories": "सलाह-सूचनाएँ",
  "automation.registry.provenance": "हस्ताक्षरित उत्पत्ति-विवरण",
  "automation.registry.artifact":
    "हस्ताक्षरित इंडेक्स द्वारा घोषित आर्टिफ़ैक्ट SHA-256: {hash} ({bytes, plural, one {# बाइट} other {# बाइट}})। आर्टिफ़ैक्ट सत्यापन: सत्यापित नहीं; आर्टिफ़ैक्ट के बाइट न तो लाए गए हैं और न जाँचे गए हैं। देखने से आर्टिफ़ैक्ट नहीं चलता।",
  "automation.registry.sandbox":
    "सैंडबॉक्स: अनुपलब्ध। इंस्टॉलेशन अक्षम है; कोई इंस्टॉल अनुरोध नहीं भेजा जाएगा।",

  "automation.registry.skinPack": "केवल-डेटा स्किन पैक",
  "automation.registry.skinDataOnly":
    "केवल-डेटा Phoenix पोशाक पैक। यह कोड नहीं चला सकता और न अनुमति मांग सकता है।",
  "automation.registry.installSkin": "स्किन स्थापित करें {name} {version}",
  "automation.registry.installPending":
    "इस हस्ताक्षरित स्किन को स्थापित करने से पहले Core पुष्टि की प्रतीक्षा है।",
  "automation.registry.installSucceeded": "हस्ताक्षरित स्किन Wardrobe में स्थापित हो गई।",
  "automation.registry.installFailed": "स्किन स्थापना विफल: {error}",
  // ---- encrypted sync (SyncSettings.tsx) ----
  "automation.sync.title": "एन्क्रिप्टेड सिंक",
  "automation.sync.intro":
    "वैकल्पिक और डिफ़ॉल्ट रूप से बंद। सिंक के लिए आपका अपना उपलब्ध HTTPS रिले और रिले प्रमाणीकरण ज़रूरी है; Phoenix होस्टेड रिले नहीं देता। कॉन्फ़िगर करना स्पष्ट ऑप्ट-इन है: सेटअप के दौरान कुछ नहीं भेजा जाता, लेकिन बाद में ऑनलाइन रहते हुए कतार के रिकॉर्ड अपने आप सिंक होते हैं। “अभी सिंक करें” तुरंत प्रयास शुरू करता है। अडैप्टर केवल स्पष्ट रूप से चुनी गई दो गैर-सामग्री सेटिंग स्टेज करता है; बाद के लोकल बदलावों के लिए “मौजूदा प्रकाशित करें” ज़रूरी है। मीटिंग, व्यक्ति और मेमोरी का टेक्स्ट इस अडैप्टर में कभी शामिल नहीं होता।",
  "automation.sync.unavailable":
    "Phoenix Core से सिंक सेटिंग अनुपलब्ध हैं। इस स्थिति अनुरोध ने रिले से संपर्क नहीं किया।",
  "automation.sync.relayNone": "कॉन्फ़िगर नहीं",
  "automation.sync.relayUnknown": "कॉन्फ़िगर किया गया रिले (URL अनुपलब्ध)",
  "automation.sync.statusOn":
    "सिंक चालू है। {pending} कतार में; {conflicts, plural, one {# टकराव} other {# टकराव}}।",
  "automation.sync.statusOff":
    "सिंक बंद है। {pending} कतार में; {conflicts, plural, one {# टकराव} other {# टकराव}}।",
  "automation.sync.chooseExclusions":
    "ऑप्ट-इन से पहले बहिष्करण चुनें; बहिष्कृत श्रेणियाँ और प्रोजेक्ट अपलोड नहीं होते।",
  "automation.sync.excludeClasses": "डेटा श्रेणियाँ बाहर रखें",
  "automation.sync.class.preference": "प्राथमिकता",
  "automation.sync.class.context": "संदर्भ",
  "automation.sync.class.project_profile": "प्रोजेक्ट प्रोफ़ाइल",
  "automation.sync.excludeProject": "नाम से प्रोजेक्ट बाहर रखें",
  "automation.sync.excludeProjectButton": "प्रोजेक्ट बाहर रखें",
  "automation.sync.removeExclusion": "{name} का बहिष्करण हटाएँ",
  "automation.sync.exclusionsSaved": "बहिष्करण सहेजे गए।",
  "automation.sync.adapterLegend": "मौजूदा सेटिंग को अलग-अलग ऑप्ट-इन करें",
  "automation.sync.adapterNote":
    "केवल खाता-स्वामी-स्कोप की रिड्यूस्ड मोशन (प्राथमिकता) और खोज परिणाम संख्या (संदर्भ कॉन्फ़िगरेशन) पात्र हैं; कोई प्रोजेक्ट-स्कोप स्रोत नहीं है। चुनने पर मौजूदा मान स्टेज हो जाता है। बाद का लोकल बदलाव स्पष्ट रूप से प्रकाशित करें। आने वाले मान तब तक स्टेज रहते हैं जब तक आप उन्हें लोकल लागू करने की समीक्षा और पुष्टि नहीं करते। किसी श्रेणी को बाहर रखने पर, अनुमति हो तो, उसका अडैप्टर चयन भी हट जाता है; पहले से प्रकाशित रिकॉर्ड को पहले हटाकर सिंक करना होगा। चयन हटाने से अपलोड किया गया सिफ़रटेक्स्ट नहीं मिटता; ज़रूरत हो तो उसका सिंक किया आइटम अलग से हटाएँ।",
  "automation.sync.adapter.reducedMotion": "रिड्यूस्ड मोशन प्राथमिकता",
  "automation.sync.adapter.searchCount": "खोज परिणाम संख्या मेटाडेटा",
  "automation.sync.adapterSaved":
    "अडैप्टर चयन सहेजा गया। नए चुने गए मौजूदा सेटिंग स्टेज हो गए हैं; कोई अन्य स्रोत शामिल नहीं है।",
  "automation.sync.adapterApplied": "चुनी गई सिंक सेटिंग लोकल लागू की गई।",
  "automation.sync.adapterPublished": "मौजूदा लोकल सेटिंग एन्क्रिप्टेड सिंक के लिए स्टेज की गई।",
  "automation.sync.publish": "मौजूदा {key} प्रकाशित करें",
  "automation.sync.reviewApply": "{key} लागू करने की समीक्षा करें",
  "automation.sync.applyPreview": "सेटिंग लागू करने का पूर्वावलोकन",
  "automation.sync.applyText":
    "डिक्रिप्ट किया हुआ स्टेज्ड {key} रिविज़न {revision} मौजूदा लोकल सेटिंग पर लागू करें? यह पुष्टि के बाद ही मौजूदा मान को बदलेगा। मौजूदा और आने वाले मान छिपे हैं; संस्करणों को स्रोत और रिविज़न से पहचानें, या रद्द करें। लोकल मान या स्टेज्ड रिविज़न बदलने पर यह पूर्वावलोकन अमान्य हो जाता है।",
  "automation.sync.confirmApply": "सेटिंग लागू करने की पुष्टि करें",
  "automation.sync.cancelApply": "लागू करना रद्द करें",
  "automation.sync.relayLine":
    "रिले: {relay}। पहचान: {identity}। पहुँच में रिले ज़रूरी है; यह स्थिति साबित नहीं करती कि रिले उपलब्ध है।",
  "automation.sync.identityNone": "उपलब्ध नहीं",
  "automation.sync.identityNote":
    "यह पहचान साझा रिकवरी-की खाते को दर्शाती है, किसी अलग डिवाइस को नहीं। एक ही की और रिले टोकन वाले डिवाइस अलग-अलग रद्द नहीं किए जा सकते, और रिले रीप्ले सुरक्षा स्थापित नहीं है।",
  "automation.sync.syncNow": "अभी सिंक करें",
  "automation.sync.turnOff": "सिंक बंद करें",
  "automation.sync.turnedOff": "सिंक बंद है। कतार के रिकॉर्ड लोकल रहते हैं।",
  "automation.sync.offlineNote":
    "रिले ऑफ़लाइन होने पर मैन्युअल सिंक त्रुटि बताता है और लंबित आइटम बाद में दोबारा कोशिश के लिए कतार में रहते हैं। टकराव होने पर चुपचाप कुछ ओवरराइट नहीं होता।",
  "automation.sync.syncedPending":
    "{pending, plural, one {# आइटम} other {# आइटम}} अब भी कतार में। नीचे स्थिति और टकराव देखें।",
  "automation.sync.syncedDone": "सिंक पूरा हुआ। नीचे आइटम और टकराव देखें।",
  "automation.sync.items": "सिंक किए गए आइटम",
  "automation.sync.itemsNote": "केवल मेटाडेटा; आइटम की सामग्री और टकराने वाले मान नहीं दिखाए जाते।",
  "automation.sync.noItems": "कोई सिंक रिकॉर्ड स्टेज नहीं है।",
  "automation.sync.itemLine":
    "{id} · {dataClass} · स्वामी {owner} · स्कोप {scope} · प्रोजेक्ट {project} · रिविज़न {revision} · अपडेट {updated} · {state}",
  "automation.sync.projectNone": "कोई नहीं",
  "automation.sync.updatedUnknown": "अज्ञात",
  "automation.sync.state.deletionQueued": "हटाना कतार में",
  "automation.sync.state.deleted": "हटाया गया",
  "automation.sync.state.queued": "कतार में",
  "automation.sync.state.synced": "सिंक हो गया",
  "automation.sync.conflictMissing":
    "टकराव: यह रिकॉर्ड रिले पर नहीं है। इसे रिले पर वापस लाने के लिए “लोकल रखें” चुनें, या लोकल स्टेज्ड सिंक रिकॉर्ड हटाने के लिए रिमोट हटाना स्वीकार करें। कुछ भी अपने आप ओवरराइट नहीं होता।",
  "automation.sync.conflictRemote":
    "टकराव: रिमोट रिविज़न {revision}, अपडेट {updated}। जब तक आप कोई पक्ष नहीं चुनते, कुछ ओवरराइट नहीं होता।",
  "automation.sync.reviewKeepLocal": "{id} के लिए लोकल रखने की समीक्षा करें",
  "automation.sync.reviewKeepRemote": "{id} के लिए रिमोट रखने की समीक्षा करें",
  "automation.sync.reviewAcceptDeletion": "{id} के लिए रिमोट हटाना स्वीकारने की समीक्षा करें",
  "automation.sync.reviewDeletion": "{id} के रिमोट हटाने की समीक्षा करें",
  "automation.sync.resolutionPreview": "टकराव समाधान पूर्वावलोकन",
  "automation.sync.previewFor": "{id} ({scope}) का पूर्वावलोकन:",
  "automation.sync.previewAcceptDeletion":
    "रिमोट हटाना स्वीकारें: लोकल स्टेज्ड सिंक रिकॉर्ड अभी हटाएँ; कुछ अपलोड नहीं होता।",
  "automation.sync.previewRestore":
    "गुम रिमोट बहाल करें: अगले सफल सिंक पर अपलोड के लिए लोकल संस्करण कतार में डालें।",
  "automation.sync.previewKeepRemote":
    "रिमोट रखें: लोकल स्टेज्ड सिंक रिकॉर्ड को अभी रिमोट संस्करण से बदलें।",
  "automation.sync.previewKeepLocal":
    "लोकल रखें: अगले सफल सिंक पर अपलोड के लिए इस संस्करण को कतार में डालें। रिमोट पर नया बदलाव हो तो भी समाधान ज़रूरी रहेगा।",
  "automation.sync.previewTail":
    "आइटम की सामग्री यहाँ छिपी है; मेटाडेटा से संस्करण न पहचान सकें तो रद्द करें। इसे यहाँ से पूर्ववत नहीं किया जा सकता।",
  "automation.sync.confirmAcceptDeletion": "रिमोट हटाना स्वीकारने की पुष्टि करें",
  "automation.sync.confirmRestore": "गुम रिमोट बहाल करने की पुष्टि करें",
  "automation.sync.confirmKeepLocal": "लोकल रखने की पुष्टि करें",
  "automation.sync.confirmKeepRemote": "रिमोट रखने की पुष्टि करें",
  "automation.sync.cancelResolution": "समाधान रद्द करें",
  "automation.sync.resolvedDeletion":
    "रिमोट हटाना स्वीकार किया गया। लोकल स्टेज्ड सिंक रिकॉर्ड अब हट गया है; अपलोड के लिए कुछ कतार में नहीं है।",
  "automation.sync.resolvedChoice":
    "टकराव का चयन सहेजा गया। लंबित बदलाव ऑनलाइन रहते हुए अपने आप सिंक होते हैं; “अभी सिंक करें” तुरंत प्रयास शुरू करता है।",
  "automation.sync.deletionConfirmation": "रिमोट हटाने की पुष्टि",
  "automation.sync.deletionText":
    "रिले से {id} ({scope}) हटाएँ? इससे लोकल रूप से एक टॉम्बस्टोन कतार में जाता है; रिमोट प्रति सफल सिंक के बाद ही हटती है। इसे यहाँ से पूर्ववत नहीं किया जा सकता।",
  "automation.sync.confirmDeletion": "रिमोट हटाने की पुष्टि करें",
  "automation.sync.cancelDeletion": "हटाना रद्द करें",
  "automation.sync.deletionQueued": "हटाना कतार में है। सफल सिंक होने तक रिमोट प्रति नहीं हटती।",
  "automation.sync.relayUrl": "रिले HTTPS URL",
  "automation.sync.relayToken": "रिले प्रमाणीकरण टोकन",
  "automation.sync.restoreKey": "मौजूदा रिकवरी की (वैकल्पिक, पहचान बहाल करने के लिए)",
  "automation.sync.optInNote":
    "स्पष्ट ऑप्ट-इन: कॉन्फ़िगर करने पर रिले क्रेडेंशियल लोकल सहेजे जाते हैं और ऑनलाइन रहते हुए कतार के रिकॉर्ड का स्वचालित सिंक चालू हो जाता है। नई पहचान पर रिकवरी की एक बार दिखती है: इसे तुरंत सहेजें; बाद में यह दोबारा नहीं मिल सकती। सिंक बंद करने के बाद दोबारा कॉन्फ़िगर करने पर, उपलब्ध होने पर, लोकल सहेजी पहचान दोबारा उपयोग होती है। अपनी की रिले ऑपरेटर के साथ कभी साझा न करें।",
  "automation.sync.configure": "एन्क्रिप्टेड सिंक कॉन्फ़िगर करें",
  "automation.sync.configured":
    "सिंक कॉन्फ़िगर हो गया। कतार के रिकॉर्ड ऑनलाइन रहते हुए अपने आप सिंक होते हैं; “अभी सिंक करें” तुरंत प्रयास शुरू करता है।",
  "automation.sync.recoveryGroup": "एक बार की रिकवरी की",
  "automation.sync.recoveryText":
    "इस रिकवरी की को अभी कॉपी करके सुरक्षित जगह रखें। यह केवल एक बार दिखती है और बाद में दोबारा नहीं मिल सकती। इसे साझा न करें।",
  "automation.sync.copyKey": "रिकवरी की कॉपी करें",
  "automation.sync.savedKey": "मैंने की सहेज ली — बंद करें",
  "automation.sync.refresh": "सिंक स्थिति रीफ़्रेश करें",
};
