// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { automation as enAutomation } from "../../en/automation";

/** Machine-translated; unreviewed (see ../../README.md). */
export const automation: Record<keyof typeof enAutomation, string> = {
  // ---- workflows: tables and checks (core/workflows.ts) ----
  "automation.workflows.environment.local": "Local",
  "automation.workflows.environment.dev": "Développement",
  "automation.workflows.environment.staging": "Préproduction",
  "automation.workflows.environment.production": "PRODUCTION",
  "automation.workflows.environment.productionLive": "PRODUCTION (modifie des systèmes en service)",

  "automation.workflows.runStatus.queued": "En file d’attente",
  "automation.workflows.runStatus.running": "En cours",
  "automation.workflows.runStatus.waiting_approval": "En attente de votre approbation",
  "automation.workflows.runStatus.compensating": "Annulation des étapes précédentes",
  "automation.workflows.runStatus.succeeded": "Réussie",
  "automation.workflows.runStatus.rejected": "Rejetée par vous",
  "automation.workflows.runStatus.failed": "Échec",
  "automation.workflows.runStatus.failed_needs_attention": "Échec : nécessite votre attention",
  "automation.workflows.runStatus.cancelled": "Annulée",
  "automation.workflows.runStatus.interrupted": "Interrompue (Phoenix a redémarré)",
  "automation.workflows.runStatus.refused": "Refusée : son exécution n’était pas autorisée",

  "automation.workflows.stepStatus.running": "En cours",
  "automation.workflows.stepStatus.waiting": "En attente",
  "automation.workflows.stepStatus.succeeded": "Réussie",
  "automation.workflows.stepStatus.failed": "Échec",
  "automation.workflows.stepStatus.timed_out": "Délai dépassé (résultat inconnu)",
  "automation.workflows.stepStatus.rejected": "Rejetée",
  "automation.workflows.stepStatus.expired": "Expirée",
  "automation.workflows.stepStatus.unknown": "Résultat inconnu",

  "automation.workflows.authorisation.notNeeded": "Aucune autorisation nécessaire",
  "automation.workflows.authorisation.authorised": "Autorisé pour la production",
  "automation.workflows.authorisation.notAuthorised":
    "NON autorisé : les déclenchements sont refusés",

  "automation.workflows.expiry.invalid": "Ce n’est pas une date et une heure valides.",
  "automation.workflows.expiry.past": "L’expiration doit être dans le futur.",
  "automation.workflows.expiry.tooFar": "L’expiration ne peut pas dépasser {days} jours.",
  "automation.workflows.refused.noReason": "Aucun motif n’a été indiqué.",
  "automation.workflows.payload.invalidJson": "La charge utile n’est pas un JSON valide.",
  "automation.workflows.payload.notObject": "La charge utile doit être un objet JSON, comme '{}'.",
  "automation.workflows.payload.tooMany": "La charge utile peut contenir au plus {max} clés.",

  // ---- workflows: the list ----
  "automation.workflows.title": "Workflows",
  "automation.workflows.intro":
    "Un workflow réagit à un événement par une liste fixe d’étapes. Un workflow qui modifie la production ne fait rien tant que vous n’avez pas autorisé exactement la définition que vous avez examinée.",
  "automation.workflows.empty":
    "Aucun workflow pour l’instant. Créez-en un en examinant une définition ci-dessous.",
  "automation.workflows.row.runsWhen": "S’exécute quand {event} se produit · version {version}",
  "automation.workflows.row.cannotRun": "Impossible de l’exécuter : {problems}",
  "automation.workflows.row.metrics":
    "{started, plural, one {# exécution} many {# d’exécutions} other {# exécutions}}, {succeeded} réussie(s)",

  // ---- workflows: the numbers of one workflow ----
  "automation.workflows.metrics.title": "Chiffres",
  "automation.workflows.metrics.label": "Métriques",
  "automation.workflows.metrics.none":
    "Ce workflow ne s’est pas encore exécuté : il n’y a donc pas de chiffres.",
  "automation.workflows.metrics.started": "Exécutions démarrées",
  "automation.workflows.metrics.succeeded": "Réussies",
  "automation.workflows.metrics.failed": "En échec",
  "automation.workflows.metrics.attention": "Nécessitant votre attention",
  "automation.workflows.metrics.cancelled": "Annulées",
  "automation.workflows.metrics.refused": "Refusées",
  "automation.workflows.metrics.interrupted": "Interrompues",
  "automation.workflows.metrics.stepsFailed": "Étapes en échec",
  "automation.workflows.metrics.stepsFailedValue": "{count} ({percent} % des étapes)",
  "automation.workflows.metrics.approvalsWaiting": "Approbations en attente",
  "automation.workflows.metrics.approvalsOutcome": "Approbations approuvées / rejetées / expirées",
  "automation.workflows.metrics.approvalsOutcomeValue": "{approved} / {rejected} / {expired}",
  "automation.workflows.metrics.runTime": "Durée d’exécution (médiane / 90e centile)",
  "automation.workflows.metrics.runTimeValue":
    "{median} ms / {p90} ms sur {samples, plural, one {# exécution} many {# d’exécutions} other {# exécutions}}",
  "automation.workflows.metrics.noFinishedRuns": "aucune exécution terminée",

  // ---- workflows: the definition editor ----
  "automation.workflows.editor.titleEdit": "Modifier la définition",
  "automation.workflows.editor.titleCreate": "Créer un workflow",
  "automation.workflows.editor.introExisting":
    'Saisissez la définition JSON complète. Conservez "enabled": {enabled} ; cette modification préserve l’état actuel de l’interrupteur. L’enregistrement ne l’autorise pas et ne l’exécute pas. La vérification n’enregistre jamais.',
  "automation.workflows.editor.introNew":
    'Saisissez la définition JSON complète. Les nouvelles définitions doivent avoir "enabled": false. L’enregistrement ne les exécute, ne les active et ne les autorise pas. La vérification n’enregistre jamais.',
  "automation.workflows.editor.label": "Définition du workflow (JSON)",
  "automation.workflows.editor.check": "Vérifier le brouillon",
  "automation.workflows.editor.enterJson":
    "Saisissez une définition de workflow JSON avant de la vérifier.",
  "automation.workflows.editor.notObject": "Une définition de workflow doit être un objet JSON.",
  "automation.workflows.editor.keepEnabled":
    'Conservez "enabled": {enabled}. Modifiez l’interrupteur séparément après l’enregistrement.',
  "automation.workflows.editor.setDisabled":
    'Définissez "enabled": false. L’enregistrement d’une nouvelle définition ne doit pas l’activer.',
  "automation.workflows.editor.keepId":
    "La modification doit conserver le même ID de workflow. Utilisez Créer un workflow pour un nouvel ID.",
  "automation.workflows.editor.notValid": "Non valide : {problems}",
  "automation.workflows.editor.noHash":
    "La validation n’a pas renvoyé de hachage de définition valide.",
  "automation.workflows.editor.hashDiffers":
    "Le hachage de la définition enregistrée diffère du hachage examiné. Examinez la définition stockée avant de l’utiliser.",
  "automation.workflows.editor.savedExisting":
    "Définition enregistrée. L’état de l’interrupteur existant est inchangé ; l’enregistrement ne l’autorise pas.",
  "automation.workflows.editor.savedNew":
    "Définition enregistrée, désactivée. L’enregistrement ne l’autorise ni ne l’active.",
  "automation.workflows.editor.reviewed": "Définition examinée",
  "automation.workflows.editor.validLead": "Brouillon valide.",
  "automation.workflows.editor.valid":
    "{lead} Examinez cette définition et ce hachage exacts avant d’enregistrer. Toute modification nécessite une nouvelle vérification.",
  "automation.workflows.editor.toSave": "Définition à enregistrer",
  "automation.workflows.editor.hash": "Hachage validé : {hash}",
  "automation.workflows.editor.authRequired": "Autorisation requise séparément : {reasons}",
  "automation.workflows.editor.authNotRequired": "Aucune autorisation requise.",
  "automation.workflows.editor.switchOn":
    "L’enregistrement n’autorise jamais ; l’interrupteur reste activé.",
  "automation.workflows.editor.switchOff":
    "L’enregistrement n’autorise jamais ; l’interrupteur reste désactivé.",
  "automation.workflows.editor.switchNew":
    "L’enregistrement n’autorise jamais ; le nouveau workflow reste désactivé.",
  "automation.workflows.editor.confirm": "Confirmer : enregistrer exactement cette définition",
  "automation.workflows.editor.reviewStored": "Examiner le workflow stocké",

  // ---- workflows: checking the stored definition ----
  "automation.workflows.validate.button": "Vérifier la définition",
  "automation.workflows.validate.dryRun": "Simulation. Rien n’est enregistré et rien ne s’exécute.",
  "automation.workflows.validate.validLead": "Valide.",
  "automation.workflows.validate.valid": "{lead} Hachage {hash}. {authorisation}",
  "automation.workflows.validate.needsAuth": "Nécessite votre autorisation : {reasons}.",
  "automation.workflows.validate.noAuth": "Aucune autorisation nécessaire.",
  "automation.workflows.validate.invalidLead": "Non valide.",
  "automation.workflows.validate.invalid":
    "{lead} {count, plural, one {# problème :} many {# de problèmes :} other {# problèmes :}}",
  "automation.workflows.validate.problems": "Problèmes",

  // ---- workflows: authorising ----
  "automation.workflows.authorise.title": "Autoriser pour la production",
  "automation.workflows.authorise.notNeeded": "Ce workflow n’a pas besoin d’autorisation.",
  "automation.workflows.authorise.why": "Pourquoi il a besoin de votre autorisation :",
  "automation.workflows.authorise.reasons": "Motifs",
  "automation.workflows.authorise.intro":
    "Cela permettra au workflow {name} de s’exécuter chaque fois que {event} se produit, sans autre question pour ces étapes, sauf si le workflow en pose une :",
  "automation.workflows.authorise.allowed": "Ce qui serait autorisé à s’exécuter",
  "automation.workflows.authorise.noTools": "Il n’appelle aucun outil.",
  "automation.workflows.authorise.step": "L’étape {step} appelle {tool}",
  "automation.workflows.authorise.stepUndo": "L’étape {step} appelle {tool} (annulation : {undo})",
  "automation.workflows.authorise.being":
    "Définition en cours d’autorisation : version {version}, hachage {hash}",
  "automation.workflows.authorise.expires": "Expire {hint}",
  "automation.workflows.authorise.expiresHint": "(facultatif, sous {days} jours)",
  "automation.workflows.authorise.submit": "Autoriser exactement cette définition",
  "automation.workflows.authorise.done":
    "Version {version} autorisée. Toute modification ultérieure de la définition y met fin.",

  // ---- workflows: run now ----
  "automation.workflows.runNow.title": "Exécuter maintenant",
  "automation.workflows.runNow.intro":
    "Lance le workflow à la main avec les mêmes vérifications que lorsque son événement se produit : activé, non bloqué par l’arrêt d’urgence, valide, et autorisé s’il modifie la production.",
  "automation.workflows.runNow.payload": "Données que l’événement aurait transportées {hint}",
  "automation.workflows.runNow.payloadHint": "(un objet JSON, facultatif)",
  "automation.workflows.runNow.button": "Exécuter maintenant",
  "automation.workflows.runNow.cannotRun": "Il ne peut pas s’exécuter : {problems}",
  "automation.workflows.runNow.enableFirst": "Activez le workflow pour l’exécuter.",
  "automation.workflows.runNow.refusedLead": "Le démarrage a été refusé.",
  "automation.workflows.runNow.seeRefused": "Voir l’exécution refusée",
  "automation.workflows.runNow.started": "Démarré. {link}",
  "automation.workflows.runNow.follow": "Suivre l’exécution",

  // ---- workflows: one workflow ----
  "automation.workflows.detail.all": "Tous les workflows",
  "automation.workflows.detail.backAll": "← Tous les workflows",
  "automation.workflows.detail.productionLead": "Production.",
  "automation.workflows.detail.production":
    "{lead} Ce workflow peut modifier des systèmes en service. Il ne s’exécute que tant que vous avez autorisé sa définition exacte.",
  "automation.workflows.detail.cannotRunNow": "Il ne peut pas s’exécuter pour le moment :",
  "automation.workflows.detail.definition": "Définition",
  "automation.workflows.detail.versionHash": "Version {version} · hachage {hash}",
  "automation.workflows.detail.runsWhen": "S’exécute quand {event} se produit.",
  "automation.workflows.detail.runsWhenAnd":
    "S’exécute quand {event} se produit et que {condition}.",
  "automation.workflows.detail.tools": "Outils qu’il peut appeler",
  "automation.workflows.detail.toolsLabel": "Outils",
  "automation.workflows.detail.none": "Aucun.",
  "automation.workflows.detail.toolStep": "Étape {step} : {tool}",
  "automation.workflows.detail.flagged": "Action de production ou critique",
  "automation.workflows.detail.declaredUndo": "annulation déclarée : {undo}",
  "automation.workflows.detail.definitionText": "Définition (texte en lecture seule, défilable)",
  "automation.workflows.detail.unreadable": "La définition stockée n’a pas pu être lue.",
  "automation.workflows.detail.switch": "Interrupteur",
  "automation.workflows.detail.enable": "Activer",
  "automation.workflows.detail.disable": "Désactiver",
  "automation.workflows.detail.switchNote":
    "L’activation n’autorise pas. Un workflow de production activé mais non autorisé enregistre chaque déclenchement comme refusé.",
  "automation.workflows.detail.authorisations": "Autorisations",
  "automation.workflows.detail.noneYet": "Aucune pour l’instant.",
  "automation.workflows.detail.inForce": "En vigueur",
  "automation.workflows.detail.revoked": "Révoquée",
  "automation.workflows.detail.notInForce": "Non en vigueur",
  "automation.workflows.detail.authorisedBy": "par {by} le {date}",
  "automation.workflows.detail.authExpires": "expire le {date}",
  "automation.workflows.detail.authChanged": "la définition a changé ou l’autorisation a expiré",
  "automation.workflows.detail.forHash": "pour le hachage {hash}",
  "automation.workflows.detail.confirmRevoke": "Confirmer : révoquer l’autorisation",
  "automation.workflows.detail.revoke": "Révoquer l’autorisation…",
  "automation.workflows.detail.revokeNote":
    "Les exécutions en cours s’arrêtent à leur prochaine étape.",
  "automation.workflows.detail.recentRuns": "Exécutions récentes",
  "automation.workflows.detail.noRuns": "Aucune exécution pour l’instant.",

  // ---- workflows: runs and steps ----
  "automation.workflows.run.needsLook": "(à examiner)",
  "automation.workflows.run.notSuccess": "(pas un succès)",
  "automation.workflows.run.nowAtStep": "maintenant à l’étape {step}",
  "automation.workflows.run.atStep": "à l’étape {step}",
  "automation.workflows.run.backToWorkflow": "Retour au workflow",
  "automation.workflows.run.title": "Exécution de {name}",
  "automation.workflows.run.created": "Créée le {date}",
  "automation.workflows.run.finished": "terminée le {date}",
  "automation.workflows.run.chainDepth": "profondeur de chaîne {depth}",
  "automation.workflows.run.waitingForYou": "En attente de votre action",
  "automation.workflows.run.stop": "Arrêter cette exécution",
  "automation.workflows.run.confirmCancel": "Confirmer : annuler cette exécution",
  "automation.workflows.run.keepRunning": "Laisser continuer",
  "automation.workflows.run.cancel": "Annuler cette exécution…",
  "automation.workflows.run.cancelNote":
    "Une annulation n’exécute pas les étapes d’annulation déclarées. Une étape déjà en cours peut tout de même se terminer.",
  "automation.workflows.run.trigger": "Ce qui l’a déclenchée",
  "automation.workflows.run.triggerText": "Déclencheur (texte brut, défilable)",
  "automation.workflows.run.stepsHeading": "Étapes ({count})",
  "automation.workflows.run.stepsLabel": "Étapes",
  "automation.workflows.run.noSteps": "Aucune étape n’a démarré.",
  "automation.workflows.step.undo": "Annulation : {step}",
  "automation.workflows.step.attempts":
    "{count, plural, one {# tentative} many {# de tentatives} other {# tentatives}}",
  "automation.workflows.step.changesState": "Modifie l’état",
  "automation.workflows.step.destructive": "{lead} : cette étape peut modifier un système réel.",
  "automation.workflows.step.tool": "Outil {tool}",
  "automation.workflows.step.input": "Entrée de l’étape {step} (texte brut, défilable)",
  "automation.workflows.step.output": "Sortie de l’étape {step} (texte brut, défilable)",

  // ---- plans: tables and checks (core/plans.ts) ----
  "automation.plans.status.draft": "Brouillon : pas encore proposé",
  "automation.plans.status.proposed": "Proposé : en attente de votre approbation",
  "automation.plans.status.approved": "Approuvé : prêt à créer",
  "automation.plans.status.creating": "Création des tâches…",
  "automation.plans.status.created": "Créé",
  "automation.plans.status.failed": "Échec : certaines tâches n’ont pas été créées",
  "automation.plans.status.cancelled": "Annulé",
  "automation.plans.basis.meeting": "issu de la réunion",
  "automation.plans.basis.suggested": "suggéré par le modèle",
  "automation.plans.basis.user": "rédigé par vous",
  "automation.plans.run.pending": "Non démarrée",
  "automation.plans.run.attempting": "En cours",
  "automation.plans.run.created": "Créée",
  "automation.plans.run.failed": "Échec",
  "automation.plans.tool.githubIssue": "Créer un ticket GitHub",
  "automation.plans.tool.frappeTask": "Créer une tâche Frappe",
  "automation.plans.kind.decision": "décision",
  "automation.plans.kind.action_item": "action à mener",
  "automation.plans.kind.requirement": "exigence",
  "automation.plans.authorship.rules":
    "Brouillon basé sur des règles : aucune IA ne l’a rédigé, il reformule simplement l’élément de la réunion.",
  "automation.plans.authorship.model":
    "Sortie du modèle ({model}) : comparez-la à la réunion avant d’approuver.",
  "automation.plans.destination.github": "Dépôt GitHub {repository}",
  "automation.plans.destination.frappe": "Site Frappe {site}",
  "automation.plans.problem.repository": "Le dépôt doit avoir la forme « owner/name ».",
  "automation.plans.problem.site": "Ce n’est pas un nom de site Frappe valide.",
  "automation.plans.problem.titleEmpty": "Le titre ne peut pas être vide.",
  "automation.plans.problem.titleLong": "Le titre dépasse {max}.",
  "automation.plans.problem.summaryEmpty": "Le résumé ne peut pas être vide.",
  "automation.plans.problem.summaryLong": "Le résumé dépasse {max}.",
  "automation.plans.problem.taskCount": "Un plan nécessite de 1 à {max} tâches.",
  "automation.plans.problem.taskTitle": "La tâche {n} a besoin d’un titre.",
  "automation.plans.problem.bodyLong": "Le corps dépasse {max}.",
  "automation.plans.problem.labelCount": "{max} libellés au plus.",
  "automation.plans.problem.labelLong": "Un libellé dépasse {max}.",

  // ---- plans: make a plan from a meeting item ----
  "automation.plans.off": "La planification est désactivée.",
  "automation.plans.make.open": "Créer un plan…",
  "automation.plans.make.openFrom": "Créer un plan à partir de {kind} : {text}",
  "automation.plans.make.intro":
    "Un plan est un brouillon de tâches d’ingénierie. Rien n’est créé tant que vous ne l’avez pas approuvé et que vous n’avez pas confirmé chaque tâche.",
  "automation.plans.make.where": "Où iraient les tâches ?",
  "automation.plans.make.githubIssues": "Tickets GitHub",
  "automation.plans.make.frappeTasks": "Tâches Frappe",
  "automation.plans.make.repository": "Dépôt (owner/name)",
  "automation.plans.make.site": "Site Frappe",
  "automation.plans.make.chooseSite": "Choisir un site",
  "automation.plans.make.drafting": "Rédaction du plan…",
  "automation.plans.make.draft": "Rédiger un plan",
  "automation.plans.make.localModel":
    "Un modèle local peut prendre une minute. Rien n’est envoyé ailleurs.",
  "automation.plans.make.drafted": "Plan rédigé.",
  "automation.plans.make.openPlan": "Ouvrir le plan",

  // ---- plans: on a meeting ----
  "automation.plans.meeting.title": "Plans et tâches de cette réunion",
  "automation.plans.meeting.plans": "Plans",
  "automation.plans.meeting.summary":
    "{status} · {count, plural, one {# tâche} many {# de tâches} other {# tâches}} · {system}",
  "automation.plans.meeting.tasksCreated": "Tâches créées",
  "automation.plans.meeting.tasksLabel": "Tâches créées à partir de cette réunion",
  "automation.plans.link.frappeTask": "Tâche {id}",
  "automation.plans.link.detail": "tâche {index} de {plan} · approuvée le {date}",
  "automation.plans.link.itsPlan": "son plan",

  // ---- plans: the editor ----
  "automation.plans.editor.label": "Modifier le plan",
  "automation.plans.editor.title": "Titre {hint}",
  "automation.plans.editor.summary": "Résumé {hint}",
  "automation.plans.editor.upTo": "(jusqu’à {max})",
  "automation.plans.editor.tasks": "Tâches {hint}",
  "automation.plans.editor.tasksRange": "(de 1 à {max})",
  "automation.plans.editor.task": "Tâche {n}",
  "automation.plans.editor.taskTitle": "Titre de la tâche {n}",
  "automation.plans.editor.taskBody": "Corps de la tâche {n} {hint}",
  "automation.plans.editor.taskLabels": "Libellés de la tâche {n} {hint}",
  "automation.plans.editor.labelsHint": "(séparés par des virgules, jusqu’à {max})",
  "automation.plans.editor.removeTask": "Supprimer la tâche {n}",
  "automation.plans.editor.addTask": "Ajouter une tâche",
  "automation.plans.editor.note":
    "L’enregistrement remet le plan en brouillon et efface toute approbation. Vous devez ensuite le proposer et l’approuver à nouveau.",
  "automation.plans.editor.save": "Enregistrer les modifications",

  // ---- plans: preview and results ----
  "automation.plans.preview.title": "Exactement ce qui serait envoyé",
  "automation.plans.preview.intro":
    "Chaque tâche correspond à un appel effectué en votre nom. Voici l’entrée réelle, affichée en texte brut.",
  "automation.plans.preview.calls": "Appels qui seraient effectués",
  "automation.plans.preview.task": "Tâche {n} : {tool}",
  "automation.plans.preview.decision": "(effet : {effect}, risque : {risk})",
  "automation.plans.preview.input": "Entrée de la tâche {n} (texte brut, défilable)",
  "automation.plans.runs.title": "Tâche par tâche",
  "automation.plans.runs.label": "Résultats des tâches",
  "automation.plans.runs.task": "Tâche {n} :",
  "automation.plans.runs.attempts":
    "{count, plural, one {# tentative} many {# de tentatives} other {# tentatives}}",
  "automation.plans.runs.frappeTask": "Tâche Frappe {id}",
  "automation.plans.runs.stopped":
    "Arrêt à la tâche {n} : {message}. Rien après elle n’a été créé. Vous pouvez relancer Créer : les tâches existantes sont retrouvées, pas dupliquées.",

  // ---- plans: one plan ----
  "automation.plans.page.allMeetings": "Toutes les réunions",
  "automation.plans.page.meeting": "← La réunion",
  "automation.plans.page.rules": "Brouillon basé sur des règles",
  "automation.plans.page.model": "Sortie du modèle",
  "automation.plans.page.destination": "Destination : {destination}",
  "automation.plans.page.from": "Depuis {kind} : {text}",
  "automation.plans.page.owner": "responsable {owner}",
  "automation.plans.page.due": "échéance {due}",
  "automation.plans.page.proposedNotice": "Proposé. Vérifiez l’aperçu, puis approuvez.",
  "automation.plans.page.approvedNotice": "Approuvé. Rien n’a encore été créé.",
  "automation.plans.page.savedNotice":
    "Enregistré. Le plan est de nouveau un brouillon ; proposez-le pour l’approuver.",
  "automation.plans.page.cancelledNotice": "Annulé. Rien n’a été créé.",
  "automation.plans.page.plan": "Le plan",
  "automation.plans.page.tasks": "Tâches ({count})",
  "automation.plans.page.tasksLabel": "Tâches",
  "automation.plans.page.labels": "Libellés :",
  "automation.plans.page.edit": "Modifier le plan",
  "automation.plans.page.acceptance": "Critères d’acceptation",
  "automation.plans.page.risks": "Risques",
  "automation.plans.page.questions": "Questions ouvertes",
  "automation.plans.frappe.doctype": "DocType Frappe proposé : {doctype}",
  "automation.plans.frappe.note":
    "Conception suggérée uniquement. La création des tâches ne crée ni ce DocType, ni ses champs, ni son workflow, ni ses permissions.",
  "automation.plans.frappe.fields": "Champs",
  "automation.plans.frappe.fieldsLabel": "Champs Frappe proposés",
  "automation.plans.frappe.required": "obligatoire",
  "automation.plans.frappe.noFields": "Aucun champ proposé.",
  "automation.plans.frappe.states": "États du workflow",
  "automation.plans.frappe.statesLabel": "États de workflow Frappe proposés",
  "automation.plans.frappe.noStates": "Aucun état de workflow proposé.",
  "automation.plans.frappe.permissions": "Permissions",
  "automation.plans.frappe.permissionsLabel": "Permissions Frappe proposées",
  "automation.plans.frappe.noPermissions": "Aucune permission proposée.",
  "automation.plans.frappe.access": "{role} : {access}",
  "automation.plans.frappe.read": "lecture",
  "automation.plans.frappe.write": "écriture",
  "automation.plans.frappe.create": "création",
  "automation.plans.frappe.noAccess": "aucun accès",
  "automation.plans.decide.title": "Décider",
  "automation.plans.decide.fingerprint":
    "Empreinte de ce que vous regardez : {hash}. L’approbation porte exactement sur ce contenu ; si le plan change, elle est refusée.",
  "automation.plans.decide.propose": "Proposer ce plan",
  "automation.plans.decide.nameMeeting": "Nommer la réunion dans les tâches créées",
  "automation.plans.decide.approve": "Approuver ce plan exact",
  "automation.plans.decide.approved": "Approuvé par {by} le {date}.",
  "automation.plans.decide.approvedNamed":
    "Approuvé par {by} le {date} · la réunion est nommée dans les tâches.",
  "automation.plans.decide.understand":
    "Je comprends que cela crée {count, plural, one {# tâche} many {# de tâches} other {# tâches}} dans {destination}, en mon nom.",
  "automation.plans.decide.createRemaining": "Créer les tâches restantes",
  "automation.plans.decide.create": "Créer les tâches",
  "automation.plans.decide.waiting":
    "En attente de votre approbation pour la tâche {n} sur {total}.",
  "automation.plans.decide.waitingNote":
    "Core vous demande confirmation avant la création de chaque tâche. Répondez ci-dessous ; cette page attend aussi longtemps qu’il le faut.",
  "automation.plans.decide.cancel": "Annuler ce plan",

  // ---- automation settings (AutomationSettings.tsx) ----
  "automation.settings.title": "Automatisation",
  "automation.settings.intro":
    "L’automatisation est désactivée tant que vous ne l’activez pas. Quand elle est désactivée, Fawkes ne démarre aucune tâche et n’exécute rien de lui-même. Quand elle est activée, Fawkes ne peut démarrer une tâche que si vous en demandez une, par exemple « Diagnostiquer un échec de CI » dans l’onglet Chat. Il lit des données et fait des propositions ; tout ce qui modifie quelque chose attend votre approbation, et vous pouvez annuler une tâche à tout moment. Désactiver l’automatisation annule toutes les tâches en cours.",
  "automation.settings.allow": "Autoriser Fawkes à exécuter les tâches que je lance",
  "automation.settings.statusOn":
    "L’automatisation est activée. {active, plural, one {# tâche est} many {# de tâches sont} other {# tâches sont}} en cours (au plus {max} à la fois).",
  "automation.settings.statusOff":
    "L’automatisation est désactivée. {active, plural, one {# tâche est} many {# de tâches sont} other {# tâches sont}} en cours (au plus {max} à la fois).",
  "automation.settings.unavailable":
    "Les paramètres d’automatisation ne sont pas disponibles depuis Phoenix Core ({error}).",

  // ---- proactive suggestions (ProactiveSettings.tsx) ----
  "automation.proactive.title": "Suggestions proactives",
  "automation.proactive.intro":
    "Désactivées par défaut. Kage peut suggérer des actions de réunion acceptées et non assignées lorsqu’il est disponible. Les signaux d’ingénierie ne peuvent analyser que les racines de dépôts surveillés que vous ajoutez explicitement ; leur fournisseur d’avis est indisponible et ne signale donc jamais d’avis. L’évaluation est manuelle, sauf si vous choisissez explicitement une cadence après avoir donné votre accord. Le travail planifié s’exécute en local et respecte les heures calmes, les limites de débit et l’arrêt d’urgence.",
  "automation.proactive.status":
    "Source Kage : {source}. Les suggestions sont {state} ({cadence}).",
  "automation.proactive.sourceAvailable": "disponible",
  "automation.proactive.sourceUnavailable": "indisponible",
  "automation.proactive.stateOn": "activées",
  "automation.proactive.stateOff": "désactivées",
  "automation.proactive.cadenceEvery":
    "toutes les {minutes, plural, one {# minute} many {# de minutes} other {# minutes}}",
  "automation.proactive.cadenceManual": "manuel uniquement",
  "automation.proactive.optIn": "Participation",
  "automation.proactive.enable": "Activer les suggestions proactives",
  "automation.proactive.kageItems": "Actions à mener Kage acceptées et non assignées",
  "automation.proactive.engineeringSignals": "Signaux d’ingénierie provenant des dépôts surveillés",
  "automation.proactive.engineeringSignalsStatus": "Les signaux d’ingénierie sont {state}.",
  "automation.proactive.cadence": "Cadence d’évaluation automatique",
  "automation.proactive.cadenceOff": "Manuel uniquement (désactivé)",
  "automation.proactive.cadence15": "Toutes les 15 minutes",
  "automation.proactive.cadence30": "Toutes les 30 minutes",
  "automation.proactive.cadence60": "Toutes les heures",
  "automation.proactive.cadence1440": "Tous les jours",
  "automation.proactive.quietHours": "Heures calmes",
  "automation.proactive.useQuiet": "Utiliser les heures calmes",
  "automation.proactive.timezone": "Fuseau horaire (IANA)",
  "automation.proactive.quietFrom": "Calme à partir de",
  "automation.proactive.quietUntil": "Calme jusqu’à",
  "automation.proactive.maxPerHour": "Nombre maximal de suggestions par heure",
  "automation.proactive.preview": "Prévisualiser les suggestions",
  "automation.proactive.evaluate": "Évaluer maintenant",
  "automation.proactive.refreshNoise": "Actualiser les métriques de bruit",
  "automation.proactive.delivered": "Suggestions délivrées",
  "automation.proactive.dismiss": "Ignorer {title}",
  "automation.proactive.previewHeading": "Aperçu étayé",
  "automation.proactive.previewLabel": "Aperçu des suggestions",
  "automation.proactive.previewEmpty":
    "Aucune action à mener Kage acceptée et non assignée n’est éligible.",
  "automation.proactive.evidence":
    "Preuve : réunion {meeting}, élément {item} ({source}) : « {quote} »",
  "automation.proactive.sourceTranscript": "transcription",
  "automation.proactive.sourceSummary": "résumé",
  "automation.proactive.noiseLabel": "Métriques de bruit des suggestions",
  "automation.proactive.noiseDelivered": "Délivrées",
  "automation.proactive.noiseDismissed": "Ignorées",
  "automation.proactive.noiseSuppressed": "Supprimées",
  "automation.proactive.noiseRate": "Taux d’abandon",
  "automation.proactive.saved": "Préférences de suggestions enregistrées.",
  "automation.proactive.previewCount":
    "{count, plural, one {# suggestion étayée dans l’aperçu.} many {# de suggestions étayées dans l’aperçu.} other {# suggestions étayées dans l’aperçu.}}",
  "automation.proactive.evaluated": "{delivered} délivrée(s) ; {suppressed} supprimée(s).",
  "automation.proactive.dismissed": "Suggestion ignorée.",

  // ---- capability registry (RegistrySettings.tsx) ----
  "automation.registry.title": "Registre des capacités",
  "automation.registry.intro":
    "Parcourez les métadonnées d’un index signé configuré localement et approuvé par l’hôte. Phoenix Core vérifie la signature de l’index avant de renvoyer les entrées. La navigation n’installe ni n’exécute de code tiers.",
  "automation.registry.noInstall":
    "Installation indisponible : aucun bac à sable audité du système d’exploitation n’est disponible. Les capacités tierces ne peuvent pas être installées ici.",
  "automation.registry.unavailable": "Registre indisponible",
  "automation.registry.loadFailed": "Impossible de charger le registre : {error}",
  "automation.registry.loading": "Chargement du registre…",
  "automation.registry.notConfigured":
    "Aucun registre local n’est configuré. Demandez à l’administrateur de l’hôte de configurer une clé de confiance et un index signé pour parcourir les capacités.",
  "automation.registry.indexSignature":
    "Signature de l’index : vérifiée avec le signataire Ed25519 {signer}, approuvé par l’hôte.",
  "automation.registry.signature": "Signature : {signature}",
  "automation.registry.indexHash": "SHA-256 de l’index signé : {hash}",
  "automation.registry.empty": "Le registre signé ne contient aucune capacité.",
  "automation.registry.preview": "Prévisualiser {name} {version}",
  "automation.registry.previewFailed": "Aperçu indisponible : {error}",
  "automation.registry.previewLoading": "Chargement de l’aperçu vérifié…",
  "automation.registry.permissions": "Permissions",
  "automation.registry.noDescription": "Aucune description fournie",
  "automation.registry.noneDeclared": "Aucune déclarée.",
  "automation.registry.dataCategories": "Catégories de données",
  "automation.registry.licence": "Licence",
  "automation.registry.licenceLine": "{licence}. {policy}",
  "automation.registry.security": "Sécurité",
  "automation.registry.securityContact": "Contact sécurité",
  "automation.registry.advisories": "Avis de sécurité",
  "automation.registry.provenance": "Provenance signée",
  "automation.registry.artifact":
    "SHA-256 de l’artefact déclaré par l’index signé : {hash} ({bytes, plural, one {# octet} many {# d’octets} other {# octets}}). Vérification de l’artefact : non vérifié ; les octets de l’artefact n’ont été ni récupérés ni contrôlés. La navigation n’exécute pas l’artefact.",
  "automation.registry.sandbox":
    "Bac à sable : indisponible. L’installation est désactivée ; aucune demande d’installation ne sera envoyée.",

  "automation.registry.skinPack": "pack d’apparence de données uniquement",
  "automation.registry.skinDataOnly":
    "Pack de tenue Phoenix de données uniquement. Il ne peut ni exécuter de code ni demander des autorisations.",
  "automation.registry.installSkin": "Installer l’apparence {name} {version}",
  "automation.registry.installPending":
    "En attente de la confirmation de Core avant d’installer cette apparence signée.",
  "automation.registry.installSucceeded": "Apparence signée installée dans la garde-robe.",
  "automation.registry.installFailed": "Échec de l’installation de l’apparence : {error}",
  // ---- encrypted sync (SyncSettings.tsx) ----
  "automation.sync.title": "Synchronisation chiffrée",
  "automation.sync.intro":
    "Facultative et désactivée par défaut. La synchronisation nécessite votre propre relais HTTPS disponible et son authentification ; Phoenix ne fournit pas de relais hébergé. La configuration est un consentement explicite : elle n’envoie rien pendant la mise en place, mais les enregistrements en file d’attente se synchronisent ensuite automatiquement lorsque vous êtes en ligne. Synchroniser maintenant lance une tentative immédiate. L’adaptateur ne prépare que les deux paramètres hors contenu explicitement sélectionnés ; les modifications locales ultérieures nécessitent Publier l’actuel. Le texte des réunions, des personnes et de la mémoire n’est jamais inclus par cet adaptateur.",
  "automation.sync.unavailable":
    "Les paramètres de synchronisation sont indisponibles depuis Phoenix Core. Cette demande d’état n’a pas contacté le relais.",
  "automation.sync.relayNone": "non configuré",
  "automation.sync.relayUnknown": "relais configuré (URL indisponible)",
  "automation.sync.statusOn":
    "La synchronisation est activée. {pending} en file d’attente ; {conflicts, plural, one {# conflit} many {# de conflits} other {# conflits}}.",
  "automation.sync.statusOff":
    "La synchronisation est désactivée. {pending} en file d’attente ; {conflicts, plural, one {# conflit} many {# de conflits} other {# conflits}}.",
  "automation.sync.chooseExclusions":
    "Choisissez les exclusions avant de donner votre accord ; les classes et projets exclus ne sont pas envoyés.",
  "automation.sync.excludeClasses": "Exclure des classes de données",
  "automation.sync.class.preference": "préférence",
  "automation.sync.class.context": "contexte",
  "automation.sync.class.project_profile": "profil de projet",
  "automation.sync.excludeProject": "Exclure un projet par son nom",
  "automation.sync.excludeProjectButton": "Exclure le projet",
  "automation.sync.removeExclusion": "Retirer l’exclusion de {name}",
  "automation.sync.exclusionsSaved": "Exclusions enregistrées.",
  "automation.sync.adapterLegend": "Choisir individuellement les paramètres existants",
  "automation.sync.adapterNote":
    "Seuls la réduction des animations (préférence) et le nombre de résultats de recherche (configuration de contexte), limités au propriétaire du compte, sont éligibles ; il n’y a aucune source limitée à un projet. La sélection prépare la valeur actuelle. Publiez explicitement une modification locale ultérieure. Les valeurs entrantes restent préparées jusqu’à ce que vous examiniez et confirmiez leur application en local. Exclure une classe retire aussi sa sélection d’adaptateur lorsque c’est permis ; les enregistrements déjà publiés doivent d’abord être supprimés et synchronisés. Désélectionner n’efface pas le texte chiffré envoyé ; supprimez séparément son élément synchronisé si nécessaire.",
  "automation.sync.adapter.reducedMotion": "Préférence de réduction des animations",
  "automation.sync.adapter.searchCount": "Métadonnées du nombre de résultats de recherche",
  "automation.sync.adapterSaved":
    "Sélection de l’adaptateur enregistrée. Les paramètres actuels nouvellement sélectionnés sont préparés ; aucune autre source n’est incluse.",
  "automation.sync.adapterApplied": "Le paramètre synchronisé sélectionné a été appliqué en local.",
  "automation.sync.adapterPublished":
    "Le paramètre local actuel est préparé pour la synchronisation chiffrée.",
  "automation.sync.publish": "Publier {key} actuel",
  "automation.sync.reviewApply": "Examiner l’application de {key}",
  "automation.sync.applyPreview": "Aperçu de l’application du paramètre",
  "automation.sync.applyText":
    "Appliquer la révision {revision} déchiffrée et préparée de {key} au paramètre local existant ? Elle ne remplacera la valeur actuelle qu’après confirmation. Les valeurs actuelle et entrante sont masquées ; identifiez les versions par leur source et leur révision, ou annulez. Une valeur locale ou une révision préparée modifiée invalide cet aperçu.",
  "automation.sync.confirmApply": "Confirmer l’application du paramètre",
  "automation.sync.cancelApply": "Annuler l’application",
  "automation.sync.relayLine":
    "Relais : {relay}. Identité : {identity}. Un relais joignable est requis ; cet état ne prouve pas que le relais est disponible.",
  "automation.sync.identityNone": "non disponible",
  "automation.sync.identityNote":
    "Cette identité représente le compte à clé de récupération partagée, et non un appareil distinct. Les appareils partageant la même clé et le même jeton de relais ne peuvent pas être révoqués individuellement, et la protection contre le rejeu du relais n’est pas établie.",
  "automation.sync.syncNow": "Synchroniser maintenant",
  "automation.sync.turnOff": "Désactiver la synchronisation",
  "automation.sync.turnedOff":
    "La synchronisation est désactivée. Les enregistrements en file d’attente restent locaux.",
  "automation.sync.offlineNote":
    "Si le relais est hors ligne, une synchronisation manuelle signale une erreur et les éléments en attente restent en file pour une nouvelle tentative ultérieure. Aucun écrasement silencieux n’a lieu en cas de conflit.",
  "automation.sync.syncedPending":
    "{pending, plural, one {# élément reste} many {# d’éléments restent} other {# éléments restent}} en file d’attente. Consultez l’état et les conflits ci-dessous.",
  "automation.sync.syncedDone":
    "Synchronisation terminée. Consultez les éléments et les conflits ci-dessous.",
  "automation.sync.items": "Éléments synchronisés",
  "automation.sync.itemsNote":
    "Métadonnées uniquement ; le contenu des éléments et les valeurs en conflit ne sont pas affichés.",
  "automation.sync.noItems": "Aucun enregistrement de synchronisation préparé.",
  "automation.sync.itemLine":
    "{id} · {dataClass} · propriétaire {owner} · portée {scope} · projet {project} · révision {revision} · mis à jour {updated} · {state}",
  "automation.sync.projectNone": "aucun",
  "automation.sync.updatedUnknown": "inconnu",
  "automation.sync.state.deletionQueued": "suppression en file d’attente",
  "automation.sync.state.deleted": "supprimé",
  "automation.sync.state.queued": "en file d’attente",
  "automation.sync.state.synced": "synchronisé",
  "automation.sync.conflictMissing":
    "Conflit : cet enregistrement est absent du relais. Conservez la version locale pour le restaurer sur le relais, ou acceptez la suppression distante pour supprimer l’enregistrement de synchronisation local préparé. Rien n’est écrasé automatiquement.",
  "automation.sync.conflictRemote":
    "Conflit : révision distante {revision}, mise à jour {updated}. Rien n’est écrasé tant que vous n’avez pas choisi un côté.",
  "automation.sync.reviewKeepLocal": "Examiner la conservation de la version locale pour {id}",
  "automation.sync.reviewKeepRemote": "Examiner la conservation de la version distante pour {id}",
  "automation.sync.reviewAcceptDeletion":
    "Examiner l’acceptation de la suppression distante pour {id}",
  "automation.sync.reviewDeletion": "Examiner la suppression distante pour {id}",
  "automation.sync.resolutionPreview": "Aperçu de la résolution du conflit",
  "automation.sync.previewFor": "Aperçu pour {id} ({scope}) :",
  "automation.sync.previewAcceptDeletion":
    "Accepter la suppression distante : supprimer maintenant l’enregistrement de synchronisation local préparé ; rien n’est envoyé.",
  "automation.sync.previewRestore":
    "Restaurer la version distante manquante : mettre la version locale en file d’attente pour l’envoi lors de la prochaine synchronisation réussie.",
  "automation.sync.previewKeepRemote":
    "Conserver la version distante : remplacer maintenant l’enregistrement de synchronisation local préparé par la version distante.",
  "automation.sync.previewKeepLocal":
    "Conserver la version locale : mettre cette version en file d’attente pour l’envoi lors de la prochaine synchronisation réussie. Une modification distante plus récente nécessitera tout de même une résolution.",
  "automation.sync.previewTail":
    "Le contenu des éléments est masqué ici ; si vous ne pouvez pas identifier les versions à partir des métadonnées, annulez. Cette action ne peut pas être annulée ici.",
  "automation.sync.confirmAcceptDeletion": "Confirmer l’acceptation de la suppression distante",
  "automation.sync.confirmRestore": "Confirmer la restauration de la version distante manquante",
  "automation.sync.confirmKeepLocal": "Confirmer la conservation de la version locale",
  "automation.sync.confirmKeepRemote": "Confirmer la conservation de la version distante",
  "automation.sync.cancelResolution": "Annuler la résolution",
  "automation.sync.resolvedDeletion":
    "Suppression distante acceptée. L’enregistrement de synchronisation local préparé est maintenant supprimé ; rien n’est en file d’attente pour l’envoi.",
  "automation.sync.resolvedChoice":
    "Choix du conflit enregistré. Les modifications en attente se synchronisent automatiquement lorsque vous êtes en ligne ; Synchroniser maintenant lance une tentative immédiate.",
  "automation.sync.deletionConfirmation": "Confirmation de la suppression distante",
  "automation.sync.deletionText":
    "Supprimer {id} ({scope}) du relais ? Cela met en file d’attente une pierre tombale en local ; la copie distante n’est supprimée qu’après une synchronisation réussie. Cette action ne peut pas être annulée ici.",
  "automation.sync.confirmDeletion": "Confirmer la suppression distante",
  "automation.sync.cancelDeletion": "Annuler la suppression",
  "automation.sync.deletionQueued":
    "Suppression mise en file d’attente. La copie distante n’est pas supprimée avant une synchronisation réussie.",
  "automation.sync.relayUrl": "URL HTTPS du relais",
  "automation.sync.relayToken": "Jeton d’authentification du relais",
  "automation.sync.restoreKey":
    "Clé de récupération existante (facultative, pour restaurer une identité)",
  "automation.sync.optInNote":
    "Consentement explicite : la configuration stocke les identifiants du relais en local et active la synchronisation automatique des enregistrements en file d’attente lorsque vous êtes en ligne. Une nouvelle identité affiche une clé de récupération une seule fois : enregistrez-la immédiatement ; elle ne pourra pas être récupérée plus tard. Reconfigurer après avoir désactivé la synchronisation réutilise l’identité stockée en local lorsqu’elle est disponible. Ne partagez jamais votre clé avec l’opérateur du relais.",
  "automation.sync.configure": "Configurer la synchronisation chiffrée",
  "automation.sync.configured":
    "La synchronisation est configurée. Les enregistrements en file d’attente se synchronisent automatiquement lorsque vous êtes en ligne ; Synchroniser maintenant lance une tentative immédiate.",
  "automation.sync.recoveryGroup": "Clé de récupération à usage unique",
  "automation.sync.recoveryText":
    "Copiez cette clé de récupération et conservez-la maintenant en lieu sûr. Elle n’est affichée qu’une seule fois et ne pourra pas être récupérée plus tard. Ne la partagez pas.",
  "automation.sync.copyKey": "Copier la clé de récupération",
  "automation.sync.savedKey": "J’ai enregistré la clé — fermer",
  "automation.sync.refresh": "Actualiser l’état de la synchronisation",
};
