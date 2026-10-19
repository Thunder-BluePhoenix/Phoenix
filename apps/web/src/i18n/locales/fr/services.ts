// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { services as enservices } from "../../en/services";

/** Machine-translated; unreviewed (see ../../README.md). */
export const services: Record<keyof typeof enservices, string> = {
  "services.common.notYetLoaded": "Pas encore chargé.",

  "services.overview.nothingRunning": "Rien en cours.",
  "services.overview.taskProgress": "Progression : {title}",
  "services.overview.showFewer": "Afficher moins",
  "services.overview.showAll":
    "{count, plural, one {Afficher # tâche} other {Afficher les # tâches}}",
  "services.overview.stateFor": "depuis {since}",
  "services.overview.recordingActive": "L’enregistrement est actif.",
  "services.overview.activeTasks": "Tâches actives",
  "services.overview.quickActions": "Actions rapides",
  "services.overview.dismissErrors": "Ignorer les erreurs",
  "services.overview.wake": "Réveiller Fawkes",
  "services.overview.pause": "Mettre Fawkes en pause",
  "services.overview.releaseStop": "Lever l’arrêt d’urgence",
  "services.overview.confirmStop": "Confirmer : arrêter toutes les capacités",
  "services.overview.emergencyStop": "Arrêt d’urgence",
  "services.overview.stopOn":
    "L’arrêt d’urgence est activé : toutes les capacités sont désactivées et les actions sont bloquées.",

  "services.integrations.agents.title": "Agents de code",
  "services.integrations.agents.empty": "Aucun agent de code ne s’est encore manifesté.",
  "services.integrations.agents.stateReason": "{state} ({reason})",
  "services.integrations.agents.state.started": "Démarré",
  "services.integrations.agents.state.working": "En cours de travail",
  "services.integrations.agents.state.waiting": "Attend votre réponse",
  "services.integrations.agents.state.idle": "Inactif",
  "services.integrations.agents.state.completed": "Terminé",
  "services.integrations.agents.state.failed": "Échec",
  "services.integrations.frappe.title": "Sites Frappe",
  "services.integrations.frappe.empty": "Aucun site trouvé. Sélectionnez un bench dans Capacités.",
  "services.integrations.frappe.status.checking": "Vérification",
  "services.integrations.frappe.status.healthy": "En bonne santé",
  "services.integrations.frappe.status.unhealthy": "Ne répond pas",
  "services.integrations.frappe.responseMs": "{ms} ms",
  "services.integrations.frappe.lastHealthy": "Dernier état sain : {ago}",

  "services.capabilities.empty": "Aucune capacité installée.",
  "services.capabilities.status.installed": "Non activée",
  "services.capabilities.status.enabled": "Activée",
  "services.capabilities.status.disabled": "Désactivée",
  "services.capabilities.status.failed": "Échec du démarrage",
  "services.capabilities.status.disconnected": "À l’arrêt",
  "services.capabilities.health.healthy": "en bonne santé",
  "services.capabilities.health.degraded": "dégradée",
  "services.capabilities.health.unhealthy": "défaillante",
  "services.capabilities.enable": "Activer",
  "services.capabilities.disable": "Désactiver",
  "services.capabilities.enableNamed": "Activer {name}",
  "services.capabilities.disableNamed": "Désactiver {name}",
  "services.capabilities.version": "v{version}",
  "services.capabilities.stoppedByKill": "arrêtée par l’arrêt d’urgence",
  "services.capabilities.permissions": "Autorisations ({count})",
  "services.capabilities.granted": "(accordée)",
  "services.capabilities.notGranted": "(non accordée)",
  "services.capabilities.accesses": "Accès : {categories}",

  "services.media.heading": "Lecture en cours · {name}",
  "services.media.notRunning": "{name} n’est pas en cours d’exécution.",
  "services.media.nothingPlaying": "Aucune lecture",
  "services.media.previous": "Précédent",
  "services.media.next": "Suivant",
  "services.media.play": "Lecture",
  "services.media.pause": "Pause",
  "services.media.shuffleOn": "Lecture aléatoire activée",
  "services.media.shuffleOff": "Lecture aléatoire désactivée",
  "services.media.repeat": "Répétition : {mode}",
  "services.media.repeatMode.off": "désactivée",
  "services.media.repeatMode.one": "un titre",
  "services.media.repeatMode.all": "tous",
  "services.media.seek": "Position",
  "services.media.volume": "Volume",
  "services.media.waitingApproval": "En attente de votre approbation…",

  "services.portfolio.title": "Portefeuille",
  "services.portfolio.change24h": "24 h",
  "services.portfolio.chart": "Valeur sur 7 jours",
  "services.portfolio.unpriced":
    "{count, plural, one {# sans prix, exclu du total.} other {# sans prix, exclus du total.}}",
  "services.portfolio.sourceError": "{name} : {error}",
  "services.portfolio.sourceUnreadable": "{name} : lecture impossible",
  "services.portfolio.prices": "Prix : {source}.",
  "services.portfolio.updated": "Mis à jour {ago}.",

  "services.ai.title": "Fournisseurs d’IA",
  "services.ai.empty": "Aucun fournisseur d’IA trouvé.",
  "services.ai.locality.local": "Sur cet appareil",
  "services.ai.locality.cloud": "Cloud (quitte cet appareil)",
  "services.ai.automatic": "Automatique (d’abord sur cet appareil)",
  "services.ai.defaultModel": "modèle par défaut",
  "services.ai.provider.available": "Disponible",
  "services.ai.provider.unavailable": "Indisponible",
  "services.ai.provider.unavailableReason": "Indisponible : {reason}",
  "services.ai.provider.keyNotNeeded": "Aucune clé requise",
  "services.ai.provider.keySet": "Clé définie",
  "services.ai.provider.keyMissing": "Clé manquante",
  "services.ai.provider.replaceKey": "Remplacer la clé",
  "services.ai.provider.setKey": "Définir la clé",
  "services.ai.provider.apiKey": "Clé API {provider}",
  "services.ai.provider.keyNote":
    "En écriture seule : elle est stockée dans le trousseau de votre OS et n’est plus jamais affichée. Utilisée uniquement si vous autorisez l’IA externe.",
  "services.ai.provider.saveKey": "Enregistrer la clé {provider}",
  "services.ai.provider.removeKey": "Supprimer la clé {provider}",
  "services.ai.provider.keySaved":
    "Clé définie. Elle est stockée dans le trousseau de votre OS et n’est plus jamais affichée.",
  "services.ai.provider.keyRemoved": "Clé supprimée de votre trousseau.",
  "services.ai.endpoints.legend": "Points d’accès personnalisés (serveurs compatibles OpenAI)",
  "services.ai.endpoints.note":
    "Phoenix détermine lui-même si une adresse est sur cet ordinateur ou dans le cloud ; vous ne pouvez pas le déclarer. Toute adresse qui n’est pas cet ordinateur doit utiliser https.",
  "services.ai.endpoints.empty": "Aucun point d’accès personnalisé.",
  "services.ai.endpoints.list": "Points d’accès personnalisés",
  "services.ai.endpoints.remove": "Supprimer le point d’accès {label}",
  "services.ai.endpoints.id": "ID",
  "services.ai.endpoints.baseUrl": "URL de base",
  "services.ai.endpoints.addressLocal": "Cette adresse est sur cet appareil.",
  "services.ai.endpoints.addressCloud": "Cette adresse est dans le cloud (quitte cet appareil).",
  "services.ai.endpoints.preset": "Préréglage (facultatif)",
  "services.ai.endpoints.add": "Ajouter le point d’accès",
  "services.ai.endpoints.added": "Point d’accès {name} ajouté.",
  "services.ai.endpoints.removed": "Point d’accès {name} supprimé.",
  "services.ai.endpoints.tooMany": "Vous pouvez ajouter au maximum {max} points d’accès.",
  "services.ai.endpoints.badId":
    "L’ID doit comporter de 2 à 24 caractères : lettres minuscules, chiffres et tirets, en commençant par une lettre.",
  "services.ai.endpoints.idTaken": "Cet ID est déjà utilisé par un autre fournisseur.",
  "services.ai.endpoints.badName": "Le nom doit comporter de 1 à 40 caractères.",
  "services.ai.endpoints.urlInvalid":
    "Saisissez une adresse complète, par exemple https://api.example.com/v1.",
  "services.ai.endpoints.urlScheme": "L’adresse doit commencer par https:// ou http://.",
  "services.ai.endpoints.urlInsecure":
    "Utilisez https ; http simple n’est autorisé que pour cet ordinateur.",
  "services.ai.routing.legend": "Quel modèle fait quoi",
  "services.ai.routing.note":
    "Une route cloud nécessite toujours l’autorisation d’envoyer des données à une IA externe et l’accord pour le type de mémoire concerné, tous deux ci-dessous. Sans eux, rien n’est envoyé et la raison est affichée à la place.",
  "services.ai.routing.providerLocal": "{label} (sur cet appareil)",
  "services.ai.routing.providerCloud": "{label} (cloud)",
  "services.ai.routing.chat.name": "Chat",
  "services.ai.routing.chat.help": "Réponses à vos questions dans le chat et dans Ask Fawkes.",
  "services.ai.routing.chat.provider": "Fournisseur du chat",
  "services.ai.routing.chat.model": "Modèle du chat (facultatif)",
  "services.ai.routing.chat.save": "Enregistrer la route du chat",
  "services.ai.routing.chat.saved": "Route du chat enregistrée.",
  "services.ai.routing.summaries.name": "Résumés",
  "services.ai.routing.summaries.help":
    "Résumés de réunions, plans, extraction et diagnostic de CI.",
  "services.ai.routing.summaries.provider": "Fournisseur des résumés",
  "services.ai.routing.summaries.model": "Modèle des résumés (facultatif)",
  "services.ai.routing.summaries.save": "Enregistrer la route des résumés",
  "services.ai.routing.summaries.saved": "Route des résumés enregistrée.",
  "services.ai.routing.cleanup.name": "Nettoyage",
  "services.ai.routing.cleanup.help": "Mise au propre du texte dicté.",
  "services.ai.routing.cleanup.provider": "Fournisseur du nettoyage",
  "services.ai.routing.cleanup.model": "Modèle du nettoyage (facultatif)",
  "services.ai.routing.cleanup.save": "Enregistrer la route du nettoyage",
  "services.ai.routing.cleanup.saved": "Route du nettoyage enregistrée.",
  "services.ai.prices.legend": "Prix (facultatif)",
  "services.ai.prices.note":
    "Phoenix n’intègre aucun prix. Les coûts ne sont affichés qu’à partir des valeurs que vous saisissez.",
  "services.ai.prices.modelKey": "Clé du modèle, ligne {n}",
  "services.ai.prices.input": "Entrée en $ par 1M de jetons, ligne {n}",
  "services.ai.prices.output": "Sortie en $ par 1M de jetons, ligne {n}",
  "services.ai.prices.removeRow": "Supprimer la ligne de prix {n}",
  "services.ai.prices.add": "Ajouter un prix",
  "services.ai.prices.save": "Enregistrer les prix",
  "services.ai.prices.saved": "Prix enregistrés.",
  "services.ai.prices.badKey":
    "Utilisez la forme provider:model pour la clé du modèle, par exemple « openai:gpt-4o ».",
  "services.ai.prices.duplicateKey": "La clé de modèle {key} apparaît deux fois.",
  "services.ai.prices.badNumber":
    "Les prix pour {key} doivent être des nombres supérieurs ou égaux à zéro.",

  "services.model.loading": "Modèle : chargement…",
  "services.model.button": "Modèle : {label}",
  "services.model.current": "{model} · {provider}",
  "services.model.default": "Par défaut ({model})",
  "services.model.keyHint":
    "Ajoutez la clé dans Paramètres, Fournisseurs d’IA. Vous pouvez quand même le choisir.",
  "services.model.aiOff": "L’IA est désactivée",
  "services.model.providers": "Fournisseurs",
  "services.model.models": "Modèles",
  "services.model.modelsFor": "Modèles de {provider}",
  "services.model.loadingModels": "Chargement des modèles…",
  "services.model.loadFailed": "Impossible de charger la liste des modèles",
  "services.model.listFailed":
    "Impossible de lister les modèles : {error}. Seul le modèle par défaut est affiché.",
  "services.model.notListed": "Ce fournisseur n’a pas listé ses modèles.",
  "services.model.cloudNote":
    "Un modèle cloud ne reçoit que ce que vous avez autorisé dans Paramètres, IA.",

  "services.demo.banner": "Démo - rien n’est enregistré",
  "services.demo.bannerDetail":
    "Il s’agit d’une visite guidée scénarisée sur un Core temporaire distinct. Vos données ne sont pas touchées.",
  "services.demo.settingsTitle": "Mode démo",
  "services.demo.settingsIntro":
    "Regardez Fawkes réagir aux builds, aux agents, aux déploiements et aux réunions. La démo s’exécute sur un Core distinct qui garde tout en mémoire, n’envoie rien nulle part et est supprimé quand vous l’arrêtez. Vos propres données ne sont ni lues ni modifiées.",
  "services.demo.start": "Démarrer la démo",
  "services.demo.starting": "Démarrage de la démo...",
  "services.demo.stop": "Arrêter la démo et revenir",
  "services.demo.play": "Lire cette étape",
  "services.demo.next": "Étape suivante",
  "services.demo.previous": "Étape précédente",
  "services.demo.playing": "Lecture en cours",
  "services.demo.finished":
    "C’était la dernière étape. Arrêtez la démo pour revenir à votre propre Phoenix.",
  "services.demo.stepOf": "Étape {n} / {total}",
  "services.demo.stepCount": "{count, plural, one {# étape} other {# étapes}}",
  "services.demo.startFailed": "Impossible de démarrer la démo",
  "services.demo.stopFailed":
    "Impossible d’arrêter proprement la démo ; elle s’arrête d’elle-même lorsqu’elle est inactive",
  "services.demo.playFailed": "Impossible de lire l’étape de la démo",
  "services.demo.invalidSession":
    "Core a envoyé une adresse de démo non valide ; la démo n’a pas été ouverte",
  "services.demo.offline":
    "Le Core de la démo est injoignable. Il s’est peut-être arrêté après une période d’inactivité.",
  "services.demo.recordingActive":
    "Un appel est en cours d’enregistrement. Arrêtez l’enregistrement avant de lancer la démo.",
  "services.demo.voiceStopped":
    "L’écoute vocale a été désactivée pour la démo. Réactivez-la ensuite.",
  "services.demo.failureDetail": "{message} : {detail}",
  "services.demo.caption.build-pass":
    "Un build s’exécute et réussit. Fawkes travaille pendant l’exécution, puis fête la réussite. Rien ici n’est réel.",
  "services.demo.caption.build-fail":
    "Un build échoue. Fawkes affiche l’erreur et la garde à l’écran jusqu’à ce que vous la preniez en compte.",
  "services.demo.caption.tests":
    "Les tests s’exécutent et réussissent. Fawkes montre le travail en cours et l’efface une fois terminé.",
  "services.demo.caption.agent-waiting":
    "Un agent de code travaille, puis a besoin de vous. Fawkes attend et vous dit ce qu’il attend.",
  "services.demo.caption.agent-done":
    "Un agent de code termine. Fawkes marque la tâche comme terminée.",
  "services.demo.caption.deploy":
    "Un déploiement de préproduction avance. Fawkes le suit étape par étape.",
  "services.demo.caption.deploy-fail":
    "Un déploiement en production échoue. Fawkes le signale aussitôt comme une erreur.",
  "services.demo.caption.meeting":
    "Une réunion est enregistrée, transcrite et résumée. Fawkes affiche l’indicateur d’enregistrement pendant toute sa durée.",
  "services.demo.caption.frappe-down":
    "Un site Frappe tombe, puis se rétablit. Fawkes vous avertit et efface l’alerte.",
  "services.demo.caption.merge-conflict":
    "Un conflit de fusion apparaît et est résolu. Fawkes vous avertit, puis le commit est intégré.",
};
