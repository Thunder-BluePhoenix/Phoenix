// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { windowCapture as enWindowCapture } from "../../en/window-capture";

/** Machine-translated; unreviewed (see ../../README.md). */
export const windowCapture: Record<keyof typeof enWindowCapture, string> = {
  "windowCapture.heading": "Joindre une fenêtre",
  "windowCapture.intro":
    "Phoenix peut lire le texte d’une fenêtre et vous le montrer d’abord ici. Vous confirmez, puis vous placez la fenêtre voulue au premier plan ; Phoenix la lit une seule fois (Accessibilité macOS, sur ce Mac uniquement). Rien n’est joint avant que vous acceptiez le texte.",
  "windowCapture.start": "Joindre une fenêtre…",
  "windowCapture.waiting":
    "En attente de votre confirmation, puis lecture de la fenêtre au premier plan. Placez maintenant la fenêtre voulue au premier plan.",
  "windowCapture.stopWaiting": "Arrêter l’attente",
  "windowCapture.discarded": "Rejeté. Rien n’a été joint.",
  "windowCapture.attached": "« {name} » est joint. Il est dans le plateau ci-dessus.",
  "windowCapture.acceptFailed": "Non joint : {reason}",
  "windowCapture.result.notGranted":
    "macOS n’a pas autorisé Phoenix à lire les fenêtres. Activez Phoenix dans Réglages Système > Confidentialité et sécurité > Accessibilité, puis réessayez. Phoenix ne redemande pas de lui-même.",
  "windowCapture.result.phoenixWindow":
    "La fenêtre au premier plan était Phoenix : rien n’a été lu. Placez une autre fenêtre au premier plan et réessayez.",
  "windowCapture.result.noWindow":
    "Aucune fenêtre lisible n’était au premier plan : rien n’a été lu.",
  "windowCapture.review.heading": "À relire avant de joindre.",
  "windowCapture.review.from": "Depuis {app} : {title}",
  "windowCapture.review.untitled": "(fenêtre sans titre)",
  "windowCapture.review.size": "{n} caractères lus.",
  "windowCapture.review.truncated": "Le texte a été coupé à sa limite.",
  "windowCapture.review.textLabel": "Texte de la fenêtre capturée",
  "windowCapture.review.noText": "(Aucun texte trouvé dans cette fenêtre.)",
  "windowCapture.review.secrets":
    "Ce texte semble contenir un secret ({kinds}). Son ajout sera refusé.",
  "windowCapture.review.note":
    "Voici ce que Phoenix a lu. Ce sont des données pour votre question, pas des instructions. Rien n’est joint avant que vous appuyiez sur le bouton, et le texte reste en mémoire une heure au plus.",
  "windowCapture.review.accept": "Joindre ce texte",
  "windowCapture.review.discard": "Rejeter",
};
