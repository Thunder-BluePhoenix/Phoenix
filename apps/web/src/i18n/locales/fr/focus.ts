// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { focus as enFocus } from "../../en/focus";

/** Machine-translated; unreviewed. */
export const focus: Record<keyof typeof enFocus, string> = {
  "focus.title": "Mode concentration",
  "focus.start": "Commencer",
  "focus.stop": "Terminer",
  "focus.minutes": "Minutes (vide pour une durée illimitée)",
  "focus.remaining": "Minutes restantes : {count}",
  "focus.active": "Concentration active",
  "focus.inactive": "Concentration désactivée",
  "focus.held": "Notifications retenues : {count}",
  "focus.osDnd": "Ne pas déranger du système est actif",
  "focus.osUnknown": "État Ne pas déranger indisponible",
  "focus.refresh": "Actualiser le statut du système",
  "focus.pomodoro": "Démarrer un Pomodoro",
  "focus.systemUnavailable":
    "Ne pas déranger du système est indisponible ; le mode concentration ne contrôle que les notifications Phoenix.",
  "focus.screenshot.title": "Capture vers un ticket",
  "focus.screenshot.capture": "Choisir une zone de l’écran…",
  "focus.screenshot.permission": "Autorisation d’enregistrement d’écran requise.",
  "focus.screenshot.error": "Échec de la demande : {error}",
  "focus.screenshot.box": "Cadre",
  "focus.screenshot.arrow": "Flèche",
  "focus.screenshot.text": "Texte",
  "focus.screenshot.redact": "Masquer définitivement",
  "focus.screenshot.annotationText": "Texte de l’annotation",
  "focus.screenshot.project": "Dépôt ou projet",
  "focus.screenshot.issueTitle": "Titre du ticket",
  "focus.screenshot.body": "Description du ticket",
  "focus.screenshot.preview": "Aperçu du brouillon",
  "focus.screenshot.create": "Demander l’approbation et créer le ticket",
  "focus.screenshot.draft": "Brouillon (non créé)",
  "focus.screenshot.attachment": "Capture jointe si possible",
  "focus.screenshot.noAttachment":
    "Ce service ne prend pas en charge les captures jointes ; aucune image ne sera envoyée.",
  "focus.screenshot.created": "Ticket créé : {url}",
  "focus.screenshot.declined": "Approbation refusée ; rien n’a été envoyé.",
  "focus.screenshot.tracker": "Gestionnaire de tickets",
  "focus.screenshot.tracker.github": "GitHub",
  "focus.screenshot.tracker.linear": "Linear",
  "focus.screenshot.tracker.jira": "Jira",
  "focus.issueDraft.title": "Ticket à partir d’une image que vous avez",
  "focus.issueDraft.intro":
    "Déposez, collez ou choisissez un PNG ou JPEG que vous avez déjà, rédigez le ticket et vérifiez exactement ce qui sera envoyé. Phoenix ne capture pas votre écran. Le ticket n’est créé sur GitHub qu’après votre confirmation ici, puis dans Approbations.",
  "focus.issueDraft.unavailable.capability":
    "L’intégration GitHub n’est pas activée ou ne peut pas créer de tickets ; rien ne peut être créé.",
  "focus.issueDraft.unavailable.token":
    "Aucun jeton d’écriture GitHub n’est défini pour l’intégration GitHub ; rien ne peut être créé.",
  "focus.issueDraft.dropLabel": "Déposer une image pour le ticket",
  "focus.issueDraft.dropHint": "Déposez ou collez un PNG ou JPEG ici, ou {choose}.",
  "focus.issueDraft.choose": "choisissez une image…",
  "focus.issueDraft.chooseLabel": "Choisir une image pour le ticket",
  "focus.issueDraft.imageAlt": "Image pour le ticket : {name}",
  "focus.issueDraft.imageRemove": "Retirer l’image",
  "focus.issueDraft.oneImage": "Ajoutez une seule image à la fois.",
  "focus.issueDraft.imageRequired": "Ajoutez d’abord une image.",
  "focus.issueDraft.titleRequired": "Rédigez un titre pour le ticket.",
  "focus.issueDraft.titleTooLong": "Le titre peut contenir au plus {max} caractères.",
  "focus.issueDraft.bodyTooLong": "La description peut contenir au plus {max} caractères.",
  "focus.issueDraft.secretInTitle":
    "Le titre semble contenir un mot de passe, une clé ou un jeton. Retirez-le ; rien n’a été envoyé.",
  "focus.issueDraft.secretInBody":
    "La description semble contenir un mot de passe, une clé ou un jeton. Retirez-le ; rien n’a été envoyé.",
  "focus.issueDraft.secretInBoth":
    "Le titre et la description semblent contenir un mot de passe, une clé ou un jeton. Retirez-le ; rien n’a été envoyé.",
  "focus.issueDraft.previewRepository": "Dépôt : {repository}",
  "focus.issueDraft.previewTitle": "Titre : {title}",
  "focus.issueDraft.previewBody": "Description, exactement telle qu’elle sera envoyée :",
  "focus.issueDraft.previewNoBody": "Aucune description ne sera envoyée.",
  "focus.issueDraft.imageLocal":
    "L’image ({name}) n’est PAS envoyée. Les tickets GitHub sont créés à partir de texte seulement ; l’image reste sur cet appareil et n’est pas enregistrée. Ajoutez-la vous-même au ticket si vous le souhaitez.",
  "focus.issueDraft.approval":
    "Rien n’est encore créé. Après avoir appuyé sur le bouton, Phoenix demande votre approbation dans Approbations avant d’envoyer quoi que ce soit à GitHub.",
  "focus.issueDraft.create": "Demander la création du ticket",
  "focus.issueDraft.waiting": "En attente de votre approbation dans Approbations…",
  "focus.issueDraft.denied": "Vous avez refusé ; rien n’a été envoyé à GitHub.",
  "focus.issueDraft.blocked": "L’arrêt d’urgence est activé ; rien n’a été envoyé à GitHub.",
  "focus.issueDraft.timeout":
    "La demande n’a pas été approuvée à temps ou a été annulée ; rien n’a été envoyé.",
  "focus.issueDraft.failed": "Le ticket n’a pas pu être créé : {message}",
};
