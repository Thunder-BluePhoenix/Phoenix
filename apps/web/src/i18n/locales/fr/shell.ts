// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { shell as enShell } from "../../en/shell";

/** Machine-translated; unreviewed (see ../../README.md). */
export const shell: Record<keyof typeof enShell, string> = {
  "shell.nav.home": "Accueil Phoenix",
  "shell.nav.main": "Principal",
  "shell.nav.meetings": "Réunions",
  "shell.nav.provenance": "Provenance",
  "shell.nav.agents": "Agents",
  "shell.nav.workflows": "Workflows",
  "shell.nav.recap": "Récapitulatif",
  "shell.nav.settings": "Paramètres",
  "shell.nav.recording": "Enregistrement",
  "shell.app.skipToContent": "Aller au contenu",
  "shell.app.tagline": "Phoenix est la plateforme. Fawkes est la mascotte.",
  "shell.app.noToken":
    "Cette page n’a pas de jeton de session. Ouvrez Phoenix depuis l’adresse affichée par {command}.",
  "shell.app.hint": "Cliquez sur Fawkes dans la barre du haut pour voir ce que fait Phoenix.",
  "shell.language.title": "Langue",
  "shell.language.label": "Langue de l’interface",
  "shell.language.available":
    "{count, plural, one {# langue est disponible.} many {# de langues sont disponibles.} other {# langues sont disponibles.}}",
  "shell.language.machineNote":
    "Les textes dans les langues autres que l’anglais sont traduits automatiquement et n’ont pas encore été relus par des locuteurs natifs.",
  "shell.language.saved": "Langue modifiée.",
  "shell.language.failed": "Impossible d’enregistrer la langue. Réessayez.",

  "shell.palette.title": "Palette de commandes",
  "shell.palette.inputLabel": "Rechercher des commandes",
  "shell.palette.placeholder": "Saisissez une commande…",
  "shell.palette.results": "Commandes",
  "shell.palette.hint": "Les flèches haut et bas choisissent, Enter exécute, Escape ferme.",
  "shell.palette.count":
    "{count, plural, one {# commande} many {# de commandes} other {# commandes}}",
  "shell.palette.empty": "Aucune commande ne correspond à « {query} ».",

  "shell.cmd.palette.open": "Ouvrir la palette de commandes",
  "shell.cmd.nav.home": "Aller à l’accueil",
  "shell.cmd.nav.meetings": "Aller à Réunions",
  "shell.cmd.nav.provenance": "Aller à Provenance",
  "shell.cmd.nav.agents": "Aller à Agents",
  "shell.cmd.nav.workflows": "Aller à Workflows",
  "shell.cmd.nav.recap": "Aller à Récapitulatif",
  "shell.cmd.nav.settings": "Aller à Paramètres",
  "shell.cmd.settings.language": "Ouvrir Paramètres : Langue",
  "shell.cmd.panel.overview": "Panneau Fawkes : Aperçu",
  "shell.cmd.panel.chat": "Panneau Fawkes : Discussion",
  "shell.cmd.panel.activity": "Panneau Fawkes : Activité",
  "shell.cmd.panel.capabilities": "Panneau Fawkes : Capacités",
  "shell.cmd.panel.memory": "Panneau Fawkes : Mémoire",
  "shell.cmd.panel.wardrobe": "Ouvrir la Garde-robe",
  "shell.cmd.demo.start": "Démarrer la démo",
  "shell.cmd.demo.stop": "Arrêter la démo",
  "shell.cmd.pills.next": "Passer à la pastille de source suivante",
  "shell.cmd.pills.previous": "Passer à la pastille de source précédente",
  "shell.cmd.mute.toggle": "Couper ou rétablir les sons et les notifications",

  "shell.shortcuts.title": "Raccourcis globaux",
  "shell.shortcuts.desktopOnly":
    "Les raccourcis globaux sont une fonction de l’application de bureau Phoenix. Ils ne sont pas disponibles dans un navigateur.",
  "shell.shortcuts.intro":
    "Les raccourcis globaux fonctionnent depuis n’importe quelle application tant que l’application de bureau Phoenix est en cours d’exécution.",
  "shell.shortcuts.loading": "Chargement des raccourcis…",
  "shell.shortcuts.loadFailed": "Impossible de lire les raccourcis depuis l’application de bureau.",
  "shell.shortcuts.enable": "Activer les raccourcis globaux",
  "shell.shortcuts.warning":
    "Attention : lorsque les raccourcis globaux sont activés, chacun retire sa combinaison de touches à toutes les autres applications. Ils sont désactivés tant que vous ne les activez pas. Chaque raccourci exige au moins deux touches de modification (Ctrl, Alt, Shift ou Cmd), afin de ne pas gêner la saisie normale.",
  "shell.shortcuts.mute": "Couper les sons et les notifications",
  "shell.shortcuts.muteHelp":
    "Fawkes montre toujours ce qu’il fait ; seuls ses sons et ses bulles de notification sont coupés.",
  "shell.shortcuts.list": "Actions des raccourcis",
  "shell.shortcuts.action.open_chat": "Ouvrir la discussion",
  "shell.shortcuts.action.jump_to_alert": "Aller à l’alerte",
  "shell.shortcuts.action.jump_to_terminal": "Aller au terminal",
  "shell.shortcuts.action.switch_pills": "Changer de pastilles",
  "shell.shortcuts.action.mute": "Couper les sons et les notifications",
  "shell.shortcuts.action.send_to_desktop": "Envoyer Fawkes sur le bureau",
  "shell.shortcuts.action.wardrobe": "Ouvrir la Garde-robe",
  "shell.shortcuts.binding.none": "Non défini",
  "shell.shortcuts.default": "Par défaut : {keys}",
  "shell.shortcuts.state.active": "Actif",
  "shell.shortcuts.state.off": "Inactif : les raccourcis globaux sont désactivés",
  "shell.shortcuts.state.unbound": "Inactif : aucune combinaison de touches n’est définie",
  "shell.shortcuts.state.rejected": "Inactif : cette combinaison de touches n’est pas autorisée",
  "shell.shortcuts.state.unavailable":
    "Inactif : une autre application utilise peut-être déjà cette combinaison de touches, ou le système ne l’autorise pas",
  "shell.shortcuts.changeFor": "Modifier le raccourci de {action}",
  "shell.shortcuts.capture": "Appuyez sur la nouvelle combinaison de touches",
  "shell.shortcuts.captureFor": "Nouvelle combinaison de touches pour {action}",
  "shell.shortcuts.captureHelp": "Appuyez sur les touches en même temps. Escape annule.",
  "shell.shortcuts.resetFor": "Rétablir le raccourci de {action} par défaut",
  "shell.shortcuts.resetAll": "Réinitialiser tous les raccourcis",
  "shell.shortcuts.saved": "Le raccourci de {action} est maintenant {keys}.",
  "shell.shortcuts.resetDone": "Le raccourci de {action} a été réinitialisé.",
  "shell.shortcuts.resetAllDone": "Tous les raccourcis ont été réinitialisés.",
  "shell.shortcuts.reason.invalid": "Ce raccourci n’est pas valide.",
  "shell.shortcuts.reason.unsupportedKey":
    "Cette touche ne peut pas être utilisée. Utilisez une lettre, un chiffre, une touche F ou une flèche avec des touches de modification.",
  "shell.shortcuts.reason.needs_modifiers":
    "Un raccourci exige au moins deux touches de modification (Ctrl, Alt, Shift ou Cmd), afin de ne pas prendre le pas sur la saisie normale.",
  "shell.shortcuts.reason.needs_third_modifier":
    "Sur de nombreux claviers, Ctrl+Alt et Alt+Shift avec une lettre ou un chiffre tapent des symboles (AltGr ou Option). Ajoutez une troisième touche de modification.",
  "shell.shortcuts.reason.reserved": "Le système utilise déjà cette combinaison de touches.",
  "shell.shortcuts.reason.dictation_chord":
    "Cette combinaison de touches est utilisée par la dictée (coller à nouveau).",
  "shell.shortcuts.reason.conflict":
    "Un autre raccourci Phoenix utilise déjà cette combinaison de touches.",
  "shell.shortcuts.reason.unavailable":
    "Le système n’a pas enregistré cette combinaison de touches. Une autre application l’utilise peut-être déjà.",
  "shell.shortcuts.reason.forbidden": "Cette fenêtre ne peut pas modifier les raccourcis.",
  "shell.shortcuts.reason.unknown_action": "Ce n’est pas une action de raccourci.",
  "shell.shortcuts.reason.unknown": "Le raccourci n’a pas pu être modifié.",
};
