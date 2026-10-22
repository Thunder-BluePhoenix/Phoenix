// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { ports as enports } from "../../en/ports";

/** Machine-translated; unreviewed (see ../../README.md). */
export const ports: Record<keyof typeof enports, string> = {
  "ports.title": "Radar de ports",
  "ports.intro":
    "Montre quels programmes écoutent sur des ports réseau sur cet ordinateur, dans quel projet ils tournent et depuis combien de temps. L’analyse ne fait que lire ; rien n’est modifié à moins que vous n’arrêtiez un programme et ne l’approuviez.",
  "ports.disabled":
    "Le radar de ports est désactivé. Activez la capacité Radar de ports et de processus pour l’utiliser.",
  "ports.scan": "Analyser maintenant",
  "ports.scanning": "Analyse en cours…",
  "ports.notScanned": "Rien n’a encore été analysé. Choisissez Analyser maintenant.",
  "ports.empty": "Aucun programme n’écoute sur un port.",
  "ports.loadError": "Les ports n’ont pas pu être lus.",
  "ports.scannedAt": "Analysé à {time}",
  "ports.count": "{count, plural, one {# port en écoute} other {# ports en écoute}}",
  "ports.table.caption": "Ports en écoute",
  "ports.col.port": "Port",
  "ports.col.process": "Programme",
  "ports.col.project": "Projet",
  "ports.col.age": "En cours depuis",
  "ports.col.notes": "Remarques",
  "ports.col.actions": "Actions",
  "ports.pid": "processus {pid}",
  "ports.age.unknown": "inconnu",
  "ports.age.minutes": "{count, plural, one {# minute} other {# minutes}}",
  "ports.age.hours": "{count, plural, one {# heure} other {# heures}}",
  "ports.age.days": "{count, plural, one {# jour} other {# jours}}",
  "ports.project.none": "aucun projet",
  "ports.exposure.all": "accessible depuis le réseau",
  "ports.exposure.loopback": "cet ordinateur uniquement",
  "ports.exposure.interface": "une adresse réseau",
  "ports.flag.forgotten": "Peut-être oublié",
  "ports.flag.heavy": "Lourd",
  "ports.flag.core": "Phoenix lui-même",
  "ports.usage": "CPU {percent} %, mémoire {mb} Mo",
  "ports.help.forgotten":
    "Peut-être oublié : il tourne dans un dossier de projet depuis plus de {hours, plural, one {# heure} other {# heures}}. Phoenix ne peut pas savoir si quelqu’un l’utilise encore.",
  "ports.help.heavy":
    "Lourd : CPU de {cpu} % ou plus, ou mémoire de {mb} Mo ou plus, selon ps (une moyenne, pas une mesure en direct).",
  "ports.open": "Ouvrir dans le navigateur",
  "ports.open.label": "Ouvrir {name} sur le port {port} dans votre navigateur par défaut",
  "ports.openNote":
    "Les liens ouvrent http://127.0.0.1 dans votre navigateur par défaut. Phoenix n’a pas encore de navigateur à lui.",
  "ports.stop": "Arrêter…",
  "ports.stop.label": "Arrêter {name} sur le port {port}",
  "ports.refusal.self": "C’est Phoenix lui-même, qui ne s’arrête jamais lui-même.",
  "ports.refusal.other_user": "Il appartient à un autre utilisateur.",
  "ports.refusal.system": "C’est un processus système.",
  "ports.refusal.not_dev_tool": "Ce n’est pas un outil de développement que Phoenix peut arrêter.",
  "ports.refusal.unsupported": "L’arrêt n’est pas disponible sur ce système.",
  "ports.refusal.unknown": "Phoenix n’a pas pu vérifier ce processus, il ne l’arrêtera donc pas.",
  "ports.confirm.title": "Arrêter {name} sur le port {port} ?",
  "ports.confirm.body":
    "Après votre approbation, Phoenix demandera à {name} (processus {pid}) de se fermer. Le programme peut perdre un travail non enregistré.",
  "ports.confirm.go": "Demander l’arrêt",
  "ports.confirm.cancel": "Annuler",
  "ports.stop.waiting": "En attente de votre approbation dans Approbations…",
  "ports.stop.exited": "{name} s’est arrêté.",
  "ports.stop.stillRunning":
    "{name} a reçu la demande de se fermer et tourne toujours. L’arrêt forcé le termine immédiatement, est irréversible et peut faire perdre des données.",
  "ports.force": "Arrêt forcé…",
  "ports.force.label": "Forcer l’arrêt de {name} sur le port {port}",
  "ports.force.hint":
    "Phoenix refuse l’arrêt forcé pendant les premières secondes après la demande de fermeture.",
  "ports.force.confirm": "Forcer l’arrêt",
  "ports.restart.note":
    "Le redémarrage n’est pas disponible : Phoenix ne peut pas reconstruire en toute sécurité la commande d’origine d’un programme.",
  "ports.watch.label": "Actualiser automatiquement tant que Phoenix est ouvert",
  "ports.watch.help":
    "Désactivé par défaut. Si activé, Phoenix lit la liste des ports toutes les 15 secondes, uniquement quand une fenêtre Phoenix est ouverte.",
  "ports.noProcessTable":
    "La liste des processus n’a pas pu être lue : les durées et l’arrêt sont indisponibles.",
  "ports.parseWarnings":
    "Certaines lignes de la liste des processus ou des ports du système n’ont pas été comprises et ont été ignorées (un nom de programme peut contenir des retours à la ligne). Des programmes peuvent manquer ou ne pas pouvoir être arrêtés ici ; l’arrêt revérifie tout.",
  "ports.windows.note":
    "Sous Windows, le radar n’affiche que les ports et les noms de programmes ; durées, projets et arrêt ne sont pas disponibles.",
};
