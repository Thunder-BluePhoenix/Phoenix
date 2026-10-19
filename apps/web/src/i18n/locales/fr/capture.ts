// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { capture as encapture } from "../../en/capture";

/** Machine-translated; unreviewed (see ../../README.md). */
export const capture: Record<keyof typeof encapture, string> = {
  // Shared audio/mic
  "capture.audio.connectionFailed": "La connexion audio a échoué.",
  "capture.audio.connectionClosed": "La connexion audio s’est fermée.",
  "capture.audio.invalidReply": "Réponse non valide de Core.",
  "capture.audio.micUnavailable": "Microphone indisponible : {reason}",
  "capture.audio.waitingForPermission": "En attente de l’autorisation du microphone…",
  "capture.audio.coreNotConnected": "Phoenix Core n’est pas connecté.",
  "capture.audio.emergencyStop": "L’arrêt d’urgence est activé.",
  "capture.audio.recognizerAvailable": "Moteur de reconnaissance vocale : disponible. {detail}",
  "capture.audio.recognizerUnavailable": "Moteur de reconnaissance vocale : indisponible. {detail}",
  "capture.mic.unsupported": "Ce navigateur ne peut pas utiliser de microphone",
  "capture.mic.sampleRate": "Cet appareil ne peut pas fournir un son de microphone à 16 kHz",
  "capture.notetaker.settings.title": "Prise de notes",
  "capture.notetaker.settings.savedOn": "La prise de notes est activée.",
  "capture.notetaker.settings.savedOff": "La prise de notes est désactivée.",
  "capture.notetaker.settings.intro":
    "La prise de notes enregistre un appel sur cet ordinateur, sans bot, et le transforme en transcription, en résumé et en tâches à relire. Elle est {off} tant que vous ne l’activez pas ici. L’activer ne vaut {not} consentement à enregistrer qui que ce soit : chaque enregistrement vous le redemande.",
  "capture.notetaker.settings.introOff": "désactivée",
  "capture.notetaker.settings.introNot": "pas",
  "capture.notetaker.settings.audio.lead": "L’audio n’est jamais stocké.",
  "capture.notetaker.settings.audio.body":
    "Il reste uniquement en mémoire, est converti en texte par petits morceaux sur cet appareil, puis effacé dès que chaque morceau est traité ou que l’enregistrement s’arrête.",
  "capture.notetaker.settings.kept.lead": "Ce qui est conservé :",
  "capture.notetaker.settings.kept.body":
    "la transcription, rédigée au fil de l’appel, et un résumé produit par un modèle sur cet appareil. Si aucun modèle ne répond, vous obtenez la transcription sans résumé.",
  "capture.notetaker.settings.speakers.lead": "Interlocuteurs :",
  "capture.notetaker.settings.speakers.body":
    "seulement « Vous » et « Les autres ». Phoenix ne distingue pas les autres personnes entre elles.",
  "capture.notetaker.settings.captured.lead": "Ce qui est capturé :",
  "capture.notetaker.settings.banner":
    "Fawkes affiche « Enregistrement » dans chaque vue, ainsi qu’un bouton Arrêter, pendant tout l’enregistrement.",
  "capture.notetaker.settings.toggle": "Activer la prise de notes",
  "capture.notetaker.settings.killSwitch":
    "L’arrêt d’urgence est activé : l’enregistrement est bloqué.",
  "capture.notetaker.banner.title": "Enregistrement d’un appel",
  "capture.notetaker.banner.stop": "Arrêter l’enregistrement",
  "capture.notetaker.banner.stopping": "Arrêt…",
  "capture.notetaker.micOnly":
    "Seul votre microphone est enregistré ; les autres participants ne sont pas capturés.",
  "capture.notetaker.consent.title": "Avant d’enregistrer",
  "capture.notetaker.consent.notice":
    "Prévenez tous les participants de l’appel qu’il est enregistré. Enregistrer sans consentement peut être illégal là où vous ou eux vivez.",
  "capture.notetaker.consent.checkbox":
    "J’ai prévenu tous les participants de l’appel qu’il est enregistré",
  "capture.notetaker.consent.titleField": "Titre {optional}",
  "capture.notetaker.consent.optional": "(facultatif)",
  "capture.notetaker.consent.start": "Démarrer l’enregistrement",
  "capture.notetaker.blocked.unavailable": "L’état de la prise de notes n’est pas disponible.",
  "capture.notetaker.blocked.off":
    "La prise de notes est désactivée. Activez-la dans Paramètres, sous Prise de notes.",
  "capture.notetaker.blocked.noConsentChannel":
    "L’enregistrement nécessite un moyen fiable de vous demander d’abord votre accord. {detail}",
  "capture.notetaker.blocked.inProgress": "Un enregistrement est déjà en cours.",
  "capture.notetaker.record.title": "Enregistrer un appel",
  "capture.notetaker.record.intro":
    "Enregistre le microphone de cet ordinateur, sans bot. L’audio n’est jamais stocké ; vous obtenez une transcription et, si un modèle sur cet appareil répond, un résumé.",
  "capture.notetaker.record.saved": "L’enregistrement a été sauvegardé.",
  "capture.notetaker.record.openMeeting": "Ouvrir la réunion",
  "capture.notetaker.recorder.stopped":
    "L’enregistrement s’est arrêté. Ce qui a été transcrit jusque-là est sauvegardé.",
  "capture.notetaker.recorder.stoppedWithReason":
    "L’enregistrement s’est arrêté : {reason}. Ce qui a été transcrit jusque-là est sauvegardé.",
  "capture.voice.phase.idle": "La voix est désactivée",
  "capture.voice.phase.starting": "Démarrage du microphone…",
  "capture.voice.phase.waiting": "En attente de « OK Fawkes »",
  "capture.voice.phase.awake": "Fawkes écoute votre demande",
  "capture.voice.phase.thinking": "Traitement de votre demande…",
  "capture.voice.banner.label": "Assistant vocal",
  "capture.voice.banner.live": "Microphone activé. {phase}.",
  "capture.voice.banner.stop": "Arrêter l’écoute",
  "capture.voice.banner.fawkes": "Fawkes :",
  "capture.voice.banner.openDraft": "Ouvrir le brouillon d’e-mail",
  "capture.voice.blocked.unavailable": "L’état de l’assistant vocal n’est pas disponible.",
  "capture.voice.blocked.off":
    "L’assistant vocal est désactivé. Activez-le dans Paramètres, sous Voix.",
  "capture.voice.reason.stopped": "La voix s’est arrêtée.",
  "capture.voice.reason.disabled": "La voix a été désactivée.",
  "capture.voice.reason.killSwitch": "Voix arrêtée : l’arrêt d’urgence est activé.",
  "capture.voice.reason.badFrame": "Voix arrêtée : le microphone a envoyé un audio non valide.",
  "capture.voice.reason.tooFast": "Voix arrêtée : le microphone a envoyé l’audio trop vite.",
  "capture.voice.reason.connectionClosed": "Voix arrêtée : la connexion s’est fermée.",
  "capture.voice.reason.streamNotOpened": "Voix arrêtée : le microphone n’a pas démarré à temps.",
  "capture.voice.reason.recogniserFailed": "Voix arrêtée : la reconnaissance vocale a échoué.",
  "capture.voice.reason.shutdown": "Voix arrêtée : Phoenix Core s’arrête.",
  "capture.voice.reason.refused": "Voix arrêtée : Core a refusé l’audio.",
  "capture.voice.micCouldNotStart": "Le microphone n’a pas pu démarrer : {reason}",
  "capture.voice.settings.titleShort": "Voix",
  "capture.voice.settings.title": "Voix (« OK Fawkes »)",
  "capture.voice.settings.unavailable":
    "Les paramètres de la voix ne sont pas disponibles auprès de Phoenix Core.",
  "capture.voice.settings.savedOn": "La voix est activée.",
  "capture.voice.settings.savedOff": "La voix est désactivée. Le microphone a été libéré.",
  "capture.voice.settings.intro":
    "Dites « OK Fawkes » et posez des questions sur vos services. La voix est {off} tant que vous ne l’activez pas ici, et l’activer vaut consentement pour la voix uniquement.",
  "capture.voice.settings.introOff": "désactivée",
  "capture.voice.settings.whileOn.lead": "Quand elle est activée :",
  "capture.voice.settings.whileOn.body":
    "cette page garde votre microphone ouvert et affiche « Microphone activé » en permanence. Un simple contrôle du volume s’exécute sur cet appareil pour chaque instant sonore ; ce n’est que lorsque quelqu’un parle qu’un court extrait est confié au moteur de reconnaissance vocale de cet appareil.",
  "capture.voice.settings.leaves.lead": "Ce qui quitte cet appareil :",
  "capture.voice.settings.leaves.body":
    "rien. La reconnaissance est locale ; il n’existe aucun chemin vocal vers le cloud. Phoenix ne produit aucun son : les réponses sont lues à voix haute par votre navigateur, quand il le peut.",
  "capture.voice.settings.kept.lead": "Ce qui est conservé :",
  "capture.voice.settings.kept.body":
    "l’audio reste en mémoire quelques secondes et est effacé une fois compris, quand vous arrêtez, ou quand l’arrêt d’urgence est utilisé. Il n’est jamais écrit sur le disque et aucune transcription n’est stockée. Le journal d’audit indique qu’une demande a eu lieu et quel outil elle a utilisé, jamais ce que vous avez dit.",
  "capture.voice.settings.canDo.lead": "Ce qu’elle peut faire :",
  "capture.voice.settings.canDo.body":
    "lire l’état des services que vous avez activés, ouvrir la pastille et préparer un brouillon d’e-mail que vous relisez. Elle ne peut rien modifier et ne peut jamais approuver une action : vous seul le pouvez, dans le panneau de la mascotte. Elle peut dire « deny ».",
  "capture.voice.settings.limits.lead": "Limites :",
  "capture.voice.settings.limits.body":
    "la phrase d’activation est détectée en transcrivant de courts extraits de parole (ce n’est pas un détecteur de mot-clé dédié) ; elle peut donc être manquée, ou des mots proches peuvent être mal compris.",
  "capture.voice.settings.toggle": "Activer « OK Fawkes »",
  "capture.voice.settings.killSwitch": "L’arrêt d’urgence est activé : la voix est bloquée.",
  "capture.voice.settings.notListening":
    "La voix est activée, mais cette page n’écoute pas encore (après un rechargement, le navigateur redemande l’autorisation).",
  "capture.voice.settings.start": "Démarrer l’écoute",
  "capture.multimodal.title": "Capture ponctuelle depuis un appareil",
  "capture.multimodal.intro":
    "Demandé par : l’utilisateur. Core vérifie votre autorisation de capacité et demande une approbation pour chaque usage avant que votre navigateur ne demande l’accès à l’appareil. Rien ne capture en arrière-plan ; aucun repli vers le cloud.",
  "capture.multimodal.statusUnavailable": "L’état de capture de Core n’est pas disponible.",
  "capture.multimodal.killSwitch": "Capture indisponible : arrêt d’urgence activé.",
  "capture.multimodal.kind.microphone": "Microphone · une seconde d’audio WAV",
  "capture.multimodal.kind.screen": "Écran · une image PNG",
  "capture.multimodal.modality":
    "{label}. Modèle : {model} ; fournisseur : {provider} ; localité : {locality}. {detail}",
  "capture.multimodal.notReported": "non communiqué par Core",
  "capture.multimodal.modalityUnavailable": "indisponible",
  "capture.multimodal.statusPending": "État pas encore disponible.",
  "capture.multimodal.grant.microphone":
    "L’autorisation de capacité du microphone n’est pas disponible ; activez-la sous Capacités avant la capture.",
  "capture.multimodal.grant.screen":
    "L’autorisation de capacité de l’écran n’est pas disponible ; activez-la sous Capacités avant la capture.",
  "capture.multimodal.capture.microphone": "Capturer le microphone",
  "capture.multimodal.capture.screen": "Capturer l’écran",
  "capture.multimodal.stop": "Arrêter la capture",
  "capture.multimodal.phase.waitingApproval":
    "En attente de l’approbation de Core. Examinez la demande ci-dessous ; aucun appareil n’est encore actif.",
  "capture.multimodal.phase.approvedMicrophone":
    "Core a approuvé. Demande d’accès au microphone pour une seconde.",
  "capture.multimodal.phase.approvedScreen": "Core a approuvé. Demande d’une image de l’écran.",
  "capture.multimodal.phase.processing": "Traitement en local ; l’appareil est arrêté.",
  "capture.multimodal.error.connectionUnavailable": "Connexion de capture indisponible.",
  "capture.multimodal.error.invalidResponse": "Réponse de capture de Core non valide.",
  "capture.multimodal.error.browserUnavailable":
    "La capture par le navigateur n’est pas disponible.",
  "capture.multimodal.error.frameSize": "La capture dépasse la taille d’image autorisée.",
  "capture.multimodal.error.deviceDenied": "Accès à l’appareil refusé par le navigateur.",
  "capture.multimodal.error.invalidResult":
    "Core a renvoyé un résultat de capture locale non valide.",
  "capture.multimodal.error.refused": "Core a refusé la capture.",
  "capture.multimodal.error.unexpected": "Réponse de capture de Core inattendue.",
  "capture.multimodal.error.connectionFailed": "La connexion de capture a échoué.",
  "capture.multimodal.error.ended": "La capture s’est terminée sans résultat ni approbation.",
  "capture.multimodal.result.heading": "{what} · {provider} ({locality})",
  "capture.multimodal.result.transcript": "Transcription",
  "capture.multimodal.result.screen": "Description de l’écran",
  "capture.multimodal.result.clear": "Effacer le résultat",

  // Dictation and the pill
  "capture.dictation.mode.asSaid": "Tel que dit (sans nettoyage)",
  "capture.dictation.mode.natural": "Naturel (sans les tics de langage)",
  "capture.dictation.mode.polished": "Soigné (grammaire corrigée aussi)",
  "capture.dictation.duration.minutesSeconds": "{minutes} min {seconds} s",
  "capture.dictation.duration.seconds": "{seconds} s",
  "capture.dictation.blocked.statusUnavailable": "L’état de la dictée n’est pas disponible.",
  "capture.dictation.blocked.off":
    "La dictée est désactivée. Activez-la dans Paramètres, sous Dictée.",
  "capture.dictation.stopped.plain": "Dictée arrêtée.",
  "capture.dictation.stopped.reason": "Dictée arrêtée : {reason}.",
  "capture.dictation.nothingRecognised": "Rien n’a été reconnu.",
  "capture.dictation.button.start": "Dicter",
  "capture.dictation.button.starting": "Démarrage…",
  "capture.dictation.button.recognising": "Reconnaissance…",
  "capture.dictation.button.stop": "Arrêter la dictée",
  "capture.dictation.button.cancel": "Annuler la dictée",
  "capture.dictation.hint":
    "N’utilise votre microphone que pendant la dictée ; l’audio n’est pas stocké.",
  "capture.dictation.indicator.listening": "À l’écoute : votre microphone est activé.",
  "capture.dictation.settings.title": "Dictée",
  "capture.dictation.settings.unavailable":
    "Les paramètres de la dictée ne sont pas disponibles auprès de Phoenix Core.",
  "capture.dictation.settings.intro":
    "La dictée transforme votre voix en texte sur cet appareil. Elle est {off} tant que vous ne l’activez pas ici, et l’activer vaut consentement pour la dictée uniquement.",
  "capture.dictation.settings.intro.off": "désactivée",
  "capture.dictation.settings.enable": "Activer la dictée",
  "capture.dictation.privacy.leaves.lead": "Ce qui quitte cet appareil :",
  "capture.dictation.privacy.leaves.body":
    "rien. La parole est reconnue sur cet appareil ; le nettoyage facultatif utilise uniquement un modèle sur cet appareil et n’est jamais envoyé à un fournisseur cloud, même si vous avez autorisé l’IA cloud pour d’autres usages.",
  "capture.dictation.privacy.memory.lead": "Ce qui reste en mémoire :",
  "capture.dictation.privacy.memory.body":
    "l’audio, pendant la durée d’une dictée (au plus {seconds, plural, one {# seconde} many {# de secondes} other {# secondes}}). Il n’est jamais écrit sur le disque et est effacé quand la dictée se termine, est annulée, ou que l’arrêt d’urgence est utilisé.",
  "capture.dictation.privacy.stored.lead": "Ce qui est stocké :",
  "capture.dictation.privacy.stored.body":
    "vos paramètres et les listes de mots ci-dessous, ainsi que des compteurs par jour et par application (mots, temps de parole, nombre de dictées). Jamais le texte dicté, jamais l’audio.",
  "capture.dictation.privacy.microphone":
    "Le microphone n’est activé que pendant la dictée, et Fawkes affiche « À l’écoute » en permanence.",
  "capture.dictation.killSwitch": "L’arrêt d’urgence est activé : la dictée est bloquée.",
  "capture.dictation.saved.on": "La dictée est activée.",
  "capture.dictation.saved.off": "La dictée est désactivée.",
  "capture.dictation.saved.defaultMode": "Nettoyage par défaut enregistré.",
  "capture.dictation.saved.appModes": "Modes de nettoyage par application enregistrés.",
  "capture.dictation.saved.typing": "Vitesse de frappe enregistrée.",
  "capture.dictation.saved.vocabulary": "Listes de mots enregistrées.",
  "capture.dictation.saved.statsDeleted": "Toutes les statistiques de dictée ont été supprimées.",
  "capture.dictation.cleanup.heading": "Nettoyage",
  "capture.dictation.cleanup.default": "Nettoyage par défaut",
  "capture.dictation.typing.heading": "Vitesse de frappe",
  "capture.dictation.typing.label": "À quelle vitesse tapez-vous ? (mots par minute)",
  "capture.dictation.typing.save": "Enregistrer la vitesse de frappe",
  "capture.dictation.typing.invalid": "Saisissez un nombre entier de {min} à {max}.",
  "capture.dictation.appModes.summary":
    "Nettoyage par application ({count} sur {max}). Une application non listée utilise le mode par défaut.",
  "capture.dictation.appModes.entry": "{app} : {mode}",
  "capture.dictation.appModes.remove": "Retirer {app}",
  "capture.dictation.appModes.idLabel": "Identifiant de l’application (par exemple un bundle id)",
  "capture.dictation.appModes.modeLabel": "Nettoyage pour cette application",
  "capture.dictation.appModes.set": "Définir le nettoyage de l’application",
  "capture.dictation.appModes.invalid":
    "Utilisez des lettres, des chiffres, le point, le tiret ou le tiret bas (au plus {max}).",
  "capture.dictation.problem.plainWords":
    "Utilisez des mots simples séparés par des espaces simples (sans ponctuation).",
  "capture.dictation.problem.maxChars":
    "{n, plural, one {# caractère au maximum.} many {# de caractères au maximum.} other {# caractères au maximum.}}",
  "capture.dictation.problem.maxWords":
    "{n, plural, one {# mot au maximum.} many {# de mots au maximum.} other {# mots au maximum.}}",
  "capture.dictation.problem.term":
    "{n, plural, one {Jusqu’à # caractère visible, sans espace aux extrémités.} many {Jusqu’à # de caractères visibles, sans espace aux extrémités.} other {Jusqu’à # caractères visibles, sans espace aux extrémités.}}",
  "capture.dictation.problem.soundsLike":
    "« Se prononce comme » est requis quand le terme n’est pas composé de mots simples : {problem}",
  "capture.dictation.problem.replacement":
    "{n, plural, one {Jusqu’à # caractère visible.} many {Jusqu’à # de caractères visibles.} other {Jusqu’à # caractères visibles.}}",
  "capture.dictation.problem.snippet":
    "{n, plural, one {Jusqu’à # caractère ; pas de caractères de contrôle ou cachés.} many {Jusqu’à # de caractères ; pas de caractères de contrôle ou cachés.} other {Jusqu’à # caractères ; pas de caractères de contrôle ou cachés.}}",
  "capture.dictation.vocabulary.heading": "Dictionnaire, remplacements et extraits",
  "capture.dictation.vocabulary.intro":
    "Tout ce qui figure ici est du texte littéral : il n’y a pas de motifs. La correspondance ignore les majuscules et minuscules et porte sur des mots entiers.",
  "capture.dictation.vocabulary.save": "Enregistrer les listes de mots",
  "capture.dictation.dictionary.heading": "Dictionnaire ({count} sur {max})",
  "capture.dictation.dictionary.intro": "Écrivez un nom ou un terme comme vous le souhaitez.",
  "capture.dictation.dictionary.entry": "« {soundsLike} » → {term}",
  "capture.dictation.dictionary.remove": "Retirer l’entrée de dictionnaire {term}",
  "capture.dictation.dictionary.term": "Terme",
  "capture.dictation.dictionary.soundsLike": "Se prononce comme (facultatif)",
  "capture.dictation.dictionary.add": "Ajouter une entrée au dictionnaire",
  "capture.dictation.replacements.heading": "Remplacements ({count} sur {max})",
  "capture.dictation.replacements.entry": "« {from} » → « {to} »",
  "capture.dictation.replacements.entryRemoved": "« {from} » → (supprimé)",
  "capture.dictation.replacements.remove": "Retirer le remplacement {from}",
  "capture.dictation.replacements.from": "Remplacer les mots",
  "capture.dictation.replacements.to": "Par (vide : les supprime)",
  "capture.dictation.replacements.add": "Ajouter un remplacement",
  "capture.dictation.snippets.heading": "Extraits ({count} sur {max})",
  "capture.dictation.snippets.intro":
    "Un extrait ne se déploie que lorsque la dictée entière correspond exactement à son déclencheur.",
  "capture.dictation.snippets.entry": "« {trigger} » → {text}",
  "capture.dictation.snippets.remove": "Retirer l’extrait {trigger}",
  "capture.dictation.snippets.trigger": "Quand je dis",
  "capture.dictation.snippets.text": "Insérer ce texte",
  "capture.dictation.snippets.add": "Ajouter un extrait",
  "capture.dictation.stats.heading": "Statistiques",
  "capture.dictation.stats.none": "Aucune dictée pour l’instant.",
  "capture.dictation.stats.words": "Mots dictés",
  "capture.dictation.stats.sessions": "Dictées",
  "capture.dictation.stats.saved": "Temps gagné",
  "capture.dictation.stats.savedValue":
    "{duration} (en tapant à {wpm, plural, one {# mot par minute} many {# de mots par minute} other {# mots par minute}})",
  "capture.dictation.stats.average": "Vitesse de parole moyenne",
  "capture.dictation.stats.wordsPerMinute":
    "{n, plural, one {# mot par minute} many {# de mots par minute} other {# mots par minute}}",
  "capture.dictation.stats.streak": "Série",
  "capture.dictation.stats.days": "{n, plural, one {# jour} many {# de jours} other {# jours}}",
  "capture.dictation.stats.topApps": "Applications les plus utilisées",
  "capture.dictation.stats.noApps": "aucune",
  "capture.dictation.stats.unknownApp": "application inconnue",
  "capture.dictation.stats.appWords":
    "{app} ({n, plural, one {# mot} many {# de mots} other {# mots}})",
  "capture.dictation.stats.note":
    "Il s’agit uniquement de compteurs. Les noms d’applications vous restent privés et ne sont envoyés nulle part. Core les conserve jusqu’à ce que vous les supprimiez.",
  "capture.dictation.stats.confirmGroup": "Confirmer la suppression des statistiques",
  "capture.dictation.stats.confirmText":
    "Supprimer toutes les statistiques de dictée ? Cette action est irréversible.",
  "capture.dictation.stats.confirmYes": "Oui, tout supprimer",
  "capture.dictation.stats.confirmKeep": "Les conserver",
  "capture.dictation.stats.delete": "Supprimer toutes les statistiques de dictée",
  "capture.pill.waiting": "En attente du microphone…",
  "capture.pill.listening": "À l’écoute : votre microphone est activé",
  "capture.pill.recognising": "Reconnaissance…",
  "capture.pill.ready": "Prêt",
  "capture.pill.stop": "Arrêter",
  "capture.pill.recordCall": "Enregistrer un appel",
  "capture.pill.recordCall.title":
    "Enregistrer un appel : ouvre l’enregistreur d’appels dans Phoenix",
  "capture.pill.openPhoenix": "Ouvrir Phoenix",
  "capture.pill.pasteFailed": "Le texte n’a pas pu être collé.",
  "capture.pill.outcome.typed": "Saisi",
  "capture.pill.outcome.pasted": "Collé",

  // Attachments, chat, answers, retrieval
  "capture.attachments.kind.text": "Texte",
  "capture.attachments.kind.image": "Image",
  "capture.attachments.kind.folder": "Dossier",
  "capture.attachments.origin.drop": "déposé",
  "capture.attachments.origin.window": "fenêtre",
  "capture.attachments.origin.paste": "collé",
  "capture.attachments.localOnly": "Local uniquement",
  "capture.attachments.dropZone.label": "Déposer des fichiers sur {label}",
  "capture.attachments.dropZone.over": "Déposez pour joindre.",
  "capture.attachments.dropZone.hint":
    "Déposez ici des fichiers texte, des images PNG/JPEG ou un dossier, ou {attach} Joindre n’envoie rien.",
  "capture.attachments.dropZone.attachFiles": "joignez des fichiers…",
  "capture.attachments.dropZone.choose": "Choisir des fichiers à joindre",
  "capture.attachments.dropZone.reading": "Lecture de ce que vous avez déposé…",
  "capture.attachments.preview.imageAlt": "Aperçu de {name}",
  "capture.attachments.preview.listingBroken": "La liste enregistrée ne peut pas être affichée.",
  "capture.attachments.preview.filesIn": "Fichiers dans {name}",
  "capture.attachments.preview.contentsOf": "Contenu de {name}",
  "capture.attachments.chip.include": "Inclure {name} dans la question",
  "capture.attachments.chip.meta": "{kind} · {size} · {origin}",
  "capture.attachments.chip.metaFiles":
    "{kind}, {files, plural, one {# fichier} many {# de fichiers} other {# fichiers}} · {size} · {origin}",
  "capture.attachments.chip.previewLabel": "Aperçu de {name}",
  "capture.attachments.chip.removeLabel": "Retirer {name}",
  "capture.attachments.chip.preview": "Aperçu",
  "capture.attachments.chip.hide": "Masquer",
  "capture.attachments.tray.label": "Pièces jointes",
  "capture.attachments.tray.heading": "Pièces jointes ({n})",
  "capture.attachments.tray.localOnlyTitle":
    "Les fichiers joints ne sont lus que par un modèle sur cet appareil",
  "capture.attachments.tray.clearAll": "Tout effacer",
  "capture.attachments.tray.noteTicked":
    "Conservées uniquement dans la mémoire de Phoenix Core (jamais enregistrées sur le disque) pendant {minutes, plural, one {# minute} many {# de minutes} other {# minutes}} au maximum. Le bouton « Interroger sur les pièces jointes » envoie {n, plural, one {l’élément coché} many {les # d’éléments cochés} other {les # éléments cochés}}, en entier, à un modèle sur cet appareil. Rien ne quitte cet appareil.",
  "capture.attachments.tray.noteNone":
    "Conservées uniquement dans la mémoire de Phoenix Core (jamais enregistrées sur le disque) pendant {minutes, plural, one {# minute} many {# de minutes} other {# minutes}} au maximum. Rien n’est envoyé tant que vous ne posez pas de question.",
  "capture.attachments.tray.tooMany":
    "Une question peut utiliser au plus {max, plural, one {# élément} many {# d’éléments} other {# éléments}}. Décochez-en {n} pour poser la question.",
  "capture.attachments.draft.open": "Rédiger un e-mail",
  "capture.attachments.draft.to": "À (facultatif)",
  "capture.attachments.draft.message": "Message (ce texte exact figurera dans le brouillon)",
  "capture.attachments.draft.count":
    "{n} / {max} caractères. Ouvre votre application de messagerie avec un brouillon. Phoenix ne l’envoie pas.",
  "capture.attachments.draft.submit": "Ouvrir le brouillon",
  "capture.attachments.draft.openFailed": "Impossible d’ouvrir votre application de messagerie.",
  "capture.attachments.answer.local": "gratuit, sur cet appareil",
  "capture.attachments.answer.cloud": "cloud",
  "capture.attachments.answer.processed": "Traité par {by} · {where}",
  "capture.attachments.answer.processedVision":
    "Traité par {by} · images lues par {vision} sur cet appareil · {where}",
  "capture.attachments.answer.from": "D’après : {names}. Texte généré, pas un fait enregistré.",
  "capture.attachments.fawkesDrop.heading": "Donnez un fichier à Fawkes",
  "capture.attachments.fawkesDrop.hint":
    "Déposez un fichier, une image ou un dossier sur Fawkes, puis posez vos questions dans l’onglet Discussion.",
  "capture.attachments.fawkesDrop.count": "Pièces jointes : {n}.",
  "capture.attachments.file.badName":
    "{name} : le nom est vide, trop long ou contient des caractères cachés",
  "capture.attachments.file.imageTooBig": "{name} : une image ne peut pas dépasser 5 MiB",
  "capture.attachments.file.unreadable": "{name} : le fichier n’a pas pu être lu",
  "capture.attachments.file.unsupported":
    "{name} : type non pris en charge (fichiers texte, images PNG/JPEG ou dossier)",
  "capture.attachments.file.tooLargeBytes":
    "{name} : trop volumineux (un fichier texte peut contenir au plus {max} caractères)",
  "capture.attachments.file.empty": "{name} : le fichier est vide",
  "capture.attachments.file.tooLarge":
    "{name} : trop volumineux ({chars} caractères ; la limite est de {max})",
  "capture.attachments.skip.unreadableFolder": "{label} : dossiers illisibles ignorés : {n}",
  "capture.attachments.skip.unusualName": "{label} : entrées au nom inhabituel ignorées : {n}",
  "capture.attachments.skip.hidden":
    "{label} : fichiers et dossiers cachés ignorés (noms commençant par un point, node_modules, .git) : {n}",
  "capture.attachments.skip.longPath":
    "{label} : entrées dont le chemin dépasse {pathChars} caractères ignorées : {n}",
  "capture.attachments.skip.tooDeep":
    "{label} : dossiers imbriqués à plus de {depth} niveaux ignorés : {n}",
  "capture.attachments.skip.special":
    "{label} : entrées qui ne sont ni un fichier ni un dossier ignorées : {n}",
  "capture.attachments.skip.unreadableFile": "{label} : fichiers illisibles ignorés : {n}",
  "capture.attachments.skip.longText":
    "{label} : fichiers texte trop longs pour être inclus ignorés (listés sans contenu) : {n}",
  "capture.attachments.folder.capped": "{label} : seuls les {max} premiers fichiers ont été listés",
  "capture.attachments.folder.noFiles": "{label} : aucun fichier lisible n’a été trouvé",
  "capture.attachments.folder.badName": "{label} : le nom du dossier est inutilisable",
  "capture.attachments.notice.uploadFailed": "{name} : {reason}",
  "capture.attachments.notice.attached":
    "{n, plural, one {# élément joint} many {# d’éléments joints} other {# éléments joints}}. Rien n’a encore été envoyé nulle part.",
  "capture.attachments.notice.nothingAttached": "Rien n’a été joint.",
  "capture.attachments.notice.withProblems": "{head} {problems}",
  "capture.attachments.mail.subject": "À propos de : {name}",
  "capture.attachments.mail.empty": "Écrivez d’abord ce que vous voulez partager.",
  "capture.attachments.mail.tooLong":
    "Le message dépasse de {over} caractères la limite de {limit}. Raccourcissez-le.",
  "capture.attachments.mail.badAddress":
    "Saisissez une seule adresse e-mail, ou laissez le destinataire vide.",
  "capture.attachments.mail.urlTooLong":
    "Les liens de messagerie aussi longs ne sont pas fiables ({length} sur {limit} caractères une fois encodés). Raccourcissez le message.",
  "capture.chat.ciForm.badRepository":
    "Saisissez le dépôt sous la forme « propriétaire/nom », par exemple « acme/app ».",
  "capture.chat.ciForm.badRunId":
    "L’identifiant d’exécution doit être un entier positif, ou rester vide pour la dernière exécution en échec.",
  "capture.chat.ciForm.label": "Diagnostiquer un échec de CI",
  "capture.chat.ciForm.intro":
    "Fawkes lira l’exécution GitHub Actions en échec et votre historique git local. Il ne modifie rien.",
  "capture.chat.ciForm.repository": "Dépôt (propriétaire/nom)",
  "capture.chat.ciForm.runId":
    "Identifiant d’exécution (facultatif ; vide : la dernière exécution en échec)",
  "capture.chat.ciForm.start": "Lancer le diagnostic",
  "capture.chat.who.you": "Vous",
  "capture.chat.status": "Fawkes : {state}.",
  "capture.chat.intro":
    "Demandez à Fawkes ce dont il se souvient. Les réponses listent d’abord les faits enregistrés avec leurs sources ; tout ce qui est généré est signalé. Cette conversation est conservée dans cette page uniquement et disparaît au rechargement.",
  "capture.chat.empty": "Aucun message pour l’instant.",
  "capture.chat.conversation": "Conversation",
  "capture.chat.waiting": "En attente de la réponse de Phoenix Core…",
  "capture.chat.dropLabel": "la zone de discussion",
  "capture.chat.message": "Message à Fawkes",
  "capture.chat.count":
    "{n} / {max} caractères · Entrée envoie, Maj+Entrée insère un retour à la ligne",
  "capture.chat.send": "Envoyer",
  "capture.chat.sending": "Envoi…",
  "capture.chat.askAttachments": "Interroger sur les pièces jointes",
  "capture.chat.askAttachmentsNone": "Joignez d’abord quelque chose, ou cochez une pièce jointe",
  "capture.chat.askAttachmentsTitle":
    "Envoie votre question et les pièces jointes cochées à un modèle sur cet appareil",
  "capture.chat.diagnose": "Diagnostiquer un échec de CI",
  "capture.chat.automationOff":
    "L’automatisation est désactivée : Fawkes ne peut pas lancer de tâches. Activez-la dans Paramètres, sous Automatisation.",
  "capture.chat.attachmentQuestion": "{text}\n(à propos de : {names})",
  "capture.chat.error.askMemory": "Échec de l’interrogation de la mémoire : {reason}.",
  "capture.chat.error.askAttachments":
    "Échec de l’interrogation sur les pièces jointes : {reason}.",
  "capture.chat.error.automationOff":
    "L’automatisation est désactivée : aucune tâche n’a été lancée. Activez-la dans Paramètres, sous Automatisation.",
  "capture.chat.error.startTask": "Impossible de lancer la tâche : {reason}.",
  "capture.chat.ciUser.latest":
    "Diagnostiquer un échec de CI dans {repository} (dernière exécution en échec)",
  "capture.chat.ciUser.run": "Diagnostiquer un échec de CI dans {repository} (exécution {run})",
  "capture.answer.sensitivity.public": "Public",
  "capture.answer.sensitivity.internal": "Interne",
  "capture.answer.sensitivity.sensitive": "Sensible",
  "capture.answer.classification.storedFact": "Fait enregistré",
  "capture.answer.classification.retrievedEvidence": "Élément récupéré, pas un fait affirmé",
  "capture.answer.classification.storedInterpretation": "Interprétation enregistrée, pas un fait",
  "capture.answer.freshness.stale": "Observation périmée",
  "capture.answer.freshness.fresh": "Observation récente",
  "capture.answer.confidenceUnknown": "inconnue",
  "capture.answer.record":
    "{classification} · id de source {id} · {domain} · de {source}{ref} · observé le {observed} · {sensitivity} · {freshness} · confiance {confidence}",
  "capture.answer.attribution.whereLocal": "sur cet appareil",
  "capture.answer.attribution.whereCloud": "dans le cloud (quitte cet appareil)",
  "capture.answer.attribution.costUnknown": "coût inconnu",
  "capture.answer.attribution.costFree": "gratuit, sur cet appareil",
  "capture.answer.attribution.costAbout": "environ ${amount} (selon vos tarifs)",
  "capture.answer.attribution.defaultModel": "son modèle par défaut",
  "capture.answer.attribution.line": "Réponse de {model} via {provider} · {where} · {cost}",
  "capture.answer.facts.heading": "Faits enregistrés",
  "capture.answer.facts.empty": "Aucun fait enregistré ne correspond à votre question.",
  "capture.answer.evidence.heading": "Éléments récupérés (pas des faits enregistrés)",
  "capture.answer.evidence.empty": "Aucun élément récupéré ne correspond.",
  "capture.answer.interpretations.heading":
    "Interprétations enregistrées précédentes (pas des faits)",
  "capture.answer.interpretations.empty": "Aucune interprétation précédente ne correspond.",
  "capture.answer.hypothesis.heading": "Hypothèse générée",
  "capture.answer.hypothesis.label":
    "Hypothèse générée par {by}, pas un fait enregistré ni une conclusion établie.",
  "capture.answer.hypothesis.anAiModel": "un modèle d’IA",
  "capture.answer.hypothesis.noInterpretation":
    "L’IA a été utilisée mais n’a donné aucune interprétation.",
  "capture.answer.hypothesis.noAi": "Aucune IA n’a été utilisée.",
  "capture.retrieval.hybrid": "Trouvé par mots-clés et par sens (recherche intelligente).",
  "capture.retrieval.keywordsOnly": "Trouvé par mots-clés uniquement.",
  "capture.retrieval.notUsed": "La recherche intelligente n’a pas été utilisée : {reason}.",
  "capture.retrieval.skipped.aiDisabled": "l’IA est désactivée",
  "capture.retrieval.truncated":
    "Les souvenirs les plus anciens ont été laissés de côté pour que la recherche reste rapide.",
};
