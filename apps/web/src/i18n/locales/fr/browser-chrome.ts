// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserChrome as enBrowserChrome } from "../../en/browser-chrome";

/** Machine-translated; unreviewed. */
export const browserChrome: Record<keyof typeof enBrowserChrome, string> = {
  "browser.find.open": "Rechercher dans la page",
  "browser.find.label": "Rechercher dans la page",
  "browser.find.placeholder": "Rechercher dans la page",
  "browser.find.next": "Résultat suivant",
  "browser.find.prev": "Résultat précédent",
  "browser.find.close": "Fermer la recherche",
  "browser.find.searching": "Recherche…",
  "browser.find.found": "Trouvé sur cette page.",
  "browser.find.notFound": "Introuvable sur cette page.",
  "browser.find.tooLong": "Le texte recherché peut contenir au plus {max} caractères.",
  "browser.find.control": "Le texte recherché ne peut pas contenir de caractères de contrôle.",
  "browser.find.bidi":
    "Le texte recherché ne peut pas contenir de caractères de contrôle de la direction du texte.",
  "browser.find.failed": "La recherche n'a pas pu s'exécuter sur cette page.",
  "browser.find.bad_query": "Le navigateur a refusé ce texte de recherche.",
  "browser.find.unknown_tab": "Cet onglet n'existe plus.",
  "browser.find.no_page": "Il n'y a pas encore de page à rechercher.",
  "browser.permission.title": "Une page demande une autorisation",
  "browser.permission.origin": "Site : {origin}",
  "browser.permission.asks": "Elle veut utiliser : {permission}",
  "browser.permission.allow": "Autoriser une fois",
  "browser.permission.deny": "Refuser",
  "browser.permission.countdown":
    "Refus automatique dans {seconds, plural, one {# seconde} other {# secondes}}.",
  "browser.permission.more":
    "{count, plural, one {# autre demande est en attente} other {# autres demandes sont en attente}}",
  "browser.permission.kind.microphone": "votre microphone",
  "browser.permission.kind.camera": "votre caméra",
  "browser.permission.kind.geolocation": "votre position",
  "browser.permission.kind.notifications": "les notifications",
  "browser.permission.kind.clipboard-read": "la lecture de votre presse-papiers",
  "browser.permission.kind.display-capture": "votre écran",
  "browser.permission.kind.midi": "les appareils MIDI",
  "browser.permission.kind.sensors": "les capteurs de mouvement et autres",
  "browser.permission.kind.media-key-system-access": "les médias protégés (DRM)",
  "browser.permission.kind.local-fonts": "les polices installées sur cet ordinateur",
  "browser.permission.kind.window-management": "vos écrans et fenêtres",
  "browser.permission.kind.pointer-lock": "votre pointeur de souris",
  "browser.permission.kind.automatic-downloads": "plusieurs téléchargements à la fois",
  "browser.permission.kind.file-system-access": "des fichiers sur cet ordinateur",
  "browser.permission.kind.autoplay": "la lecture automatique du son",
  "browser.permission.kind.other": "autre chose",
  "browser.corner.noShell": "Non connecté à l'application de bureau Phoenix.",
  "browser.corner.noTab": "Aucun onglet n'est ouvert.",
  "browser.corner.loading": "Chargement de la page.",
  "browser.corner.idle": "La page est chargée.",
  "browser.corner.permission": "Une page demande une autorisation. Veuillez répondre.",
  "browser.corner.shieldsOff":
    "Le blocage des publicités et des traqueurs est désactivé sur {site}.",
  "browser.corner.blocked":
    "{count, plural, one {# requête a été bloquée sur cette page.} other {# requêtes ont été bloquées sur cette page.}}",
  "browser.corner.setting":
    "Afficher Fawkes dans le coin du navigateur Phoenix (application de bureau uniquement)",
  "browser.corner.settingHint":
    "Activé par défaut. Un petit Fawkes dans la barre d'outils du navigateur indique si la page charge, si une autorisation est demandée, si le blocage est désactivé ou si une recherche a eu lieu. Il n'apparaît jamais dans une page web.",
};
