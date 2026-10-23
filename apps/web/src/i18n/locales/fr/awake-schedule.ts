// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { awakeSchedule as enAwakeSchedule } from "../../en/awake-schedule";

/** Machine-translated; unreviewed. */
export const awakeSchedule: Record<keyof typeof enAwakeSchedule, string> = {
  "awakeSchedule.loading": "Chargement…",
  "awakeSchedule.schedule.title": "Maintien en éveil programmé",
  "awakeSchedule.schedule.notAvailable":
    "Le maintien en éveil programmé n’est pas disponible : ce Phoenix Core n’a pas de coffre de secrets du système.",
  "awakeSchedule.schedule.loadFailed": "Impossible de charger le maintien en éveil programmé.",
  "awakeSchedule.schedule.intro":
    "Désactivé par défaut. L’activer et enregistrer chaque plage vous demandent d’abord confirmation dans Approbations ; une fois activé, cet ordinateur reste éveillé pendant les plages enregistrées.",
  "awakeSchedule.schedule.awakeOff":
    "La capacité Maintien en éveil n’est pas activée : aucune plage ne peut donc garder cet ordinateur éveillé. Activez-la dans Intégrations.",
  "awakeSchedule.schedule.enable": "Garder cet ordinateur éveillé pendant mes plages enregistrées",
  "awakeSchedule.schedule.confirming": "En attente de votre confirmation dans Approbations…",
  "awakeSchedule.state.off": "Le maintien en éveil programmé est désactivé.",
  "awakeSchedule.state.idle":
    "Le maintien en éveil programmé est activé. Aucune plage n’est en cours.",
  "awakeSchedule.state.holding": "Cet ordinateur est maintenu éveillé en ce moment.",
  "awakeSchedule.state.holdingUntil": "Cet ordinateur est maintenu éveillé jusqu’à {time}.",
  "awakeSchedule.state.waiting": "Une plage attend de démarrer car {reason}",
  "awakeSchedule.waiting.needs_charger": "cet ordinateur n’est pas branché.",
  "awakeSchedule.waiting.battery_low": "la batterie est sous votre minimum.",
  "awakeSchedule.waiting.low_power_mode": "le mode économie d’énergie est activé.",
  "awakeSchedule.waiting.power_unknown": "l’état de l’alimentation n’a pas pu être lu.",
  "awakeSchedule.waiting.busy": "une autre session de maintien en éveil est déjà en cours.",
  "awakeSchedule.waiting.battery_floor": "la batterie est trop faible pour continuer.",
  "awakeSchedule.waiting.start_failed": "le maintien en éveil n’a pas pu démarrer.",
  "awakeSchedule.waiting.unknown": "d’un motif que cette version ne reconnaît pas.",
  "awakeSchedule.cancel.button": "Annuler la plage en cours",
  "awakeSchedule.list.title": "Plages enregistrées",
  "awakeSchedule.list.empty": "Aucune plage enregistrée.",
  "awakeSchedule.list.line": "{when}, {start}–{end} ({zone})",
  "awakeSchedule.list.remove": "Retirer",
  "awakeSchedule.list.removeNamed": "Retirer {name}",
  "awakeSchedule.upcoming.title": "Prochaines plages",
  "awakeSchedule.upcoming.empty": "Aucune plage à venir.",
  "awakeSchedule.upcoming.line": "{name} : de {from} à {to}",
  "awakeSchedule.upcoming.skipped": "Ignorée",
  "awakeSchedule.upcoming.skip": "Ignorer",
  "awakeSchedule.upcoming.unskip": "Ne plus ignorer",
  "awakeSchedule.upcoming.skipNamed": "Ignorer {name} à {time}",
  "awakeSchedule.upcoming.unskipNamed": "Ne plus ignorer {name} à {time}",
  "awakeSchedule.add.title": "Ajouter une plage",
  "awakeSchedule.add.id": "Nom (minuscules, chiffres, tirets)",
  "awakeSchedule.add.label": "Libellé (facultatif)",
  "awakeSchedule.add.zone": "Fuseau horaire",
  "awakeSchedule.add.start": "Début",
  "awakeSchedule.add.end": "Fin",
  "awakeSchedule.add.days": "Se répète le",
  "awakeSchedule.add.charger": "Seulement sur secteur",
  "awakeSchedule.add.minBattery": "Batterie minimale (%)",
  "awakeSchedule.add.submit": "Enregistrer la plage",
  "awakeSchedule.lights.title": "Voyants d’état",
  "awakeSchedule.lights.notAvailable":
    "Les voyants d’état ne sont pas disponibles : ce Phoenix Core n’a pas de coffre de secrets du système.",
  "awakeSchedule.lights.loadFailed": "Impossible de charger les voyants d’état.",
  "awakeSchedule.lights.intro":
    "Fawkes peut montrer ce qu’il fait sur une lumière de votre propre réseau. Une lumière n’est contactée que si vous l’avez ajoutée ici, autorisé Fawkes à l’allumer et activé la capacité Voyants d’état.",
  "awakeSchedule.lights.limits":
    "Seules des couleurs fixes sont envoyées, jamais de texte. Seuls l’Elgato Key Light et LIFX sont pris en charge pour l’instant ; une lumière LIFX s’ajoute via l’API de Core avec son numéro de série.",
  "awakeSchedule.lights.capabilityOff":
    "La capacité Voyants d’état n’est pas activée. Activez-la ici ou dans Intégrations.",
  "awakeSchedule.lights.enable": "Activer",
  "awakeSchedule.lights.empty": "Aucune lumière ajoutée.",
  "awakeSchedule.lights.line": "Key Light à l’adresse {address}",
  "awakeSchedule.lights.lineLifx": "Lumière LIFX à l’adresse {address}",
  "awakeSchedule.lights.allow": "Autoriser Fawkes à allumer cette lumière",
  "awakeSchedule.lights.allowNamed": "Autoriser Fawkes à allumer {name}",
  "awakeSchedule.lights.remove": "Retirer",
  "awakeSchedule.lights.removeNamed": "Retirer {name}",
  "awakeSchedule.lights.add.title": "Ajouter un Key Light",
  "awakeSchedule.lights.add.id": "Nom",
  "awakeSchedule.lights.add.address": "Adresse sur votre réseau (par exemple 192.168.1.20)",
  "awakeSchedule.lights.add.submit": "Ajouter la lumière",
};
