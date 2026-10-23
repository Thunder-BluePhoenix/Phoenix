// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { automation as enAutomation } from "../../en/automation";

/** Machine-translated; unreviewed (see ../../README.md). */
export const automation: Record<keyof typeof enAutomation, string> = {
  // ---- workflows: tables and checks (core/workflows.ts) ----
  "automation.workflows.environment.local": "লোকাল",
  "automation.workflows.environment.dev": "ডেভেলপমেন্ট",
  "automation.workflows.environment.staging": "স্টেজিং",
  "automation.workflows.environment.production": "প্রোডাকশন",
  "automation.workflows.environment.productionLive": "প্রোডাকশন (চালু সিস্টেম বদলায়)",

  "automation.workflows.runStatus.queued": "সারিতে আছে",
  "automation.workflows.runStatus.running": "চলছে",
  "automation.workflows.runStatus.waiting_approval": "আপনার অনুমোদনের অপেক্ষায়",
  "automation.workflows.runStatus.compensating": "আগের ধাপগুলো ফিরিয়ে নেওয়া হচ্ছে",
  "automation.workflows.runStatus.succeeded": "সফল হয়েছে",
  "automation.workflows.runStatus.rejected": "আপনি প্রত্যাখ্যান করেছেন",
  "automation.workflows.runStatus.failed": "ব্যর্থ হয়েছে",
  "automation.workflows.runStatus.failed_needs_attention": "ব্যর্থ: আপনার নজর দরকার",
  "automation.workflows.runStatus.cancelled": "বাতিল হয়েছে",
  "automation.workflows.runStatus.interrupted": "বাধাপ্রাপ্ত (Phoenix আবার চালু হয়েছে)",
  "automation.workflows.runStatus.refused": "প্রত্যাখ্যাত: চালানোর অনুমতি ছিল না",

  "automation.workflows.stepStatus.running": "চলছে",
  "automation.workflows.stepStatus.waiting": "অপেক্ষায়",
  "automation.workflows.stepStatus.succeeded": "সফল হয়েছে",
  "automation.workflows.stepStatus.failed": "ব্যর্থ হয়েছে",
  "automation.workflows.stepStatus.timed_out": "সময় শেষ (ফলাফল অজানা)",
  "automation.workflows.stepStatus.rejected": "প্রত্যাখ্যাত",
  "automation.workflows.stepStatus.expired": "মেয়াদ শেষ",
  "automation.workflows.stepStatus.unknown": "ফলাফল অজানা",

  "automation.workflows.authorisation.notNeeded": "অথরাইজেশন দরকার নেই",
  "automation.workflows.authorisation.authorised": "প্রোডাকশনের জন্য অথরাইজড",
  "automation.workflows.authorisation.notAuthorised": "অথরাইজড নয়: ট্রিগার প্রত্যাখ্যান করা হয়",

  "automation.workflows.expiry.invalid": "এটি কোনো তারিখ ও সময় নয়।",
  "automation.workflows.expiry.past": "মেয়াদ ভবিষ্যতে হতে হবে।",
  "automation.workflows.expiry.tooFar": "মেয়াদ সর্বোচ্চ {days} দিন পর পর্যন্ত হতে পারে।",
  "automation.workflows.refused.noReason": "কোনো কারণ দেওয়া হয়নি।",
  "automation.workflows.payload.invalidJson": "পেলোড বৈধ JSON নয়।",
  "automation.workflows.payload.notObject": "পেলোড অবশ্যই একটি JSON অবজেক্ট হতে হবে, যেমন '{}'।",
  "automation.workflows.payload.tooMany": "পেলোডে সর্বোচ্চ {max}টি কী থাকতে পারে।",

  // ---- workflows: the list ----
  "automation.workflows.title": "ওয়ার্কফ্লো",
  "automation.workflows.intro":
    "ওয়ার্কফ্লো একটি ঘটনার প্রতিক্রিয়ায় নির্দিষ্ট তালিকার ধাপ চালায়। প্রোডাকশন বদলানো ওয়ার্কফ্লো কিছুই করে না, যতক্ষণ না আপনি যাচাই করা ডেফিনিশনটিই অথরাইজ করেন।",
  "automation.workflows.empty":
    "এখনও কোনো ওয়ার্কফ্লো নেই। নিচে একটি ডেফিনিশন যাচাই করে একটি তৈরি করুন।",
  "automation.workflows.row.runsWhen": "{event} ঘটলে চলে · সংস্করণ {version}",
  "automation.workflows.row.cannotRun": "চলতে পারে না: {problems}",
  "automation.workflows.row.metrics": "{started}টি রান, {succeeded}টি সফল",

  // ---- workflows: the numbers of one workflow ----
  "automation.workflows.metrics.title": "সংখ্যা",
  "automation.workflows.metrics.label": "মেট্রিক",
  "automation.workflows.metrics.none": "এই ওয়ার্কফ্লো এখনও চলেনি, তাই কোনো সংখ্যা নেই।",
  "automation.workflows.metrics.started": "শুরু হওয়া রান",
  "automation.workflows.metrics.succeeded": "সফল",
  "automation.workflows.metrics.failed": "ব্যর্থ",
  "automation.workflows.metrics.attention": "আপনার নজর দরকার",
  "automation.workflows.metrics.cancelled": "বাতিল",
  "automation.workflows.metrics.refused": "প্রত্যাখ্যাত",
  "automation.workflows.metrics.interrupted": "বাধাপ্রাপ্ত",
  "automation.workflows.metrics.stepsFailed": "ব্যর্থ ধাপ",
  "automation.workflows.metrics.stepsFailedValue": "{count} (ধাপের {percent}%)",
  "automation.workflows.metrics.approvalsWaiting": "অপেক্ষমাণ অনুমোদন",
  "automation.workflows.metrics.approvalsOutcome":
    "অনুমোদন: অনুমোদিত / প্রত্যাখ্যাত / মেয়াদোত্তীর্ণ",
  "automation.workflows.metrics.approvalsOutcomeValue": "{approved} / {rejected} / {expired}",
  "automation.workflows.metrics.runTime": "রানের সময় (মিডিয়ান / ৯০তম পার্সেন্টাইল)",
  "automation.workflows.metrics.runTimeValue":
    "{samples, plural, one {# টি রানে} other {# টি রানে}} {median} ms / {p90} ms",
  "automation.workflows.metrics.noFinishedRuns": "কোনো শেষ হওয়া রান নেই",

  // ---- workflows: the definition editor ----
  "automation.workflows.editor.titleEdit": "ডেফিনিশন সম্পাদনা",
  "automation.workflows.editor.titleCreate": "ওয়ার্কফ্লো তৈরি করুন",
  "automation.workflows.editor.introExisting":
    'সম্পূর্ণ JSON ডেফিনিশন লিখুন। "enabled": {enabled} রাখুন; এই সম্পাদনা এর বর্তমান সুইচের অবস্থা অপরিবর্তিত রাখে। সংরক্ষণ করলে এটি অথরাইজ বা চালু হয় না। যাচাই করলে কিছু সংরক্ষিত হয় না।',
  "automation.workflows.editor.introNew":
    'সম্পূর্ণ JSON ডেফিনিশন লিখুন। নতুন ডেফিনিশনে অবশ্যই "enabled": false থাকতে হবে। সংরক্ষণ করলে এটি চলে না, চালু বা অথরাইজ হয় না। যাচাই করলে কিছু সংরক্ষিত হয় না।',
  "automation.workflows.editor.label": "ওয়ার্কফ্লো ডেফিনিশন (JSON)",
  "automation.workflows.editor.check": "খসড়া যাচাই করুন",
  "automation.workflows.editor.enterJson": "যাচাই করার আগে একটি JSON ওয়ার্কফ্লো ডেফিনিশন লিখুন।",
  "automation.workflows.editor.notObject": "ওয়ার্কফ্লো ডেফিনিশন অবশ্যই একটি JSON অবজেক্ট হতে হবে।",
  "automation.workflows.editor.keepEnabled":
    '"enabled": {enabled} রাখুন। সংরক্ষণের পর সুইচ আলাদাভাবে বদলান।',
  "automation.workflows.editor.setDisabled":
    '"enabled": false দিন। নতুন ডেফিনিশন সংরক্ষণ করলে তা চালু হওয়া চলবে না।',
  "automation.workflows.editor.keepId":
    "সম্পাদনায় একই ওয়ার্কফ্লো ID রাখতে হবে। নতুন ID-র জন্য ওয়ার্কফ্লো তৈরি করুন ব্যবহার করুন।",
  "automation.workflows.editor.notValid": "বৈধ নয়: {problems}",
  "automation.workflows.editor.noHash": "যাচাইয়ে কোনো বৈধ ডেফিনিশন হ্যাশ পাওয়া যায়নি।",
  "automation.workflows.editor.hashDiffers":
    "সংরক্ষিত ডেফিনিশনের হ্যাশ যাচাই করা হ্যাশ থেকে আলাদা। ব্যবহারের আগে সংরক্ষিত ডেফিনিশন যাচাই করুন।",
  "automation.workflows.editor.savedExisting":
    "ডেফিনিশন সংরক্ষিত হয়েছে। বিদ্যমান সুইচের অবস্থা অপরিবর্তিত; সংরক্ষণে এটি অথরাইজ হয় না।",
  "automation.workflows.editor.savedNew":
    "ডেফিনিশন বন্ধ অবস্থায় সংরক্ষিত হয়েছে। সংরক্ষণে এটি অথরাইজ বা চালু হয় না।",
  "automation.workflows.editor.reviewed": "যাচাই করা ডেফিনিশন",
  "automation.workflows.editor.validLead": "খসড়া বৈধ।",
  "automation.workflows.editor.valid":
    "{lead} সংরক্ষণের আগে এই ডেফিনিশন ও হ্যাশ ঠিক এভাবেই দেখে নিন। কিছু বদলালে আবার যাচাই করতে হবে।",
  "automation.workflows.editor.toSave": "সংরক্ষণের ডেফিনিশন",
  "automation.workflows.editor.hash": "যাচাইকৃত হ্যাশ: {hash}",
  "automation.workflows.editor.authRequired": "আলাদাভাবে অথরাইজেশন দরকার: {reasons}",
  "automation.workflows.editor.authNotRequired": "অথরাইজেশন দরকার নেই।",
  "automation.workflows.editor.switchOn": "সংরক্ষণে অথরাইজ হয় না; সুইচ চালু থাকে।",
  "automation.workflows.editor.switchOff": "সংরক্ষণে অথরাইজ হয় না; সুইচ বন্ধ থাকে।",
  "automation.workflows.editor.switchNew": "সংরক্ষণে অথরাইজ হয় না; নতুন ওয়ার্কফ্লো বন্ধ থাকে।",
  "automation.workflows.editor.confirm": "নিশ্চিত করুন: ঠিক এই ডেফিনিশনই সংরক্ষণ করুন",
  "automation.workflows.editor.reviewStored": "সংরক্ষিত ওয়ার্কফ্লো দেখুন",

  // ---- workflows: checking the stored definition ----
  "automation.workflows.validate.button": "ডেফিনিশন যাচাই করুন",
  "automation.workflows.validate.dryRun": "এটি একটি ড্রাই রান। কিছু সংরক্ষিত হয় না, কিছু চলে না।",
  "automation.workflows.validate.validLead": "বৈধ।",
  "automation.workflows.validate.valid": "{lead} হ্যাশ {hash}। {authorisation}",
  "automation.workflows.validate.needsAuth": "আপনার অথরাইজেশন দরকার: {reasons}।",
  "automation.workflows.validate.noAuth": "অথরাইজেশন দরকার নেই।",
  "automation.workflows.validate.invalidLead": "বৈধ নয়।",
  "automation.workflows.validate.invalid":
    "{lead} {count, plural, one {# টি সমস্যা:} other {# টি সমস্যা:}}",
  "automation.workflows.validate.problems": "সমস্যা",

  // ---- workflows: authorising ----
  "automation.workflows.authorise.title": "প্রোডাকশনের জন্য অথরাইজ করুন",
  "automation.workflows.authorise.notNeeded": "এই ওয়ার্কফ্লোর অথরাইজেশন দরকার নেই।",
  "automation.workflows.authorise.why": "কেন আপনার অথরাইজেশন দরকার:",
  "automation.workflows.authorise.reasons": "কারণ",
  "automation.workflows.authorise.intro":
    "এতে ওয়ার্কফ্লো {name} যখনই {event} ঘটবে তখন চলতে পারবে, এবং ওয়ার্কফ্লো নিজে না চাইলে এই ধাপগুলোর জন্য আর কোনো প্রশ্ন করা হবে না:",
  "automation.workflows.authorise.allowed": "যা চলার অনুমতি পাবে",
  "automation.workflows.authorise.noTools": "এটি কোনো টুল কল করে না।",
  "automation.workflows.authorise.step": "ধাপ {step} কল করে {tool}",
  "automation.workflows.authorise.stepUndo": "ধাপ {step} কল করে {tool} (ফিরিয়ে নেওয়া: {undo})",
  "automation.workflows.authorise.being":
    "যে ডেফিনিশন অথরাইজ হচ্ছে: সংস্করণ {version}, হ্যাশ {hash}",
  "automation.workflows.authorise.expires": "মেয়াদ শেষ {hint}",
  "automation.workflows.authorise.expiresHint": "(ঐচ্ছিক, {days} দিনের মধ্যে)",
  "automation.workflows.authorise.submit": "ঠিক এই ডেফিনিশনই অথরাইজ করুন",
  "automation.workflows.authorise.done":
    "সংস্করণ {version} অথরাইজ হয়েছে। ডেফিনিশনে পরে কোনো পরিবর্তন হলে এটি শেষ হয়ে যাবে।",

  // ---- workflows: run now ----
  "automation.workflows.runNow.title": "এখনই চালান",
  "automation.workflows.runNow.intro":
    "ইভেন্ট ঘটলে যে যাচাইগুলো হয়, সেগুলো করে হাতে ওয়ার্কফ্লো শুরু করে: চালু থাকা, জরুরি স্টপে বন্ধ না হওয়া, বৈধ হওয়া, এবং প্রোডাকশন বদলালে অথরাইজড হওয়া।",
  "automation.workflows.runNow.payload": "ইভেন্ট যে ডেটা বহন করত {hint}",
  "automation.workflows.runNow.payloadHint": "(একটি JSON অবজেক্ট, ঐচ্ছিক)",
  "automation.workflows.runNow.button": "এখনই চালান",
  "automation.workflows.runNow.cannotRun": "এটি চলতে পারে না: {problems}",
  "automation.workflows.runNow.enableFirst": "চালানোর জন্য আগে ওয়ার্কফ্লো চালু করুন।",
  "automation.workflows.runNow.refusedLead": "শুরু প্রত্যাখ্যান করা হয়েছে।",
  "automation.workflows.runNow.seeRefused": "প্রত্যাখ্যাত রান দেখুন",
  "automation.workflows.runNow.started": "শুরু হয়েছে। {link}",
  "automation.workflows.runNow.follow": "রান অনুসরণ করুন",

  // ---- workflows: one workflow ----
  "automation.workflows.detail.all": "সব ওয়ার্কফ্লো",
  "automation.workflows.detail.backAll": "← সব ওয়ার্কফ্লো",
  "automation.workflows.detail.productionLead": "প্রোডাকশন।",
  "automation.workflows.detail.production":
    "{lead} এই ওয়ার্কফ্লো চালু সিস্টেম বদলাতে পারে। আপনি এর ঠিক ডেফিনিশনটি অথরাইজ করে রাখলেই কেবল এটি চলে।",
  "automation.workflows.detail.cannotRunNow": "এখন চলতে পারছে না:",
  "automation.workflows.detail.definition": "ডেফিনিশন",
  "automation.workflows.detail.versionHash": "সংস্করণ {version} · হ্যাশ {hash}",
  "automation.workflows.detail.runsWhen": "{event} ঘটলে চলে।",
  "automation.workflows.detail.runsWhenAnd": "{event} ঘটলে এবং {condition} হলে চলে।",
  "automation.workflows.detail.tools": "যেসব টুল কল করতে পারে",
  "automation.workflows.detail.toolsLabel": "টুল",
  "automation.workflows.detail.none": "নেই।",
  "automation.workflows.detail.toolStep": "ধাপ {step}: {tool}",
  "automation.workflows.detail.flagged": "প্রোডাকশন বা গুরুতর কাজ",
  "automation.workflows.detail.declaredUndo": "ঘোষিত ফিরিয়ে নেওয়া: {undo}",
  "automation.workflows.detail.definitionText": "ডেফিনিশন (শুধু পড়ার লেখা, স্ক্রল করা যায়)",
  "automation.workflows.detail.unreadable": "সংরক্ষিত ডেফিনিশন পড়া যায়নি।",
  "automation.workflows.detail.switch": "সুইচ",
  "automation.workflows.detail.enable": "চালু করুন",
  "automation.workflows.detail.disable": "বন্ধ করুন",
  "automation.workflows.detail.switchNote":
    "চালু করলে অথরাইজ হয় না। অথরাইজ না করা চালু প্রোডাকশন ওয়ার্কফ্লো প্রতিটি ট্রিগারকে প্রত্যাখ্যাত হিসেবে নথিভুক্ত করে।",
  "automation.workflows.detail.authorisations": "অথরাইজেশন",
  "automation.workflows.detail.noneYet": "এখনও নেই।",
  "automation.workflows.detail.inForce": "কার্যকর",
  "automation.workflows.detail.revoked": "প্রত্যাহৃত",
  "automation.workflows.detail.notInForce": "কার্যকর নয়",
  "automation.workflows.detail.authorisedBy": "{by} দ্বারা {date} তারিখে",
  "automation.workflows.detail.authExpires": "মেয়াদ শেষ {date}",
  "automation.workflows.detail.authChanged": "ডেফিনিশন বদলেছে বা মেয়াদ শেষ হয়েছে",
  "automation.workflows.detail.forHash": "হ্যাশ {hash}-এর জন্য",
  "automation.workflows.detail.confirmRevoke": "নিশ্চিত করুন: অথরাইজেশন প্রত্যাহার",
  "automation.workflows.detail.revoke": "অথরাইজেশন প্রত্যাহার করুন…",
  "automation.workflows.detail.revokeNote": "চলমান রান পরের ধাপে থেমে যায়।",
  "automation.workflows.detail.recentRuns": "সাম্প্রতিক রান",
  "automation.workflows.detail.noRuns": "এখনও কোনো রান নেই।",

  // ---- workflows: runs and steps ----
  "automation.workflows.run.needsLook": "(দেখা দরকার)",
  "automation.workflows.run.notSuccess": "(সফল নয়)",
  "automation.workflows.run.nowAtStep": "এখন ধাপ {step}-এ",
  "automation.workflows.run.atStep": "ধাপ {step}-এ",
  "automation.workflows.run.backToWorkflow": "ওয়ার্কফ্লোতে ফিরুন",
  "automation.workflows.run.title": "{name}-এর রান",
  "automation.workflows.run.created": "তৈরি হয়েছে {date}",
  "automation.workflows.run.finished": "শেষ হয়েছে {date}",
  "automation.workflows.run.chainDepth": "শৃঙ্খলের গভীরতা {depth}",
  "automation.workflows.run.waitingForYou": "আপনার অপেক্ষায়",
  "automation.workflows.run.stop": "এই রান থামান",
  "automation.workflows.run.confirmCancel": "নিশ্চিত করুন: এই রান বাতিল",
  "automation.workflows.run.keepRunning": "চলতে দিন",
  "automation.workflows.run.cancel": "এই রান বাতিল করুন…",
  "automation.workflows.run.cancelNote":
    "বাতিল করলে ঘোষিত ফিরিয়ে নেওয়ার ধাপগুলো চলে না। চলমান কোনো ধাপ তবুও শেষ হয়ে যেতে পারে।",
  "automation.workflows.run.trigger": "যা এটি শুরু করেছে",
  "automation.workflows.run.triggerText": "ট্রিগার (সাধারণ লেখা, স্ক্রল করা যায়)",
  "automation.workflows.run.stepsHeading": "ধাপ ({count})",
  "automation.workflows.run.stepsLabel": "ধাপ",
  "automation.workflows.run.noSteps": "কোনো ধাপ শুরু হয়নি।",
  "automation.workflows.step.undo": "ফিরিয়ে নেওয়া: {step}",
  "automation.workflows.step.attempts": "{count, plural, one {# বার চেষ্টা} other {# বার চেষ্টা}}",
  "automation.workflows.step.changesState": "অবস্থা বদলায়",
  "automation.workflows.step.destructive": "{lead}: এই ধাপ একটি আসল সিস্টেম বদলাতে পারে।",
  "automation.workflows.step.tool": "টুল {tool}",
  "automation.workflows.step.input": "ধাপ {step}-এর ইনপুট (সাধারণ লেখা, স্ক্রল করা যায়)",
  "automation.workflows.step.output": "ধাপ {step}-এর আউটপুট (সাধারণ লেখা, স্ক্রল করা যায়)",

  // ---- plans: tables and checks (core/plans.ts) ----
  "automation.plans.status.draft": "খসড়া: এখনও প্রস্তাব করা হয়নি",
  "automation.plans.status.proposed": "প্রস্তাবিত: আপনার অনুমোদনের অপেক্ষায়",
  "automation.plans.status.approved": "অনুমোদিত: তৈরির জন্য প্রস্তুত",
  "automation.plans.status.creating": "টাস্ক তৈরি হচ্ছে…",
  "automation.plans.status.created": "তৈরি হয়েছে",
  "automation.plans.status.failed": "ব্যর্থ: কিছু টাস্ক তৈরি হয়নি",
  "automation.plans.status.cancelled": "বাতিল হয়েছে",
  "automation.plans.basis.meeting": "মিটিং থেকে",
  "automation.plans.basis.suggested": "মডেলের প্রস্তাব",
  "automation.plans.basis.user": "আপনার লেখা",
  "automation.plans.run.pending": "শুরু হয়নি",
  "automation.plans.run.attempting": "চলছে",
  "automation.plans.run.created": "তৈরি হয়েছে",
  "automation.plans.run.failed": "ব্যর্থ",
  "automation.plans.tool.githubIssue": "GitHub ইস্যু তৈরি করুন",
  "automation.plans.tool.frappeTask": "Frappe টাস্ক তৈরি করুন",
  "automation.plans.kind.decision": "সিদ্ধান্ত",
  "automation.plans.kind.action_item": "অ্যাকশন আইটেম",
  "automation.plans.kind.requirement": "প্রয়োজনীয়তা",
  "automation.plans.authorship.rules":
    "নিয়মভিত্তিক খসড়া: এটি কোনো AI লেখেনি, শুধু মিটিংয়ের আইটেমটিই আবার বলা হয়েছে।",
  "automation.plans.authorship.model":
    "মডেলের আউটপুট ({model}): অনুমোদনের আগে মিটিংয়ের সঙ্গে মিলিয়ে দেখুন।",
  "automation.plans.destination.github": "GitHub রিপোজিটরি {repository}",
  "automation.plans.destination.frappe": "Frappe সাইট {site}",
  "automation.plans.problem.repository": 'রিপোজিটরি দেখতে "owner/name"-এর মতো হতে হবে।',
  "automation.plans.problem.site": "এটি বৈধ Frappe সাইটের নাম নয়।",
  "automation.plans.problem.titleEmpty": "শিরোনাম খালি রাখা যাবে না।",
  "automation.plans.problem.titleLong": "শিরোনাম {max}-এর চেয়ে বড়।",
  "automation.plans.problem.summaryEmpty": "সারাংশ খালি রাখা যাবে না।",
  "automation.plans.problem.summaryLong": "সারাংশ {max}-এর চেয়ে বড়।",
  "automation.plans.problem.taskCount": "পরিকল্পনায় ১ থেকে {max}টি টাস্ক লাগে।",
  "automation.plans.problem.taskTitle": "টাস্ক {n}-এর শিরোনাম দরকার।",
  "automation.plans.problem.bodyLong": "বিবরণ {max}-এর চেয়ে বড়।",
  "automation.plans.problem.labelCount": "সর্বোচ্চ {max}টি লেবেল।",
  "automation.plans.problem.labelLong": "একটি লেবেল {max}-এর চেয়ে বড়।",

  // ---- plans: make a plan from a meeting item ----
  "automation.plans.off": "পরিকল্পনা বন্ধ আছে।",
  "automation.plans.make.open": "পরিকল্পনা তৈরি করুন…",
  "automation.plans.make.openFrom": "{kind} থেকে পরিকল্পনা তৈরি করুন: {text}",
  "automation.plans.make.intro":
    "পরিকল্পনা হলো ইঞ্জিনিয়ারিং টাস্কের একটি খসড়া। আপনি অনুমোদন দিয়ে প্রতিটি টাস্ক নিশ্চিত না করা পর্যন্ত কিছু তৈরি হয় না।",
  "automation.plans.make.where": "টাস্কগুলো কোথায় যাবে?",
  "automation.plans.make.githubIssues": "GitHub ইস্যু",
  "automation.plans.make.frappeTasks": "Frappe টাস্ক",
  "automation.plans.make.repository": "রিপোজিটরি (owner/name)",
  "automation.plans.make.site": "Frappe সাইট",
  "automation.plans.make.chooseSite": "একটি সাইট বেছে নিন",
  "automation.plans.make.drafting": "পরিকল্পনার খসড়া তৈরি হচ্ছে…",
  "automation.plans.make.draft": "পরিকল্পনার খসড়া করুন",
  "automation.plans.make.localModel":
    "লোকাল মডেলের এক মিনিট লাগতে পারে। অন্য কোথাও কিছু পাঠানো হয় না।",
  "automation.plans.make.drafted": "পরিকল্পনার খসড়া তৈরি হয়েছে।",
  "automation.plans.make.openPlan": "পরিকল্পনা খুলুন",

  // ---- plans: on a meeting ----
  "automation.plans.meeting.title": "এই মিটিংয়ের পরিকল্পনা ও টাস্ক",
  "automation.plans.meeting.plans": "পরিকল্পনা",
  "automation.plans.meeting.summary":
    "{status} · {count, plural, one {# টি টাস্ক} other {# টি টাস্ক}} · {system}",
  "automation.plans.meeting.tasksCreated": "তৈরি হওয়া টাস্ক",
  "automation.plans.meeting.tasksLabel": "এই মিটিং থেকে তৈরি হওয়া টাস্ক",
  "automation.plans.link.frappeTask": "টাস্ক {id}",
  "automation.plans.link.detail": "{plan}-এর টাস্ক {index} · অনুমোদিত {date}",
  "automation.plans.link.itsPlan": "এর পরিকল্পনা",

  // ---- plans: the editor ----
  "automation.plans.editor.label": "পরিকল্পনা সম্পাদনা করুন",
  "automation.plans.editor.title": "শিরোনাম {hint}",
  "automation.plans.editor.summary": "সারাংশ {hint}",
  "automation.plans.editor.upTo": "(সর্বোচ্চ {max})",
  "automation.plans.editor.tasks": "টাস্ক {hint}",
  "automation.plans.editor.tasksRange": "(১ থেকে {max})",
  "automation.plans.editor.task": "টাস্ক {n}",
  "automation.plans.editor.taskTitle": "টাস্ক {n}-এর শিরোনাম",
  "automation.plans.editor.taskBody": "টাস্ক {n}-এর বিবরণ {hint}",
  "automation.plans.editor.taskLabels": "টাস্ক {n}-এর লেবেল {hint}",
  "automation.plans.editor.labelsHint": "(কমা দিয়ে আলাদা, সর্বোচ্চ {max})",
  "automation.plans.editor.removeTask": "টাস্ক {n} সরান",
  "automation.plans.editor.addTask": "টাস্ক যোগ করুন",
  "automation.plans.editor.note":
    "সংরক্ষণ করলে পরিকল্পনা খসড়ায় ফিরে যায় এবং আগের অনুমোদন মুছে যায়। তখন আবার প্রস্তাব করে অনুমোদন দিতে হবে।",
  "automation.plans.editor.save": "পরিবর্তন সংরক্ষণ করুন",

  // ---- plans: preview and results ----
  "automation.plans.preview.title": "ঠিক যা পাঠানো হবে",
  "automation.plans.preview.intro":
    "প্রতিটি টাস্ক আপনার পরিচয়ে করা একটি কল। এটি আসল ইনপুট, সাধারণ লেখা হিসেবে দেখানো হয়েছে।",
  "automation.plans.preview.calls": "যেসব কল করা হবে",
  "automation.plans.preview.task": "টাস্ক {n}: {tool}",
  "automation.plans.preview.decision": "(প্রভাব: {effect}, ঝুঁকি: {risk})",
  "automation.plans.preview.input": "টাস্ক {n}-এর ইনপুট (সাধারণ লেখা, স্ক্রল করা যায়)",
  "automation.plans.runs.title": "টাস্ক ধরে ধরে",
  "automation.plans.runs.label": "টাস্কের ফলাফল",
  "automation.plans.runs.task": "টাস্ক {n}:",
  "automation.plans.runs.attempts": "{count, plural, one {# বার চেষ্টা} other {# বার চেষ্টা}}",
  "automation.plans.runs.frappeTask": "Frappe টাস্ক {id}",
  "automation.plans.runs.stopped":
    "টাস্ক {n}-এ থেমে গেছে: {message}। এর পরে কিছু তৈরি হয়নি। আপনি আবার তৈরি করুন চালাতে পারেন: যে টাস্ক আছে সেগুলো খুঁজে নেওয়া হবে, দ্বিতীয়বার তৈরি হবে না।",

  // ---- plans: one plan ----
  "automation.plans.page.allMeetings": "সব মিটিং",
  "automation.plans.page.meeting": "← মিটিং",
  "automation.plans.page.rules": "নিয়মভিত্তিক খসড়া",
  "automation.plans.page.model": "মডেলের আউটপুট",
  "automation.plans.page.destination": "গন্তব্য: {destination}",
  "automation.plans.page.from": "{kind} থেকে: {text}",
  "automation.plans.page.owner": "মালিক {owner}",
  "automation.plans.page.due": "শেষ তারিখ {due}",
  "automation.plans.page.proposedNotice": "প্রস্তাব করা হয়েছে। প্রিভিউ দেখে অনুমোদন দিন।",
  "automation.plans.page.approvedNotice": "অনুমোদিত। এখনও কিছু তৈরি হয়নি।",
  "automation.plans.page.savedNotice":
    "সংরক্ষিত। পরিকল্পনা আবার খসড়া হয়েছে; অনুমোদনের জন্য আবার প্রস্তাব করুন।",
  "automation.plans.page.cancelledNotice": "বাতিল হয়েছে। কিছু তৈরি হয়নি।",
  "automation.plans.page.plan": "পরিকল্পনা",
  "automation.plans.page.tasks": "টাস্ক ({count})",
  "automation.plans.page.tasksLabel": "টাস্ক",
  "automation.plans.page.labels": "লেবেল:",
  "automation.plans.page.edit": "পরিকল্পনা সম্পাদনা করুন",
  "automation.plans.page.acceptance": "গ্রহণযোগ্যতার মানদণ্ড",
  "automation.plans.page.risks": "ঝুঁকি",
  "automation.plans.page.questions": "খোলা প্রশ্ন",
  "automation.plans.frappe.doctype": "প্রস্তাবিত Frappe DocType: {doctype}",
  "automation.plans.frappe.note":
    "শুধু একটি প্রস্তাবিত নকশা। টাস্ক তৈরি করলে এই DocType, এর ফিল্ড, ওয়ার্কফ্লো বা পারমিশন তৈরি হয় না।",
  "automation.plans.frappe.fields": "ফিল্ড",
  "automation.plans.frappe.fieldsLabel": "প্রস্তাবিত Frappe ফিল্ড",
  "automation.plans.frappe.required": "আবশ্যক",
  "automation.plans.frappe.noFields": "কোনো ফিল্ড প্রস্তাব করা হয়নি।",
  "automation.plans.frappe.states": "ওয়ার্কফ্লোর অবস্থা",
  "automation.plans.frappe.statesLabel": "প্রস্তাবিত Frappe ওয়ার্কফ্লোর অবস্থা",
  "automation.plans.frappe.noStates": "কোনো ওয়ার্কফ্লো অবস্থা প্রস্তাব করা হয়নি।",
  "automation.plans.frappe.permissions": "পারমিশন",
  "automation.plans.frappe.permissionsLabel": "প্রস্তাবিত Frappe পারমিশন",
  "automation.plans.frappe.noPermissions": "কোনো পারমিশন প্রস্তাব করা হয়নি।",
  "automation.plans.frappe.access": "{role}: {access}",
  "automation.plans.frappe.read": "পড়া",
  "automation.plans.frappe.write": "লেখা",
  "automation.plans.frappe.create": "তৈরি",
  "automation.plans.frappe.noAccess": "অ্যাক্সেস নেই",
  "automation.plans.decide.title": "সিদ্ধান্ত নিন",
  "automation.plans.decide.fingerprint":
    "আপনি যা দেখছেন তার ফিঙ্গারপ্রিন্ট: {hash}। অনুমোদন ঠিক এই বিষয়বস্তুর জন্যই; পরিকল্পনা বদলালে তা প্রত্যাখ্যান করা হয়।",
  "automation.plans.decide.propose": "এই পরিকল্পনা প্রস্তাব করুন",
  "automation.plans.decide.nameMeeting": "তৈরি টাস্কে মিটিংয়ের নাম উল্লেখ করুন",
  "automation.plans.decide.approve": "ঠিক এই পরিকল্পনা অনুমোদন করুন",
  "automation.plans.decide.approved": "{by} {date} তারিখে অনুমোদন করেছেন।",
  "automation.plans.decide.approvedNamed":
    "{by} {date} তারিখে অনুমোদন করেছেন · টাস্কে মিটিংয়ের নাম উল্লেখ আছে।",
  "automation.plans.decide.understand":
    "আমি বুঝেছি যে এটি আমার পরিচয়ে {destination}-এ {count, plural, one {# টি টাস্ক} other {# টি টাস্ক}} তৈরি করবে।",
  "automation.plans.decide.createRemaining": "বাকি টাস্ক তৈরি করুন",
  "automation.plans.decide.create": "টাস্ক তৈরি করুন",
  "automation.plans.decide.waiting":
    "{total}টির মধ্যে টাস্ক {n}-এর জন্য আপনার অনুমোদনের অপেক্ষায়।",
  "automation.plans.decide.waitingNote":
    "প্রতিটি টাস্ক তৈরির আগে Core আপনাকে জিজ্ঞেস করে। নিচে উত্তর দিন; যত সময়ই লাগুক এই পেজ অপেক্ষা করবে।",
  "automation.plans.decide.cancel": "এই পরিকল্পনা বাতিল করুন",

  // ---- automation settings (AutomationSettings.tsx) ----
  "automation.settings.title": "অটোমেশন",
  "automation.settings.intro":
    "আপনি চালু না করা পর্যন্ত অটোমেশন বন্ধ থাকে। বন্ধ থাকলে Fawkes কোনো টাস্ক শুরু করে না এবং নিজে থেকে কিছুই চালায় না। চালু থাকলেও Fawkes শুধু আপনি চাইলেই টাস্ক শুরু করতে পারে, যেমন চ্যাট ট্যাবে “CI ব্যর্থতা নির্ণয় করুন”। এটি ডেটা পড়ে ও প্রস্তাব দেয়; যা কিছু বদলায় তা আপনার অনুমোদনের অপেক্ষায় থাকে, এবং আপনি যেকোনো সময় টাস্ক বাতিল করতে পারেন। অটোমেশন বন্ধ করলে চলমান সব টাস্ক বাতিল হয়।",
  "automation.settings.allow": "আমার শুরু করা টাস্ক Fawkes-কে চালাতে দিন",
  "automation.settings.statusOn":
    "অটোমেশন চালু আছে। {active, plural, one {# টি টাস্ক} other {# টি টাস্ক}} চলছে (একসঙ্গে সর্বোচ্চ {max}টি)।",
  "automation.settings.statusOff":
    "অটোমেশন বন্ধ আছে। {active, plural, one {# টি টাস্ক} other {# টি টাস্ক}} চলছে (একসঙ্গে সর্বোচ্চ {max}টি)।",
  "automation.settings.unavailable": "Phoenix Core থেকে অটোমেশন সেটিংস পাওয়া যাচ্ছে না ({error})।",

  // ---- proactive suggestions (ProactiveSettings.tsx) ----
  "automation.proactive.title": "সক্রিয় পরামর্শ",
  "automation.proactive.intro":
    "ডিফল্টে বন্ধ। Kage উপলব্ধ থাকলে গৃহীত, বরাদ্দহীন মিটিং আইটেম সাজেস্ট করতে পারে। ইঞ্জিনিয়ারিং সংকেত কেবল আপনার স্পষ্টভাবে যোগ করা নজরদারিকৃত রিপোজিটরি রুট স্ক্যান করতে পারে; পরামর্শ প্রদানকারী অনুপলব্ধ, তাই এটি কখনও পরামর্শ জানায় না। অপ্ট-ইনের পর আপনি স্পষ্টভাবে কোনো ব্যবধান না বাছলে মূল্যায়ন ম্যানুয়াল থাকে। নির্ধারিত কাজ স্থানীয়ভাবে চলে এবং নীরব সময়, রেট সীমা ও জরুরি বন্ধ মেনে চলে।",
  "automation.proactive.status": "Kage উৎস: {source}। পরামর্শ {state} ({cadence})।",
  "automation.proactive.sourceAvailable": "উপলব্ধ",
  "automation.proactive.sourceUnavailable": "অনুপলব্ধ",
  "automation.proactive.stateOn": "চালু",
  "automation.proactive.stateOff": "বন্ধ",
  "automation.proactive.cadenceEvery": "প্রতি {minutes, plural, one {# মিনিটে} other {# মিনিটে}}",
  "automation.proactive.cadenceManual": "শুধু ম্যানুয়াল",
  "automation.proactive.optIn": "অপ্ট-ইন",
  "automation.proactive.enable": "সক্রিয় পরামর্শ চালু করুন",
  "automation.proactive.kageItems": "Kage-এর গৃহীত, বরাদ্দহীন অ্যাকশন আইটেম",
  "automation.proactive.engineeringSignals": "নজরদারিকৃত রিপোজিটরি থেকে ইঞ্জিনিয়ারিং সংকেত",
  "automation.proactive.engineeringSignalsStatus": "ইঞ্জিনিয়ারিং সংকেত {state}।",
  "automation.proactive.cadence": "স্বয়ংক্রিয় মূল্যায়নের ব্যবধান",
  "automation.proactive.cadenceOff": "শুধু ম্যানুয়াল (বন্ধ)",
  "automation.proactive.cadence15": "প্রতি ১৫ মিনিটে",
  "automation.proactive.cadence30": "প্রতি ৩০ মিনিটে",
  "automation.proactive.cadence60": "প্রতি ঘণ্টায়",
  "automation.proactive.cadence1440": "প্রতিদিন",
  "automation.proactive.quietHours": "নীরব সময়",
  "automation.proactive.useQuiet": "নীরব সময় ব্যবহার করুন",
  "automation.proactive.timezone": "টাইম জোন (IANA)",
  "automation.proactive.quietFrom": "নীরব শুরু",
  "automation.proactive.quietUntil": "নীরব শেষ",
  "automation.proactive.maxPerHour": "প্রতি ঘণ্টায় সর্বোচ্চ পরামর্শ",
  "automation.proactive.preview": "পরামর্শের প্রিভিউ",
  "automation.proactive.evaluate": "এখনই মূল্যায়ন করুন",
  "automation.proactive.refreshNoise": "নয়েজ মেট্রিক রিফ্রেশ করুন",
  "automation.proactive.delivered": "পৌঁছে দেওয়া পরামর্শ",
  "automation.proactive.dismiss": "{title} বাতিল করুন",
  "automation.proactive.previewHeading": "ভিত্তিসহ প্রিভিউ",
  "automation.proactive.previewLabel": "পরামর্শের প্রিভিউ",
  "automation.proactive.previewEmpty": "যোগ্য গৃহীত, বরাদ্দহীন কোনো Kage অ্যাকশন আইটেম নেই।",
  "automation.proactive.evidence": "প্রমাণ: মিটিং {meeting}, আইটেম {item} ({source}): “{quote}”",
  "automation.proactive.sourceTranscript": "ট্রান্সক্রিপ্ট",
  "automation.proactive.sourceSummary": "সারাংশ",
  "automation.proactive.noiseLabel": "পরামর্শের নয়েজ মেট্রিক",
  "automation.proactive.noiseDelivered": "পৌঁছে দেওয়া",
  "automation.proactive.noiseDismissed": "বাতিল করা",
  "automation.proactive.noiseSuppressed": "দমন করা",
  "automation.proactive.noiseRate": "বাতিলের হার",
  "automation.proactive.saved": "পরামর্শের পছন্দ সংরক্ষিত হয়েছে।",
  "automation.proactive.previewCount":
    "{count, plural, one {প্রিভিউতে # টি ভিত্তিসহ পরামর্শ আছে।} other {প্রিভিউতে # টি ভিত্তিসহ পরামর্শ আছে।}}",
  "automation.proactive.evaluated": "{delivered}টি পৌঁছেছে; {suppressed}টি দমন করা হয়েছে।",
  "automation.proactive.dismissed": "পরামর্শ বাতিল করা হয়েছে।",

  // ---- capability registry (RegistrySettings.tsx) ----
  "automation.registry.title": "ক্যাপাবিলিটি রেজিস্ট্রি",
  "automation.registry.intro":
    "লোকালি কনফিগার করা, হোস্টের বিশ্বস্ত স্বাক্ষরিত ইনডেক্স থেকে মেটাডেটা দেখুন। এন্ট্রি ফেরত দেওয়ার আগে Phoenix Core ইনডেক্সের স্বাক্ষর যাচাই করে। ব্রাউজ করলে তৃতীয় পক্ষের কোড ইনস্টল বা চালানো হয় না।",
  "automation.registry.noInstall":
    "ইনস্টল অনুপলব্ধ: অডিট করা OS স্যান্ডবক্স নেই। এখানে তৃতীয় পক্ষের ক্যাপাবিলিটি ইনস্টল করা যায় না।",
  "automation.registry.unavailable": "রেজিস্ট্রি অনুপলব্ধ",
  "automation.registry.loadFailed": "রেজিস্ট্রি লোড করা যায়নি: {error}",
  "automation.registry.loading": "রেজিস্ট্রি লোড হচ্ছে…",
  "automation.registry.notConfigured":
    "কোনো লোকাল রেজিস্ট্রি কনফিগার করা নেই। ক্যাপাবিলিটি দেখতে হোস্ট অ্যাডমিনিস্ট্রেটরকে একটি বিশ্বস্ত কী ও স্বাক্ষরিত ইনডেক্স কনফিগার করতে বলুন।",
  "automation.registry.indexSignature":
    "ইনডেক্সের স্বাক্ষর: হোস্টের বিশ্বস্ত Ed25519 স্বাক্ষরকারী {signer} দিয়ে যাচাই হয়েছে।",
  "automation.registry.signature": "স্বাক্ষর: {signature}",
  "automation.registry.indexHash": "স্বাক্ষরিত ইনডেক্সের SHA-256: {hash}",
  "automation.registry.empty": "স্বাক্ষরিত রেজিস্ট্রিতে কোনো ক্যাপাবিলিটি নেই।",
  "automation.registry.preview": "{name} {version}-এর প্রিভিউ",
  "automation.registry.previewFailed": "প্রিভিউ অনুপলব্ধ: {error}",
  "automation.registry.previewLoading": "যাচাইকৃত প্রিভিউ লোড হচ্ছে…",
  "automation.registry.permissions": "পারমিশন",
  "automation.registry.noDescription": "কোনো বিবরণ দেওয়া হয়নি",
  "automation.registry.noneDeclared": "কিছু ঘোষণা করা হয়নি।",
  "automation.registry.dataCategories": "ডেটার ধরন",
  "automation.registry.licence": "লাইসেন্স",
  "automation.registry.licenceLine": "{licence}। {policy}",
  "automation.registry.security": "নিরাপত্তা",
  "automation.registry.securityContact": "নিরাপত্তা যোগাযোগ",
  "automation.registry.advisories": "অ্যাডভাইজরি",
  "automation.registry.provenance": "স্বাক্ষরিত উৎস-প্রমাণ",
  "automation.registry.artifact":
    "স্বাক্ষরিত ইনডেক্সে ঘোষিত আর্টিফ্যাক্টের SHA-256: {hash} ({bytes, plural, one {# বাইট} other {# বাইট}})। আর্টিফ্যাক্ট যাচাই: যাচাই করা হয়নি; আর্টিফ্যাক্টের বাইট আনা বা পরীক্ষা করা হয়নি। ব্রাউজ করলে আর্টিফ্যাক্ট চালানো হয় না।",
  "automation.registry.sandbox":
    "স্যান্ডবক্স: অনুপলব্ধ। ইনস্টল বন্ধ আছে; কোনো ইনস্টল অনুরোধ পাঠানো হবে না।",

  "automation.registry.skinPack": "শুধু-ডেটা স্কিন প্যাক",
  "automation.registry.skinDataOnly":
    "শুধু-ডেটা Phoenix পোশাক প্যাক। এটি কোড চালাতে বা অনুমতি চাইতে পারে না।",
  "automation.registry.installSkin": "স্কিন ইনস্টল করুন {name} {version}",
  "automation.registry.installPending":
    "এই স্বাক্ষরিত স্কিন ইনস্টলের আগে Core নিশ্চিতকরণের অপেক্ষায়।",
  "automation.registry.installSucceeded": "স্বাক্ষরিত স্কিন Wardrobe-এ ইনস্টল হয়েছে।",
  "automation.registry.installFailed": "স্কিন ইনস্টল ব্যর্থ: {error}",
  // ---- encrypted sync (SyncSettings.tsx) ----
  "automation.sync.title": "এনক্রিপ্টেড সিঙ্ক",
  "automation.sync.intro":
    "ঐচ্ছিক এবং ডিফল্টে বন্ধ। সিঙ্কের জন্য আপনার নিজের উপলব্ধ HTTPS রিলে ও রিলে অথেনটিকেশন লাগে; Phoenix কোনো হোস্টেড রিলে দেয় না। কনফিগার করা স্পষ্ট অপ্ট-ইন: সেটআপের সময় কিছু পাঠানো হয় না, কিন্তু পরে অনলাইন থাকলে সারিবদ্ধ রেকর্ড স্বয়ংক্রিয়ভাবে সিঙ্ক হয়। এখনই সিঙ্ক করুন চাপলে সঙ্গে সঙ্গে চেষ্টা শুরু হয়। অ্যাডাপ্টার শুধু স্পষ্টভাবে বাছা দুটি বিষয়বস্তু-বহির্ভূত সেটিং স্টেজ করে; পরে লোকালে বদলালে বর্তমানটি প্রকাশ করুন চাপতে হবে। এই অ্যাডাপ্টার কখনও মিটিং, ব্যক্তি বা মেমরির লেখা অন্তর্ভুক্ত করে না।",
  "automation.sync.unavailable":
    "Phoenix Core থেকে সিঙ্ক সেটিংস পাওয়া যাচ্ছে না। এই স্ট্যাটাস অনুরোধ রিলের সঙ্গে যোগাযোগ করেনি।",
  "automation.sync.relayNone": "কনফিগার করা নেই",
  "automation.sync.relayUnknown": "কনফিগার করা রিলে (URL অনুপলব্ধ)",
  "automation.sync.statusOn":
    "সিঙ্ক চালু আছে। {pending}টি সারিতে; {conflicts, plural, one {# টি দ্বন্দ্ব} other {# টি দ্বন্দ্ব}}।",
  "automation.sync.statusOff":
    "সিঙ্ক বন্ধ আছে। {pending}টি সারিতে; {conflicts, plural, one {# টি দ্বন্দ্ব} other {# টি দ্বন্দ্ব}}।",
  "automation.sync.chooseExclusions":
    "অপ্ট-ইনের আগে বাদ দেওয়ার বিষয় বাছুন; বাদ দেওয়া ক্লাস ও প্রজেক্ট আপলোড হয় না।",
  "automation.sync.excludeClasses": "ডেটা ক্লাস বাদ দিন",
  "automation.sync.class.preference": "পছন্দ",
  "automation.sync.class.context": "প্রসঙ্গ",
  "automation.sync.class.project_profile": "প্রজেক্ট প্রোফাইল",
  "automation.sync.excludeProject": "নাম দিয়ে প্রজেক্ট বাদ দিন",
  "automation.sync.excludeProjectButton": "প্রজেক্ট বাদ দিন",
  "automation.sync.removeExclusion": "{name}-এর বাদ দেওয়া সরান",
  "automation.sync.exclusionsSaved": "বাদ দেওয়ার তালিকা সংরক্ষিত হয়েছে।",
  "automation.sync.adapterLegend": "বিদ্যমান সেটিং আলাদাভাবে অপ্ট-ইন করুন",
  "automation.sync.adapterNote":
    "শুধু অ্যাকাউন্ট-মালিকের পরিসরের রিডিউসড মোশন (পছন্দ) ও সার্চ ফলাফলের সংখ্যা (প্রসঙ্গ কনফিগারেশন) যোগ্য; প্রজেক্ট-পরিসরের কোনো উৎস নেই। বাছলে বর্তমান মান স্টেজ হয়। পরে লোকালে বদলালে তা স্পষ্টভাবে প্রকাশ করুন। আগত মান স্টেজ অবস্থায় থাকে, যতক্ষণ না আপনি দেখে লোকালে প্রয়োগ নিশ্চিত করেন। কোনো ক্লাস বাদ দিলে অনুমতি থাকলে তার অ্যাডাপ্টার নির্বাচনও সরে যায়; ইতিমধ্যে প্রকাশিত রেকর্ড আগে মুছে সিঙ্ক করতে হবে। বাছাই তুলে নিলে আপলোড করা সাইফারটেক্সট মোছে না; দরকার হলে সিঙ্ক হওয়া আইটেমটি আলাদাভাবে মুছুন।",
  "automation.sync.adapter.reducedMotion": "রিডিউসড মোশন পছন্দ",
  "automation.sync.adapter.searchCount": "সার্চ ফলাফলের সংখ্যার মেটাডেটা",
  "automation.sync.adapterSaved":
    "অ্যাডাপ্টার নির্বাচন সংরক্ষিত হয়েছে। নতুন বাছা বর্তমান সেটিং স্টেজ হয়েছে; অন্য কোনো উৎস অন্তর্ভুক্ত নয়।",
  "automation.sync.adapterApplied": "বাছা সিঙ্কড সেটিং লোকালে প্রয়োগ হয়েছে।",
  "automation.sync.adapterPublished": "বর্তমান লোকাল সেটিং এনক্রিপ্টেড সিঙ্কের জন্য স্টেজ হয়েছে।",
  "automation.sync.publish": "বর্তমান {key} প্রকাশ করুন",
  "automation.sync.reviewApply": "{key} প্রয়োগ দেখুন",
  "automation.sync.applyPreview": "সেটিং প্রয়োগের প্রিভিউ",
  "automation.sync.applyText":
    "ডিক্রিপ্ট করা স্টেজড {key} রিভিশন {revision} বিদ্যমান লোকাল সেটিংয়ে প্রয়োগ করবেন? নিশ্চিত করার পরেই এটি বর্তমান মান বদলাবে। বর্তমান ও আগত মান লুকানো আছে; উৎস ও রিভিশন দেখে সংস্করণ চিনুন, অথবা বাতিল করুন। লোকাল মান বা স্টেজড রিভিশন বদলে গেলে এই প্রিভিউ অকার্যকর হয়।",
  "automation.sync.confirmApply": "সেটিং প্রয়োগ নিশ্চিত করুন",
  "automation.sync.cancelApply": "প্রয়োগ বাতিল করুন",
  "automation.sync.relayLine":
    "রিলে: {relay}। পরিচয়: {identity}। একটি পৌঁছানো যায় এমন রিলে দরকার; এই স্ট্যাটাস প্রমাণ করে না যে রিলে উপলব্ধ।",
  "automation.sync.identityNone": "উপলব্ধ নয়",
  "automation.sync.identityNote":
    "এই পরিচয় ভাগ করা রিকভারি-কী অ্যাকাউন্টকে বোঝায়, আলাদা কোনো ডিভাইসকে নয়। একই কী ও রিলে টোকেনের ডিভাইসগুলো আলাদাভাবে প্রত্যাহার করা যায় না, এবং রিলের রিপ্লে সুরক্ষা নেই।",
  "automation.sync.syncNow": "এখনই সিঙ্ক করুন",
  "automation.sync.turnOff": "সিঙ্ক বন্ধ করুন",
  "automation.sync.turnedOff": "সিঙ্ক বন্ধ আছে। সারিবদ্ধ রেকর্ড লোকালে থাকে।",
  "automation.sync.offlineNote":
    "রিলে অফলাইন থাকলে ম্যানুয়াল সিঙ্ক ত্রুটি জানায় এবং অপেক্ষমাণ আইটেম পরে আবার চেষ্টার জন্য সারিতে থাকে। দ্বন্দ্বে নীরবে কিছু ওভাররাইট হয় না।",
  "automation.sync.syncedPending":
    "{pending, plural, one {# টি আইটেম} other {# টি আইটেম}} এখনও সারিতে। নিচে স্ট্যাটাস ও দ্বন্দ্ব দেখুন।",
  "automation.sync.syncedDone": "সিঙ্ক শেষ হয়েছে। নিচে আইটেম ও দ্বন্দ্ব দেখুন।",
  "automation.sync.items": "সিঙ্ক হওয়া আইটেম",
  "automation.sync.itemsNote":
    "শুধু মেটাডেটা; আইটেমের বিষয়বস্তু ও দ্বন্দ্বপূর্ণ মান দেখানো হয় না।",
  "automation.sync.noItems": "কোনো সিঙ্ক রেকর্ড স্টেজ করা নেই।",
  "automation.sync.itemLine":
    "{id} · {dataClass} · মালিক {owner} · পরিসর {scope} · প্রজেক্ট {project} · রিভিশন {revision} · হালনাগাদ {updated} · {state}",
  "automation.sync.projectNone": "নেই",
  "automation.sync.updatedUnknown": "অজানা",
  "automation.sync.state.deletionQueued": "মোছা সারিতে",
  "automation.sync.state.deleted": "মোছা হয়েছে",
  "automation.sync.state.queued": "সারিতে",
  "automation.sync.state.synced": "সিঙ্ক হয়েছে",
  "automation.sync.conflictMissing":
    "দ্বন্দ্ব: এই রেকর্ডটি রিলেতে নেই। রিলেতে ফিরিয়ে আনতে লোকালটি রাখুন, অথবা লোকালের স্টেজড সিঙ্ক রেকর্ড মুছতে রিমোটের মোছা গ্রহণ করুন। কিছুই নিজে থেকে ওভাররাইট হয় না।",
  "automation.sync.conflictRemote":
    "দ্বন্দ্ব: রিমোট রিভিশন {revision}, হালনাগাদ {updated}। আপনি একটি পক্ষ না বাছা পর্যন্ত কিছু ওভাররাইট হয় না।",
  "automation.sync.reviewKeepLocal": "{id}-এর লোকাল রাখা দেখুন",
  "automation.sync.reviewKeepRemote": "{id}-এর রিমোট রাখা দেখুন",
  "automation.sync.reviewAcceptDeletion": "{id}-এর রিমোট মোছা গ্রহণ দেখুন",
  "automation.sync.reviewDeletion": "{id}-এর রিমোট মোছা দেখুন",
  "automation.sync.resolutionPreview": "দ্বন্দ্ব সমাধানের প্রিভিউ",
  "automation.sync.previewFor": "{id} ({scope})-এর প্রিভিউ:",
  "automation.sync.previewAcceptDeletion":
    "রিমোট মোছা গ্রহণ: এখনই লোকালের স্টেজড সিঙ্ক রেকর্ড মুছুন; কিছুই আপলোড হবে না।",
  "automation.sync.previewRestore":
    "অনুপস্থিত রিমোট পুনরুদ্ধার: পরের সফল সিঙ্কে আপলোডের জন্য লোকাল সংস্করণ সারিতে রাখুন।",
  "automation.sync.previewKeepRemote":
    "রিমোট রাখুন: এখনই লোকালের স্টেজড সিঙ্ক রেকর্ডকে রিমোট সংস্করণ দিয়ে বদলান।",
  "automation.sync.previewKeepLocal":
    "লোকাল রাখুন: পরের সফল সিঙ্কে আপলোডের জন্য এই সংস্করণ সারিতে রাখুন। রিমোটে নতুন পরিবর্তন থাকলে তবুও সমাধান লাগবে।",
  "automation.sync.previewTail":
    "আইটেমের বিষয়বস্তু এখানে লুকানো; মেটাডেটা দেখে সংস্করণ চিনতে না পারলে বাতিল করুন। এখান থেকে এটি ফেরানো যায় না।",
  "automation.sync.confirmAcceptDeletion": "রিমোট মোছা গ্রহণ নিশ্চিত করুন",
  "automation.sync.confirmRestore": "অনুপস্থিত রিমোট পুনরুদ্ধার নিশ্চিত করুন",
  "automation.sync.confirmKeepLocal": "লোকাল রাখা নিশ্চিত করুন",
  "automation.sync.confirmKeepRemote": "রিমোট রাখা নিশ্চিত করুন",
  "automation.sync.cancelResolution": "সমাধান বাতিল করুন",
  "automation.sync.resolvedDeletion":
    "রিমোট মোছা গ্রহণ করা হয়েছে। লোকালের স্টেজড সিঙ্ক রেকর্ড এখন মোছা; আপলোডের জন্য কিছু সারিতে নেই।",
  "automation.sync.resolvedChoice":
    "দ্বন্দ্বের পছন্দ সংরক্ষিত হয়েছে। অপেক্ষমাণ পরিবর্তন অনলাইনে স্বয়ংক্রিয়ভাবে সিঙ্ক হয়; এখনই সিঙ্ক করুন চাপলে সঙ্গে সঙ্গে চেষ্টা শুরু হয়।",
  "automation.sync.deletionConfirmation": "রিমোট মোছার নিশ্চিতকরণ",
  "automation.sync.deletionText":
    "রিলে থেকে {id} ({scope}) মুছবেন? এতে লোকালে একটি টম্বস্টোন সারিতে যায়; সফল সিঙ্কের পরেই কেবল রিমোট কপি সরে। এখান থেকে এটি ফেরানো যায় না।",
  "automation.sync.confirmDeletion": "রিমোট মোছা নিশ্চিত করুন",
  "automation.sync.cancelDeletion": "মোছা বাতিল করুন",
  "automation.sync.deletionQueued": "মোছা সারিতে আছে। সফল সিঙ্কের আগে রিমোট কপি মোছা হয় না।",
  "automation.sync.relayUrl": "রিলে HTTPS URL",
  "automation.sync.relayToken": "রিলে অথেনটিকেশন টোকেন",
  "automation.sync.restoreKey": "বিদ্যমান রিকভারি কী (ঐচ্ছিক, পরিচয় পুনরুদ্ধারের জন্য)",
  "automation.sync.optInNote":
    "স্পষ্ট অপ্ট-ইন: কনফিগার করলে রিলের ক্রেডেনশিয়াল লোকালে সংরক্ষিত হয় এবং অনলাইনে সারিবদ্ধ রেকর্ডের স্বয়ংক্রিয় সিঙ্ক চালু হয়। নতুন পরিচয়ে একবারই একটি রিকভারি কী দেখানো হয়: সঙ্গে সঙ্গে সংরক্ষণ করুন; পরে এটি আর পাওয়া যাবে না। সিঙ্ক বন্ধ করার পর আবার কনফিগার করলে লোকালে সংরক্ষিত পরিচয় থাকলে তাই ব্যবহার হয়। আপনার কী কখনও রিলে অপারেটরকে দেবেন না।",
  "automation.sync.configure": "এনক্রিপ্টেড সিঙ্ক কনফিগার করুন",
  "automation.sync.configured":
    "সিঙ্ক কনফিগার হয়েছে। সারিবদ্ধ রেকর্ড অনলাইনে স্বয়ংক্রিয়ভাবে সিঙ্ক হয়; এখনই সিঙ্ক করুন চাপলে সঙ্গে সঙ্গে চেষ্টা শুরু হয়।",
  "automation.sync.recoveryGroup": "এককালীন রিকভারি কী",
  "automation.sync.recoveryText":
    "এখনই এই রিকভারি কী কপি করে নিরাপদ জায়গায় রাখুন। এটি শুধু একবার দেখানো হয় এবং পরে আর পাওয়া যাবে না। কাউকে দেবেন না।",
  "automation.sync.copyKey": "রিকভারি কী কপি করুন",
  "automation.sync.savedKey": "আমি কী সংরক্ষণ করেছি — বন্ধ করুন",
  "automation.sync.refresh": "সিঙ্ক স্ট্যাটাস রিফ্রেশ করুন",
};
