// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { power as enpower } from "../../en/power";

/** Machine-translated; unreviewed (see ../../README.md). */
export const power: Record<keyof typeof enpower, string> = {
  "power.awake.duration.minutes": "{minutes, plural, one {# minute} other {# minutes}}",
  "power.awake.duration.hours": "{hours, plural, one {# heure} other {# heures}}",
  "power.awake.heading": "Rester éveillé",
  "power.awake.disabled": "« Rester éveillé » est désactivé. Activez la capacité pour l’utiliser.",
  "power.awake.waiting": "En attente de votre approbation…",
  "power.awake.idle":
    "L’ordinateur se met en veille normalement. Lancez une session minutée pour le garder éveillé.",
  "power.awake.start.heading": "Rester éveillé pendant",
  "power.awake.custom.label": "Minutes",
  "power.awake.reason.label": "Motif (facultatif)",
  "power.awake.custom.start": "Démarrer",
  "power.awake.custom.invalid": "Saisissez un nombre entier de minutes entre {min} et {max}.",
  "power.awake.agents.start": "Pendant que les agents travaillent",
  "power.awake.agents.help":
    "Reste éveillé tant qu’un agent de code travaille et se termine quelques minutes après la fin du dernier (utilise les minutes ci-dessus).",
  "power.awake.agents.working":
    "{count, plural, one {# agent au travail} other {# agents au travail}}",
  "power.awake.agents.grace":
    "Se termine {minutes, plural, one {# minute} other {# minutes}} après la fin du dernier agent.",
  "power.awake.running": "L’ordinateur est maintenu éveillé",
  "power.awake.remaining": "Temps restant : {time}",
  "power.awake.endsAt": "Se termine à {time}",
  "power.awake.extend.label": "Ajouter du temps",
  "power.awake.extend.button": "+{duration}",
  "power.awake.end.hold": "Maintenir pour terminer",
  "power.awake.end.holding": "Continuez à maintenir…",
  "power.awake.end.hint":
    "Maintenez le bouton 1,5 seconde (ou maintenez Espace ou Entrée) pour terminer la session.",
  "power.awake.battery":
    "La session se termine aussi si la batterie passe sous {percent} % sur batterie.",
  "power.awake.lid":
    "Fermer le capot met quand même l’ordinateur en veille ; rester éveillé capot fermé demande le mode capot fermé distinct.",
  "power.awake.indicator": "Éveillé {time}",
  "power.recovery.heading": "Mode capot fermé et récupération",
  "power.recovery.waiting": "En attente de votre approbation…",
  "power.recovery.unreadable": "L’état de récupération n’a pas pu être lu.",
  "power.recovery.journal.clean": "Rien n’attend d’être annulé.",
  "power.recovery.journal.pending":
    "Phoenix n’a pas pu rétablir {count, plural, one {# modification du système} other {# modifications du système}}. Les réglages de veille peuvent rester modifiés.",
  "power.recovery.journal.kind.disablesleep": "Pas de veille capot fermé",
  "power.recovery.journal.kind.lowpowermode": "Mode économie d’énergie",
  "power.recovery.journal.kind.other": "Autre modification",
  "power.recovery.journal.at": "depuis {time}",
  "power.recovery.journal.undo": "Annuler maintenant",
  "power.recovery.journal.untrusted":
    "{count, plural, one {# ligne illisible du journal a été ignorée} other {# lignes illisibles du journal ont été ignorées}}, sans confiance.",
  "power.recovery.journal.cannotQuit":
    "Quitter Phoenix est refusé tant que ces modifications ne sont pas annulées.",
  "power.recovery.lid.open": "Le capot est ouvert.",
  "power.recovery.lid.closed": "Le capot est fermé.",
  "power.recovery.lid.unknown": "L’état du capot est inconnu.",
  "power.recovery.lid.unsupported":
    "Cet ordinateur n’a pas de capteur de capot ; le mode capot fermé n’est donc pas disponible.",
  "power.recovery.helper.installed": "Assistant privilégié installé",
  "power.recovery.helper.missing":
    "Assistant privilégié non installé (mode capot fermé indisponible). Voir docs/awake-helper.md.",
  "power.recovery.helper.unknown": "On ne sait pas si l’assistant privilégié est installé.",
  "power.recovery.floors.off": "Les seuils sont désactivés",
  "power.recovery.floors.rule":
    "Mode économie d’énergie sous {low} %, fin de la session sous {end} % ; chaleur : mode économie d’énergie à {heatLow}, fin à {heatEnd}.",
  "power.recovery.floors.lowPowerActive": "Le mode économie d’énergie est activé",
  "power.recovery.floors.battery.none": "Batterie : aucune",
  "power.recovery.floors.battery.unknown": "Batterie : inconnue",
  "power.recovery.floors.battery.level": "Batterie {percent} %",
  "power.recovery.floors.battery.unplugged": "Batterie {percent} %, débranché",
  "power.recovery.floors.battery.plugged": "Batterie {percent} %, branché",
  "power.recovery.floors.thermal.nominal": "normale",
  "power.recovery.floors.thermal.fair": "tiède",
  "power.recovery.floors.thermal.serious": "chaude",
  "power.recovery.floors.thermal.critical": "critique",
  "power.recovery.floors.thermal.level": "Chaleur : {level}",
  "power.recovery.floors.thermal.unsupported": "Chaleur : non communiquée",
  "power.recovery.floors.thermal.unknown": "Chaleur : inconnue",
  "power.recovery.safety.warning":
    "Ne transportez jamais l’ordinateur dans un sac, une housse ou un autre espace fermé lorsque le mode capot fermé est activé : il peut surchauffer. Gardez les aérations dégagées.",
  "power.recovery.safety.understand": "J’ai compris",
  "power.recovery.safety.acknowledge": "Confirmer",
  "power.recovery.safety.done":
    "Vous avez confirmé l’avertissement de sécurité du mode capot fermé.",
  "power.recovery.start": "Démarrer le mode capot fermé",
  "power.recovery.end": "Arrêter le mode capot fermé",
  "power.recovery.engaged": "Le mode capot fermé est activé.",
  "power.recovery.engagedSince": "Le mode capot fermé est activé depuis {time}.",
  "power.recovery.needsSession":
    "Démarrez d’abord une session « rester éveillé » ; le mode capot fermé en a besoin.",
  "power.recovery.journal.discard": "Ignorer cette entrée",
  "power.recovery.lockBlocked":
    "Un autre processus de récupération détient le verrou : rien n’a encore été annulé. Le changement reste en attente.",
  "power.recovery.sleepUnjournaled":
    "La mise en veille est désactivée sur cet ordinateur, mais Phoenix n’a aucune trace de l’avoir désactivée. Autre chose l’a modifiée.",
  "power.recovery.journalPath": "Journal : {path}",
  "power.continuity.heading": "Continuité des agents",
  "power.continuity.intro":
    "Options supplémentaires pour les longues exécutions d’agents. Chacune est désactivée tant que vous ne l’activez pas, et aucune ne choisit à votre place un réseau, un terminal ou un programme.",
  "power.continuity.needsAwake":
    "Ces réglages ne prennent effet que lorsque la fonction Maintien en éveil est activée.",
  "power.continuity.saved":
    "Enregistré. Les modifications s’appliqueront au prochain démarrage de Maintien en éveil.",
  "power.continuity.applyNote":
    "Les modifications sont enregistrées dans la fonction Maintien en éveil et s’appliquent à sa prochaine activation.",
  "power.continuity.network.title": "Surveillance du réseau",
  "power.continuity.network.help":
    "Vérifie toutes les quelques secondes qu’un ordinateur que vous indiquez est joignable, et informe Phoenix lorsque le réseau tombe et lorsqu’il revient. Elle se contente de se connecter ; elle n’envoie ni ne lit aucune donnée.",
  "power.continuity.hosts.label": "Hôtes à vérifier (nom ou nom:port)",
  "power.continuity.hotspot.title": "Basculement vers le point d’accès",
  "power.continuity.hotspot.help":
    "Lorsque le Wi-Fi tombe pendant une session de maintien en éveil, rejoint le point d’accès de l’iPhone que vous indiquez. Nécessite la surveillance du réseau ci-dessus et une liste d’hôtes. Fonctionne uniquement sous macOS et n’a pas été testé sur un vrai Mac.",
  "power.continuity.hotspot.ssid": "Nom du point d’accès (SSID)",
  "power.continuity.hotspot.disclosure":
    "Avant d’activer cette option : macOS peut rejoindre un réseau qu’il connaît déjà sans aucun mot de passe en ligne de commande ; rejoignez donc d’abord votre point d’accès une fois à la main. Ce n’est que si vous autorisez aussi le mot de passe enregistré ci-dessous que Phoenix le transmet à l’outil macOS networksetup, et alors tous les programmes de ce Mac peuvent le lire dans cette ligne de commande pendant les quelques secondes que dure la connexion. Il n’existe aucun moyen intégré plus sûr de procéder sans vous le demander. Refusez si cela n’est pas acceptable pour vous.",
  "power.continuity.hotspot.allowPassword":
    "J’accepte : utiliser le mot de passe enregistré du point d’accès en ligne de commande",
  "power.continuity.hotspot.passwordSaved":
    "Un mot de passe de point d’accès est enregistré dans le keychain.",
  "power.continuity.hotspot.passwordMissing":
    "Aucun mot de passe de point d’accès n’est enregistré. Enregistrez-en un sous le nom de secret « hotspot_password » de la fonction Maintien en éveil, ou laissez cette case décochée et rejoignez le point d’accès une fois à la main.",
  "power.continuity.hotspot.join": "Rejoindre le point d’accès maintenant",
  "power.continuity.hotspot.rejoin": "Rejoindre mon réseau précédent",
  "power.continuity.hotspot.confirmNote":
    "Rejoindre un réseau change le Wi-Fi utilisé par ce Mac. Phoenix vous demande de confirmer à chaque fois.",
  "power.continuity.hotspot.joined": "Connecté.",
  "power.continuity.nudge.title": "Relancer les agents",
  "power.continuity.nudge.help":
    "S’il n’y a pas de réseau pendant la durée ci-dessous, saisit « continue » dans les terminaux que vous listez. Rien n’est saisi pendant une réunion ou une dictée, et chaque terminal ne le reçoit qu’une seule fois au maximum par coupure.",
  "power.continuity.nudge.after": "Secondes sans réseau avant la relance (30 à 3600)",
  "power.continuity.nudge.panes": "Panneaux tmux (par exemple %12)",
  "power.continuity.nudge.sessions":
    "Sessions d’agent Phoenix (ph- suivi de 16 chiffres hexadécimaux)",
  "power.continuity.nudge.sessionsNote":
    "Pas encore disponible : Phoenix n’a aucun moyen sûr de saisir du texte dans une session suivie ; les sessions listées sont donc ignorées et signalées. Seuls les panneaux tmux sont relancés.",
  "power.continuity.nudge.commands": "Programmes qu’un panneau peut exécuter (par exemple claude)",
  "power.continuity.nudge.commandsNote":
    "Phoenix vérifie que le panneau existe toujours et qu’il exécute l’un de ces programmes avant de saisir quoi que ce soit. Avec une liste vide, rien n’est jamais saisi.",
  "power.continuity.nudge.enter": "Appuyer aussi sur Enter",
  "power.continuity.nudge.enterHelp":
    "Désactivé par défaut. Sans cette option, « continue » est saisi mais pas envoyé : vous appuyez vous-même sur Enter.",
  "power.continuity.throttle.title": "Vérification du bridage des navigateurs",
  "power.continuity.throttle.help":
    "Chrome, Arc, Comet, Edge et Brave ralentissent les onglets en arrière-plan, ce qui peut bloquer une page web d’agent. Ceci liste ceux qui s’exécutent ainsi. Aucun navigateur n’est jamais modifié, sauf si vous choisissez Relancer et confirmez.",
  "power.continuity.throttle.unsupported":
    "La vérification des navigateurs fonctionne uniquement sous macOS.",
  "power.continuity.throttle.notRunning": "non lancé",
  "power.continuity.throttle.throttled": "s’exécute avec le bridage en arrière-plan",
  "power.continuity.throttle.fine": "s’exécute sans bridage",
  "power.continuity.throttle.relaunch": "Relancer {name} sans bridage",
  "power.continuity.throttle.confirm":
    "Relancer {name} sans bridage en arrière-plan ? {name} va se fermer puis se rouvrir, ses onglets seront rechargés, et tout ce qui n’est pas enregistré sur une page peut être perdu. Cette action est refusée pendant une réunion ou une dictée.",
  "power.continuity.throttle.confirmYes": "Quitter et relancer",
  "power.continuity.throttle.relaunched": "{name} a été relancé.",
  "power.continuity.outage.title": "Dernière coupure du réseau",
  "power.continuity.outage.none": "Aucune coupure du réseau constatée pour l’instant.",
  "power.continuity.outage.down": "Le réseau est coupé depuis {time}.",
  "power.continuity.outage.ended": "Le réseau a été coupé de {from} à {to}.",
  "power.continuity.outage.nudged":
    "{count, plural, one {# terminal relancé} other {# terminaux relancés}}",
  "power.continuity.outage.hotspot.joined": "Point d’accès rejoint",
  "power.continuity.outage.hotspot.failed": "Échec de la connexion au point d’accès",
  "power.continuity.outage.hotspot.skipped":
    "Point d’accès non essayé (désactivé, ou aucune session en cours)",
  "power.continuity.outage.hotspot.notTried": "Point d’accès pas encore essayé",
  "power.continuity.list.empty": "Rien dans la liste.",
  "power.continuity.list.remove": "Supprimer {item}",
  "power.continuity.invalid.host":
    "Utilisez un nom d’hôte ou une adresse, éventuellement suivi de :port (1 à 65535).",
  "power.continuity.invalid.pane":
    "Utilisez un identifiant de panneau tmux tel que %12 : un signe pourcentage suivi d’au plus six chiffres.",
  "power.continuity.invalid.session":
    "Utilisez un identifiant de session tel que ph-0123456789abcdef.",
  "power.continuity.invalid.command":
    "Utilisez un nom de programme tel que claude : uniquement des lettres, des chiffres et . _ + -",
  "power.continuity.invalid.ssid":
    "Utilisez de 1 à 32 octets de texte visible ne commençant pas par un trait d’union.",
  "power.continuity.invalid.seconds":
    "Saisissez un nombre entier de secondes compris entre {min} et {max}.",
  "power.continuity.problem.duplicate": "Cette entrée figure déjà dans la liste.",
  "power.continuity.problem.full": "La liste est pleine ({max} entrées au maximum).",
  "power.continuity.reason.unsupported_platform": "Cela fonctionne uniquement sous macOS.",
  "power.continuity.reason.no_wifi_device": "Phoenix n’a pas trouvé l’interface Wi-Fi de ce Mac.",
  "power.continuity.reason.no_hotspot_configured":
    "Il n’y a aucun point d’accès ni réseau précédent utilisable à rejoindre.",
  "power.continuity.reason.bad_password":
    "Le mot de passe enregistré est inutilisable. Vérifiez-le dans le keychain.",
  "power.continuity.reason.join_failed": "macOS n’a pas pu rejoindre le réseau.",
  "power.continuity.reason.unknown_browser": "Ce navigateur n’est pas géré par Phoenix.",
  "power.continuity.reason.protected": "Pas maintenant : une réunion ou une dictée est en cours.",
  "power.continuity.reason.not_running": "Ce navigateur n’est pas lancé.",
  "power.continuity.reason.already_unthrottled":
    "Ce navigateur s’exécute déjà sans bridage en arrière-plan.",
  "power.continuity.reason.unavailable": "Ce n’est pas disponible pour le moment.",
  "power.continuity.reason.quit_failed": "Le navigateur n’a pas accepté la demande de fermeture.",
  "power.continuity.reason.still_running":
    "Le navigateur est toujours ouvert ; il n’a donc pas été rouvert. Fermez-le vous-même, puis réessayez.",
  "power.continuity.reason.open_failed": "Le navigateur s’est fermé mais n’a pas pu être rouvert.",
  "power.continuity.reason.other": "Cela n’a pas fonctionné.",
  "power.lid.heading": "Actions à la fermeture du capot",
  "power.lid.intro":
    "Pendant une session de maintien d’activité, quand vous fermez le capot, Phoenix peut économiser l’énergie et rendre cet ordinateur silencieux. Tout est annulé à l’ouverture du capot, à la fin de la session et quand Phoenix redémarre après un plantage.",
  "power.lid.needsAwake":
    "Ces actions ne s’exécutent que si la capacité Maintien d’activité est activée.",
  "power.lid.master.title": "Exécuter les actions à la fermeture du capot",
  "power.lid.master.help": "Le commutateur principal. Désactivé, rien de ce qui suit ne s’exécute.",
  "power.lid.display.title": "Éteindre l’écran",
  "power.lid.display.help":
    "Met l’écran en veille. La luminosité est enregistrée puis rétablie si l’outil gratuit de luminosité est installé.",
  "power.lid.freeze.title": "Geler les applis de messagerie",
  "power.lid.freeze.help":
    "Met en pause les applis de messagerie choisies pour qu’elles n’utilisent plus d’énergie, puis les relance. Jamais pendant une réunion, un enregistrement ou une dictée, ni pour les terminaux, éditeurs ou agents de code en cours.",
  "power.lid.freeze.apps": "Applis à geler",
  "power.lid.mute.title": "Couper le son",
  "power.lid.mute.help":
    "Coupe la sortie audio et la rétablit exactement comme elle était, même si vous avez changé de sortie entre-temps.",
  "power.lid.lowPower.title": "Mode économie d’énergie",
  "power.lid.lowPower.help":
    "Active le mode économie d’énergie. Nécessite l’assistant privilégié facultatif ; sans lui, cette action est ignorée.",
  "power.lid.docker.title": "Geler Docker Desktop",
  "power.lid.docker.help":
    "Met Docker Desktop en pause tant qu’aucun conteneur ne tourne. Jamais si un conteneur tourne ou si l’état de Docker est inconnu.",
  "power.lid.nap.title": "Empêcher App Nap pour les applis d’agents",
  "power.lid.nap.help":
    "Empêche macOS de ralentir les applis listées. Leur réglage précédent est enregistré puis rétabli exactement.",
  "power.lid.nap.apps": "Applis (identifiants de bundle, par exemple com.example.App)",
  "power.lid.protected.title": "Jamais gelés",
  "power.lid.protected.help":
    "Ceux-ci sont toujours laissés tranquilles. Vous pouvez en ajouter, mais les protections intégrées ne peuvent pas être retirées.",
  "power.lid.protected.builtIn": "Intégrés",
  "power.lid.protected.extra": "Ajouter un nom de programme ou d’appli",
  "power.lid.list.empty": "Rien n’a été ajouté.",
  "power.lid.list.remove": "Retirer {item}",
  "power.lid.list.duplicate": "Déjà dans la liste.",
  "power.lid.list.full": "La liste est pleine ({max} entrées).",
  "power.lid.invalid.bundle":
    "Utilisez un identifiant de bundle comme com.example.App : lettres, chiffres et tirets, avec au moins un point.",
  "power.lid.invalid.name":
    "Utilisez un nom simple de programme ou d’appli : lettres, chiffres, espaces et . _ + -",
  "power.lid.unsupported": "Indisponible ici : {reason}",
  "power.lid.gapNote":
    "Certaines ne fonctionnent que partiellement sur cet ordinateur. Voir README-lid.md pour ce qui est pris en charge ou non.",
  "power.lid.last.title": "Dernier événement du capot",
  "power.lid.last.closed": "Le capot s’est fermé à {time}.",
  "power.lid.last.opened": "Le capot s’est ouvert à {time}.",
  "power.lid.last.none": "Rien ne s’est encore passé.",
  "power.lid.last.mismatched":
    "{count, plural, one {# processus n’a pas été relancé car il ne correspondait plus à ce que Phoenix a gelé.} other {# processus n’ont pas été relancés car ils ne correspondaient plus à ce que Phoenix a gelé.}}",
  "power.lid.last.stillClosed": "Le capot est fermé et les actions ci-dessus sont appliquées.",
  "power.lid.outcome.applied": "Fait",
  "power.lid.outcome.skipped": "Ignoré",
  "power.lid.outcome.failed": "Échec",
  "power.lid.outcome.undone": "Annulé",
  "power.lid.outcome.undo_failed": "Impossible d’annuler (Phoenix réessaiera)",
  "power.lid.reason.unsupported_platform": "Pris en charge uniquement sur Mac.",
  "power.lid.reason.helper_unavailable": "L’assistant privilégié n’est pas installé.",
  "power.lid.reason.tool_missing": "Un outil nécessaire n’est pas installé.",
  "power.lid.reason.already_on": "Déjà activé pour une autre raison.",
  "power.lid.reason.state_unknown":
    "Phoenix ne peut pas savoir si vous êtes en réunion, il n’a donc rien fait.",
  "power.lid.reason.protected_state": "Une réunion, un enregistrement ou une dictée est en cours.",
  "power.lid.reason.docker_busy": "Un conteneur tourne.",
  "power.lid.reason.docker_unknown": "L’état de Docker est inconnu.",
  "power.lid.reason.process_list_unavailable":
    "La liste des programmes en cours n’a pas pu être lue.",
  "power.lid.reason.audio_unavailable": "Les sorties audio n’ont pas pu être lues.",
  "power.lid.reason.no_targets": "Il n’y avait rien à changer.",
  "power.lid.reason.nothing_to_do": "Il n’y avait rien à changer.",
  "power.lid.reason.journal_unwritable":
    "Le journal de récupération n’a pas pu être écrit, donc rien n’a été modifié.",
  "power.lid.reason.not_applied": "Rien n’a été modifié.",
  "power.lid.reason.apply_failed": "Le changement n’a pas pu être effectué.",
  "power.lid.reason.undo_failed": "Le changement n’a pas pu être annulé.",
  "power.lid.reason.assertions_unknown":
    "Phoenix ne peut pas savoir si une app est en appel, il n’a donc rien gelé.",
  "power.lid.reason.holds_assertion":
    "Toutes les apps de messagerie sont utilisées (appel ou lecture), aucune n’a donc été gelée.",
  "power.lid.reason.output_changed":
    "La sortie son a changé pendant que le capot était fermé, Phoenix n’a donc pas touché à la nouvelle sortie. La sortie qu’il a coupée reste coupée jusqu’à ce qu’elle redevienne la sortie par défaut.",
  "power.lid.reason.retry_or_alert":
    "Une app gelée semble avoir été relancée, Phoenix ne l’a donc pas reprise. Vérifiez que vos apps de messagerie fonctionnent normalement.",
  "power.lid.reason.not_ours":
    "Certains processus n’ont pas pu être repris car Phoenix ne peut pas les contrôler.",
  "power.lid.limit.output_identity_unknown":
    "Phoenix ne peut pas lire le nom de la sortie son, il ne peut donc pas savoir si elle a changé.",
  "power.lid.limit.brightness_tool_untrusted":
    "Le fichier de l’outil de luminosité n’est pas sûr (mauvais propriétaire ou modifiable par d’autres), il n’a donc pas été utilisé.",
  "power.lid.reason.other": "Cela n’a pas fonctionné.",
  "power.lid.limit.brightness_tool_missing":
    "L’outil gratuit de luminosité n’est pas installé : seule la mise en veille de l’écran est utilisée et la luminosité n’est pas modifiée.",
  "power.lid.limit.keyboard_backlight_unsupported":
    "Le rétroéclairage du clavier ne peut pas être contrôlé sans logiciel tiers.",
  "power.lid.limit.default_output_only": "Seule la sortie par défaut actuelle peut être coupée.",
  "power.lid.applyNote":
    "Les changements prennent effet la prochaine fois qu’une session voit le capot se fermer. Tout est consigné dans le journal avant d’être fait.",
  "power.lid.saved": "Enregistré.",
  "power.lid.glance.closed": "Le capot est fermé : les actions de fermeture sont appliquées.",
  "power.lid.glance.failed":
    "Une action de fermeture du capot n’a pas pu être annulée. Ouvrez Maintien d’activité pour les détails.",
};
